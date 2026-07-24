import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCapabilitySnapshot,
	nextReflectionStage,
	renderContextMarkdown,
	renderPlanMarkdown,
	renderStepMarkdown,
	stepFileName,
	validateReflectionAppend,
	validateV4Plan,
	type PlanStepV4,
	type ReflectionRecord,
} from "../lib/plan-synthesis.ts";

const interpretation = (overrides: Partial<ReflectionRecord> = {}): ReflectionRecord => ({
	stage: "interpretation",
	requirements: ["add behavior"],
	constraints: ["keep compatibility"],
	non_goals: ["plugin framework"],
	assumptions: [],
	evidence_refs: [],
	uncertainties: [],
	capability_use: [],
	scope_cuts: ["defer speculative cache"],
	test_seams: ["node --test"],
	signals: {},
	...overrides,
});

const snapshot = buildCapabilitySnapshot(
	["read", "plan_write"],
	[
		{ name: "read", description: "Read files", sourceInfo: { source: "builtin" } },
		{ name: "edit", description: "Edit files", sourceInfo: { source: "builtin" } },
		{ name: "plan_write", description: "Write a plan", sourceInfo: { source: "plan-runner" } },
	],
	[{ name: "plan", description: "Plan work", source: "extension" }],
	[{ name: "verify-gate", description: "Requires proof", active: true, planning_note: "Use a read-only gate." }],
	"2026-01-01T00:00:00.000Z",
);

const step = (overrides: Partial<PlanStepV4> = {}): PlanStepV4 => ({
	id: "s1",
	order: 1,
	title: "Add behavior",
	kind: "behavior",
	status: "pending",
	objective: "Expose the requested behavior",
	acceptance: ["observable result"],
	covers: ["add behavior"],
	hard_depends_on: [],
	soft_after: [],
	required_capabilities: ["read"],
	risk: "medium",
	information_value: "high",
	effort: "low",
	expected_files: ["src/x.ts"],
	invalidated_by: ["wrong convention"],
	test: {
		paths: ["test/x.test.ts"],
		command: "node --test",
		red_expectation: "new assertion fails",
		green_expectation: "suite passes",
	},
	...overrides,
});

test("capability snapshot is compact, stable, and distinguishes active surfaces", () => {
	assert.equal(snapshot.entries.find((entry) => entry.name === "read")?.active, true);
	assert.equal(snapshot.entries.find((entry) => entry.name === "edit")?.active, false);
	assert.equal(snapshot.entries.find((entry) => entry.name === "/plan")?.kind, "command");
	assert.equal(snapshot.entries.find((entry) => entry.name === "verify-gate")?.kind, "passive");
	const again = buildCapabilitySnapshot(
		["plan_write", "read"],
		[
			{ name: "plan_write", description: "Write a plan", sourceInfo: { source: "plan-runner" } },
			{ name: "edit", description: "Edit files", sourceInfo: { source: "builtin" } },
			{ name: "read", description: "Read files", sourceInfo: { source: "builtin" } },
		],
		[{ name: "plan", description: "Plan work", source: "extension" }],
		[{ name: "verify-gate", description: "Requires proof", active: true, planning_note: "Use a read-only gate." }],
	);
	assert.equal(again.sha256, snapshot.sha256, "capture time and input ordering do not affect identity");
});

test("reflection sequence adapts from one to three passes", () => {
	assert.equal(nextReflectionStage([]), "interpretation");
	assert.equal(nextReflectionStage([interpretation()]), null, "simple request stops after interpretation");
	const risky = interpretation({ signals: { repository_behavior: true, risk: true, multiple_artifacts: true } });
	assert.equal(nextReflectionStage([risky]), "evidence");
	const evidence = interpretation({
		stage: "evidence",
		evidence_refs: ["src/x.ts:1"],
		signals: { risk: true, multiple_artifacts: true },
	});
	assert.equal(nextReflectionStage([risky, evidence]), "critique");
	const critique = interpretation({ stage: "critique", evidence_refs: ["test/x.test.ts:1"] });
	assert.equal(nextReflectionStage([risky, evidence, critique]), null);
	const exception = interpretation({ signals: { test_exception: true } });
	const exceptionEvidence = interpretation({ stage: "evidence", evidence_refs: ["test seam absent"], signals: {} });
	assert.equal(nextReflectionStage([exception, exceptionEvidence]), "critique", "a test exception always requires pass 3");
	assert.deepEqual(validateReflectionAppend([risky], critique), ["expected evidence reflection, received critique"]);
});

test("v4 validation enforces coverage, capabilities, tests, and hard DAG integrity", () => {
	assert.deepEqual(validateV4Plan([step()], [interpretation()], snapshot), []);
	assert.ok(validateV4Plan([step({ covers: [] })], [interpretation()], snapshot).some((error) => error.includes("uncovered requirement")));
	assert.ok(validateV4Plan([step({ required_capabilities: ["edit"] })], [interpretation()], snapshot).some((error) => error.includes("unavailable capability")));
	assert.deepEqual(validateV4Plan([step({ required_capabilities: ["edit"], capability_fallback: "use apply_patch" })], [interpretation()], snapshot), []);
	assert.ok(validateV4Plan([step({ required_capabilities: ["imaginary"], capability_fallback: "guess" })], [interpretation()], snapshot)
		.some((error) => error.includes("unknown capability")));
	assert.ok(validateV4Plan([step({ test: undefined })], [interpretation()], snapshot).some((error) => error.includes("requires a test contract")));
	assert.ok(validateV4Plan([step({ status: "in_progress" }), step({ id: "s2", title: "Second", status: "in_progress" })], [interpretation()], snapshot)
		.some((error) => error.includes("one mutation lane")));
	assert.ok(validateV4Plan([step({ covers: [], title: "Future framework" })], [interpretation()], snapshot).some((error) => error.includes("speculative behavior")));
	const supportOnly = step({
		id: "support",
		title: "Generic abstraction",
		kind: "support",
		covers: [],
		test: undefined,
		validation: "node --check src/x.ts",
	});
	assert.ok(validateV4Plan([step(), supportOnly], [interpretation()], snapshot).some((error) => error.includes("speculative support")));
	const cycle = [
		step({ id: "s1", hard_depends_on: ["s2"] }),
		step({ id: "s2", order: 2, title: "Second", hard_depends_on: ["s1"] }),
	];
	assert.ok(validateV4Plan(cycle, [interpretation()], snapshot).some((error) => error.includes("cycle")));
	const crossed = [
		step({ id: "s1", status: "pending" }),
		step({ id: "s2", order: 2, title: "Second", status: "in_progress", hard_depends_on: ["s1"] }),
	];
	assert.ok(validateV4Plan(crossed, [interpretation()], snapshot).some((error) => error.includes("crosses unfinished hard dependencies")));
});

test("renderers keep stable step names and persist conclusions rather than hidden reasoning", () => {
	assert.equal(stepFileName(step()), "01-add-behavior.md");
	const context = renderContextMarkdown("please add it", [interpretation()], snapshot);
	assert.match(context, /Requirements/);
	assert.match(context, /plugin framework/);
	assert.doesNotMatch(context, /chain.of.thought/i);
	const plan = renderPlanMarkdown("please add it", "one step", [step()], snapshot);
	assert.match(plan, /\[Add behavior\]\(\.\/01-add-behavior\.md\)/);
	const detail = renderStepMarkdown(step());
	assert.match(detail, /RED: new assertion fails/);
	assert.match(detail, /Required: read/);
});
