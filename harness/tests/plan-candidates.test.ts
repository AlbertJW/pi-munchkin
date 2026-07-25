import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { usePlanV4Runtime } from "../extensions/plan-runner.ts";

const root = new URL("../../optimizer/prompt-lab/configs/", import.meta.url);
const schema = JSON.parse(readFileSync(new URL("schema.json", root), "utf8"));
const promoted = new Set([
	"c40-plan-synthesis-v1",
	"c41-plan-tdd-evidence",
	"c42-plan-dynamic-route",
	"c43-plan-plannotator-bridge",
]);
const load = (name: string) => JSON.parse(readFileSync(new URL(
	`${promoted.has(name) ? "static" : "pending"}/${name}.json`,
	root,
), "utf8"));

test("c40-c45 flags are schema-registered and only explicitly promoted configs enter the static roster", () => {
	const fields = schema.dimensions.thresholds.fields;
	for (const key of [
		"PLAN_SYNTHESIS_V1",
		"PLAN_TDD_EVIDENCE",
		"PLAN_DYNAMIC_ROUTE",
		"PLAN_PLANNOTATOR_BRIDGE",
		"PLAN_STEP_CONTEXT",
	]) {
		assert.ok(fields[key], `${key} is schema-registered`);
	}
	for (const name of [
		"c40-plan-synthesis-v1",
		"c41-plan-tdd-evidence",
		"c42-plan-dynamic-route",
		"c43-plan-plannotator-bridge",
		"c44-plan-context-current",
		"c45-plan-context-spawn",
	]) {
		assert.equal(existsSync(new URL(`static/${name}.json`, root)), promoted.has(name), `${name} roster location drifted`);
		assert.equal(existsSync(new URL(`pending/${name}.json`, root)), !promoted.has(name), `${name} pending location drifted`);
		assert.ok(load(name).prediction.includes("Falsifier"), `${name} has an explicit falsifier`);
	}
});

test("c44 and c45 share an identical core and differ only in execution context", () => {
	const current = load("c44-plan-context-current").thresholds;
	const spawn = load("c45-plan-context-spawn").thresholds;
	for (const flag of ["PLAN_SYNTHESIS_V1", "PLAN_TDD_EVIDENCE", "PLAN_DYNAMIC_ROUTE"]) {
		assert.equal(current[flag], "on");
		assert.equal(spawn[flag], "on");
	}
	assert.equal(current.PLAN_STEP_CONTEXT, "current");
	assert.equal(spawn.PLAN_STEP_CONTEXT, "spawn");
	assert.equal("PLAN_PLANNOTATOR_BRIDGE" in current, false);
	assert.equal("PLAN_PLANNOTATOR_BRIDGE" in spawn, false);
});

test("c40 never migrates an existing legacy plan automatically", () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-plan-runtime-"));
	assert.equal(usePlanV4Runtime(cwd, false), false);
	assert.equal(usePlanV4Runtime(cwd, true), true);

	const stateDir = join(cwd, ".pi");
	mkdirSync(stateDir, { recursive: true });
	writeFileSync(join(stateDir, "plan-state.json"), JSON.stringify({ schema_version: 3, items: [] }));
	assert.equal(usePlanV4Runtime(cwd, true), false);

	writeFileSync(join(stateDir, "plan-state.json"), JSON.stringify({ schema_version: 4, steps: [] }));
	assert.equal(usePlanV4Runtime(cwd, true), true);
});
