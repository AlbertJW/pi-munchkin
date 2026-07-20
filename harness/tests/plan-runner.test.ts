import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";
import { reconcileItems, validateDeps } from "../lib/plan-integrity.ts";
import { processWriterMarker } from "../lib/process-writer.ts";

let seq = 0;
const id = () => `item-${++seq}`;

// Regression for the gate_fails-wipe bug: a small model re-emitting the plan list
// WITHOUT the optional `gate` field must not reset the failure counter — otherwise
// GATE_MAX escalation to "blocked" never triggers (the model loops forever).

test("reconcileItems: gate_fails preserved when the model omits gate on rewrite", () => {
	const prev = reconcileItems(undefined, [{ title: "fix bug", status: "in_progress", gate: "npm test" }], id);
	prev[0].gate_fails = 2; // two prior gate failures accumulated

	// rewrite that OMITS gate entirely (the reproduction failure)
	const next = reconcileItems(prev, [{ title: "fix bug", status: "in_progress" }], id);
	assert.equal(next[0].gate, "npm test", "gate must be preserved when omitted");
	assert.equal(next[0].gate_fails, 2, "gate_fails must survive an omitted-gate rewrite");
});

test("reconcileItems: gate_fails resets only when the resolved gate actually changes", () => {
	const prev = reconcileItems(undefined, [{ title: "t", status: "in_progress", gate: "npm test" }], id);
	prev[0].gate_fails = 3;

	const changed = reconcileItems(prev, [{ title: "t", status: "in_progress", gate: "npm run check" }], id);
	assert.equal(changed[0].gate_fails, 0, "new gate → counter resets");

	const cleared = reconcileItems(prev, [{ title: "t", status: "in_progress", gate: "" }], id);
	assert.equal(cleared[0].gate, undefined, "empty string clears the gate");
	assert.equal(cleared[0].gate_fails, 0, "cleared gate → counter resets");
});

test("reconcileItems: preserves item id across a cosmetic rename", () => {
	const prev = reconcileItems(undefined, [{ title: "Fix `parseCSV`", status: "in_progress" }], id);
	const next = reconcileItems(prev, [{ title: "fix parsecsv", status: "done" }], id); // case/backtick jitter
	assert.equal(next[0].id, prev[0].id, "normalized-title match keeps the id");
});

test("validateDeps: rejects duplicate normalized titles", () => {
	const errors = validateDeps([
		{ title: "Fix `parseCSV`" },
		{ title: "  fix parsecsv  " },
	]);
	assert.ok(errors.some((error) => error.includes("duplicate normalized title")), errors.join("\n"));
});

test("validateDeps: rejects duplicate normalized references in one depends_on list", () => {
	const errors = validateDeps([
		{ title: "build" },
		{ title: "ship", depends_on: ["build", " `BUILD` "] },
	]);
	assert.ok(errors.some((error) => error.includes("repeats dependency")), errors.join("\n"));
});

test("process writer marker survives extension-style module reloads", async () => {
	const first = processWriterMarker();
	const reloaded = await import(`../lib/process-writer.ts?reload=${Date.now()}-${Math.random()}`);
	assert.equal(reloaded.processWriterMarker(), first);
});

test("process writer marker is fresh in a genuinely new OS process", () => {
	const current = processWriterMarker();
	const child = execFileSync(process.execPath, [
		"--experimental-strip-types",
		"--input-type=module",
		"--eval",
		'import { processWriterMarker } from "./harness/lib/process-writer.ts"; process.stdout.write(processWriterMarker());',
	], { cwd: process.cwd(), encoding: "utf8" });
	assert.notEqual(child, current);
});
