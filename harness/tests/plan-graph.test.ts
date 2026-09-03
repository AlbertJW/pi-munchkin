import assert from "node:assert/strict";
import test from "node:test";
import { expandGraph, settleErrors, validCoverage, validateGraph, type GraphPlanState } from "../lib/plan-graph.ts";

const completeCoverage = {
	strategy: "direct" as const, scope: "bounded" as const, returned_count: 1,
	truncated: false, budget_exhausted: false, failed: false, complete: true,
};

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
		const premature = structuredClone(next);
		premature.items[0].status = "done";
		premature.items[0].coverage = completeCoverage;
		assert.ok(validateGraph(premature).some((error) => /terminal parent has open children/.test(error)));
});

test("ordinary graph expansion does not manufacture delegation ownership", () => {
	const ordinary = state();
	delete ordinary.profile;
	ordinary.items[0] = { id: "root", title: "Local work", status: "pending", kind: "work", budget: { allocated: { searches: 0, reads: 0 }, used: { searches: 0, reads: 0 } } };
		const next = expandGraph(ordinary, "root", [{ item_id: "local-child", title: "Local child" }]);
		assert.equal(next.items[1].owner_ref, undefined, "structural expansion alone is not delegation");
		assert.equal(next.items[1].budget, undefined, "generic graph expansion does not require research accounting");
	assert.deepEqual(validateGraph(next), []);
});

test("coverage receipts cannot call partial or truncated retrieval complete", () => {
	assert.equal(validCoverage(completeCoverage), true);
	assert.equal(validCoverage({
		...completeCoverage, strategy: "structural", scope: "exhaustive", returned_count: 12, total_count: 47, complete: false,
	}), true);
	assert.equal(validCoverage({
		...completeCoverage, strategy: "structural", scope: "exhaustive", returned_count: 12, total_count: 47, complete: true,
	}), false);
	assert.equal(validCoverage({ ...completeCoverage, truncated: true }), false);
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
	const weakened = state();
	weakened.profile = { ...weakened.profile!, max_depth: 99 as never, discovery_budget: { searches: 300, reads: 500 } };
	assert.ok(validateGraph(weakened).some((error) => /profile constants/.test(error)), "stored state cannot weaken the fixed research profile");
	const malformed = state();
	malformed.items[0] = { ...malformed.items[0], title: " ", kind: "work", owner_ref: "not-an-owner", source_leads: ["https://user:pass@example.test/private"] };
	const malformedErrors = validateGraph(malformed);
		for (const pattern of [/invalid title/, /root must be a research_branch/, /invalid owner reference/, /invalid source leads/]) {
			assert.ok(malformedErrors.some((error) => pattern.test(error)), `expected ${pattern} in ${malformedErrors.join("; ")}`);
		}
		const tooDeep = expandGraph(state(), "root", [{ item_id: "leaf", title: "Leaf", budget: { searches: 1, reads: 1 } }]);
		tooDeep.items.push({
			id: "forged-grandchild", parent_id: "leaf", kind: "research_leaf", title: "Third delegation level", status: "pending",
			owner_ref: "b".repeat(24), budget: { allocated: { searches: 0, reads: 1 }, used: { searches: 0, reads: 0 } },
		});
		assert.ok(validateGraph(tooDeep).some((error) => /maximum graph depth exceeded/.test(error)));
		const zero = state();
		zero.items[0].budget = { allocated: { searches: 0, reads: 0 }, used: { searches: 0, reads: 0 } };
		assert.ok(validateGraph(zero).some((error) => /non-zero allocation/.test(error)));
		const leased = state();
		leased.items[0].lease = { lease_id: "lease-1234", issued_at: "2026-08-25T00:00:00.000Z", owner_ref: leased.items[0].owner_ref! };
		assert.deepEqual(validateGraph(leased), [], "an open root may carry a valid dispatch lease");
		leased.items[0].status = "done";
		assert.ok(validateGraph(leased).some((error) => /open deep-research root branch/.test(error)), "terminal branches cannot retain a lease");
	});

test("settlement requires terminal unblocked work, complete deferrals, and parent-verified leads", () => {
	const candidate = state();
	candidate.items[0] = { ...candidate.items[0], status: "done", coverage: completeCoverage, source_leads: ["https://example.test/source"] };
	assert.ok(settleErrors(candidate, new Set()).some((error) => /parent-verified/.test(error)));
	assert.deepEqual(settleErrors(candidate, new Set(["https://example.test/source", "https://second.example.test/source"])), []);
	candidate.items[0].coverage = { ...completeCoverage, complete: false, budget_exhausted: true };
	assert.ok(settleErrors(candidate, new Set(["https://example.test/source", "https://second.example.test/source"])).some((error) => /gap-free coverage/.test(error)));
	candidate.items[0].coverage = completeCoverage;
	candidate.items[0].evidence_gaps = ["unresolved crossover"];
	assert.ok(settleErrors(candidate, new Set(["https://example.test/source", "https://second.example.test/source"])).some((error) => /gap-free coverage/.test(error)));
	delete candidate.items[0].evidence_gaps;
	candidate.items[0].status = "blocked";
	assert.ok(settleErrors(candidate, new Set(["https://example.test/source", "https://second.example.test/source"])).some((error) => /blocked node/.test(error)));
});
