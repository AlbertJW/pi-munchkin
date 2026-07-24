import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilitySnapshot, type PlanStepV4 } from "../lib/plan-synthesis.ts";
import {
	backtrackAndStale,
	eligibleSteps,
	nextRouteStreak,
	rankEligibleSteps,
	routeFingerprint,
	tddEvidenceErrors,
	testReceipt,
	validateRouteTarget,
} from "../lib/plan-router.ts";

const capabilities = buildCapabilitySnapshot(
	["read", "edit"],
	[
		{ name: "read", description: "read", sourceInfo: { source: "builtin" } },
		{ name: "edit", description: "edit", sourceInfo: { source: "builtin" } },
	],
	[],
	[],
);

const step = (id: string, overrides: Partial<PlanStepV4> = {}): PlanStepV4 => ({
	id,
	order: Number(id.replace(/\D/g, "")) || 1,
	title: id,
	kind: "behavior",
	status: "pending",
	objective: id,
	acceptance: ["works"],
	covers: [id],
	hard_depends_on: [],
	soft_after: [],
	required_capabilities: ["read"],
	risk: "low",
	information_value: "low",
	effort: "low",
	expected_files: [],
	invalidated_by: [],
	test: { paths: ["test.js"], command: "node --test", red_expectation: "fails", green_expectation: "passes" },
	...overrides,
});

test("hard dependencies constrain eligibility while soft order does not", () => {
	const steps = [
		step("s1"),
		step("s2", { hard_depends_on: ["s1"] }),
		step("s3", { soft_after: ["s1"], information_value: "high" }),
	];
	assert.deepEqual(eligibleSteps(steps, capabilities).map((item) => item.id), ["s1", "s3"]);
	assert.deepEqual(validateRouteTarget("s2", steps, capabilities), ['target "s2" has unmet hard dependencies: s1']);
	assert.deepEqual(validateRouteTarget("s3", steps, capabilities), []);
});

test("ranking is correctness-first then unlock, effort, and original order", () => {
	const steps = [
		step("s1", { risk: "medium", effort: "high" }),
		step("s2", { information_value: "high", effort: "high" }),
		step("s3", { information_value: "high", effort: "low" }),
		step("s4", { invalidated_by: ["assumption-a"] }),
	];
	assert.equal(rankEligibleSteps(steps, capabilities, ["assumption-a"])[0].id, "s4");
	assert.equal(rankEligibleSteps(steps, capabilities)[0].id, "s3");
	const surfaceSteps = [
		step("s1", { status: "in_progress", expected_files: ["src/shared.ts"] }),
		step("s2", { expected_files: ["src/other.ts"] }),
		step("s3", { expected_files: ["src/shared.ts"] }),
	];
	assert.equal(rankEligibleSteps(surfaceSteps, capabilities, [], "s1")[0].id, "s3", "shared surface lowers context-switch cost");
});

test("backtracking marks the target and transitive hard dependents stale without changing unrelated steps", () => {
	const steps = [
		step("s1", { status: "done" }),
		step("s2", { status: "done", hard_depends_on: ["s1"] }),
		step("s3", { status: "done", hard_depends_on: ["s2"] }),
		step("s4", { status: "done" }),
	];
	const result = backtrackAndStale(steps, "s1", "later evidence contradicted it");
	assert.deepEqual(result.stale.sort(), ["s1", "s2", "s3"]);
	assert.equal(result.steps.find((item) => item.id === "s4")?.status, "done");
	assert.equal(result.steps.find((item) => item.id === "s2")?.stale_reason, "later evidence contradicted it");
});

test("TDD evidence requires matching failed RED before matching passing GREEN", () => {
	const base = step("s1");
	assert.ok(tddEvidenceErrors(base).some((error) => error.includes("RED")));
	const red = testReceipt("node --test", 1, "expected failure", "2026-01-01T00:00:00.000Z");
	const green = testReceipt("node --test", 0, "pass", "2026-01-01T00:01:00.000Z");
	assert.deepEqual(tddEvidenceErrors({ ...base, red_receipt: red, green_receipt: green }), []);
	assert.ok(tddEvidenceErrors({ ...base, red_receipt: green, green_receipt: red }).length > 0);
});

test("route no-progress fingerprint increments only for unchanged state and evidence", () => {
	const steps = [step("s1")];
	const fp = routeFingerprint(steps, "s1", ["a"]);
	assert.equal(nextRouteStreak(undefined, fp, 2), 0);
	assert.equal(nextRouteStreak(fp, fp, 2), 3);
	assert.notEqual(routeFingerprint(steps, "s1", ["b"]), fp);
});
