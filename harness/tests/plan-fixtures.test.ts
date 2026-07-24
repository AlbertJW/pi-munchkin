import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCapabilitySnapshot, type PlanStepV4 } from "../lib/plan-synthesis.ts";
import { backtrackAndStale, eligibleSteps } from "../lib/plan-router.ts";

const fixture = JSON.parse(readFileSync(
	new URL("./fixtures/plan-v4-scenarios.json", import.meta.url),
	"utf8",
));
const cases = new Map(fixture.cases.map((item: any) => [item.id, item]));

function step(raw: any): PlanStepV4 {
	return {
		id: raw.id,
		order: raw.order ?? 1,
		title: raw.id,
		kind: "support",
		status: raw.status,
		objective: raw.id,
		acceptance: ["observable"],
		covers: [],
		hard_depends_on: raw.hard_depends_on,
		soft_after: raw.soft_after ?? [],
		required_capabilities: ["read"],
		risk: "low",
		information_value: raw.id === "evidence" ? "high" : "low",
		effort: "low",
		expected_files: [],
		invalidated_by: [],
		validation: "node --check fixture.js",
	};
}

test("planner discriminating fixtures are present and remain human-unapproved", () => {
	assert.equal(fixture.schema, "pi.plan-scenarios/v1");
	assert.equal(fixture.admission.approved, false);
	assert.equal(fixture.admission.authoritative, false);
	assert.deepEqual(
		[...cases.keys()],
		["capability-fit", "jump-to-unblock", "backtrack-on-reveal", "tdd-trajectory", "context-isolation"],
	);
});

test("jump-to-unblock fixture has exactly the later evidence step eligible", () => {
	const scenario: any = cases.get("jump-to-unblock");
	const capabilities = buildCapabilitySnapshot(
		["read"],
		[{ name: "read", description: "read", sourceInfo: { source: "builtin" } }],
		[],
		[],
	);
	assert.deepEqual(eligibleSteps(scenario.steps.map(step), capabilities).map((item) => item.id), scenario.expected.eligible);
});

test("backtrack fixture stales only the target and completed hard-dependent closure", () => {
	const scenario: any = cases.get("backtrack-on-reveal");
	const result = backtrackAndStale(scenario.steps.map(step), scenario.backtrack_target, "revealed convention");
	assert.deepEqual(result.stale.sort(), [...scenario.expected.stale].sort());
	assert.equal(result.steps.find((item) => item.id === scenario.expected.unchanged[0])?.status, "done");
});

test("TDD and context fixture contracts encode the paired comparison", () => {
	const tdd: any = cases.get("tdd-trajectory");
	assert.deepEqual(tdd.events.map((event: any) => event.phase), tdd.expected.order);
	assert.ok(tdd.events[0].exit_code !== 0 && tdd.events[1].exit_code === 0);
	const context: any = cases.get("context-isolation");
	assert.deepEqual(context.profiles.map((profile: any) => profile.mode), ["current", "spawn"]);
	assert.equal(context.profiles[1].subagent_required, true);
	assert.ok(context.metrics.includes("total_tokens"));
});
