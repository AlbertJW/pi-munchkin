import assert from "node:assert/strict";
import test from "node:test";
import { expandGraph, settleErrors, validateGraph, type GraphPlanState } from "../lib/plan-graph.ts";

function state(): GraphPlanState {
	return {
		schema_version: 5, run_id: "run-one", request: "compare", summary: "research", autonomy: "lean", phase: "executing",
		created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z",
		profile: { name: "deep-research", max_depth: 2, max_children: 2, discovery_budget: { searches: 3, reads: 5 }, validation_reads: 5 },
		items: [{
			id: "root", title: "Root", status: "pending", kind: "research_branch", owner_ref: "a".repeat(24),
			budget: { allocated: { searches: 2, reads: 3 }, used: { searches: 0, reads: 0 } },
		}],
	};
}

test("deep-research graph expansion preserves parent identity and conserves budget", () => {
	const next = expandGraph(state(), "root", [
		{ item_id: "leaf-a", title: "A", budget: { searches: 1, reads: 2 } },
		{ item_id: "leaf-b", title: "B", budget: { searches: 1, reads: 1 } },
	]);
	assert.deepEqual(validateGraph(next), []);
	assert.deepEqual(next.items.slice(1).map((item) => item.parent_id), ["root", "root"]);
	assert.throws(() => expandGraph(state(), "root", [
		{ title: "A", budget: { searches: 2, reads: 3 } },
		{ title: "B", budget: { searches: 1, reads: 1 } },
	]), /child budgets exceed parent allocation/);
	const overused = structuredClone(next);
	overused.items[0].budget!.used = { searches: 0, reads: 0 };
	overused.items[1].budget!.used = { searches: 1, reads: 1 };
	assert.ok(validateGraph(overused).some((error) => /child budget use exceeds parent consumption/.test(error)));
});

test("graph validation rejects cycles, missing parents, depth overflow, and excess roots", () => {
	const missing = state();
	missing.items.push({ id: "orphan", parent_id: "missing", title: "bad", status: "pending" });
	assert.ok(validateGraph(missing).some((error) => /missing parent|cycle or orphan/.test(error)));
	const cycle = state();
	cycle.items[0].parent_id = "loop";
	cycle.items.push({ id: "loop", parent_id: "root", title: "loop", status: "pending" });
	assert.ok(validateGraph(cycle).some((error) => /cycle/.test(error)));
	const roots = state();
	for (let index = 0; index < 3; index++) roots.items.push({ id: `extra-${index}`, title: "extra", status: "pending" });
	assert.ok(validateGraph(roots).some((error) => /at most 3 roots/.test(error)));
});

test("settlement requires terminal unblocked work, complete deferrals, and parent-verified leads", () => {
	const candidate = state();
	candidate.items[0] = { ...candidate.items[0], status: "done", source_leads: ["https://example.test/source"] };
	assert.ok(settleErrors(candidate, new Set()).some((error) => /parent-verified/.test(error)));
	assert.deepEqual(settleErrors(candidate, new Set(["https://example.test/source", "https://second.example.test/source"])), []);
	candidate.items[0].status = "blocked";
	assert.ok(settleErrors(candidate, new Set(["https://example.test/source", "https://second.example.test/source"])).some((error) => /blocked node/.test(error)));
});
