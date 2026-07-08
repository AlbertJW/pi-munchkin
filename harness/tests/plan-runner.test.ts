import assert from "node:assert/strict";
import test from "node:test";
import { reconcileItems } from "../lib/plan-integrity.ts";

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
