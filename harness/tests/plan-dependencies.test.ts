import assert from "node:assert/strict";
import test from "node:test";
import { dependencyStatusErrors, dependencyStructureErrors, readyItems, stuckItems, unmetDependencies } from "../lib/plan-dependencies.ts";
import { PLAN_MAX_DEPENDENCIES } from "../lib/plan-limits.ts";

const item = (id: string, status = "pending", depends_on?: string[]) => ({ id, status, ...(depends_on ? { depends_on } : {}) });

test("valid dependencies produce no structure errors", () => {
	assert.deepEqual(dependencyStructureErrors([item("a"), item("b", "pending", ["a"]), item("c", "pending", ["a", "b"])]), []);
	assert.deepEqual(dependencyStructureErrors([item("a"), item("b")]), [], "no dependencies at all");
});

test("unknown, self, duplicate, malformed and too many dependencies are rejected with the reason", () => {
	assert.match(dependencyStructureErrors([item("a", "pending", ["zz"])]).join(), /a depends on unknown item zz \(valid: a\)/);
	assert.match(dependencyStructureErrors([item("a", "pending", ["a"])]).join(), /a cannot depend on itself/);
	assert.match(dependencyStructureErrors([item("a"), item("b", "pending", ["a", "a"])]).join(), /b lists a twice/);
	assert.match(dependencyStructureErrors([item("a", "pending", ["has space"])]).join(), /invalid dependency id in a/);
	assert.match(dependencyStructureErrors([{ id: "a", status: "pending", depends_on: "b" as never }]).join(), /depends_on must be a list for a/);
	const many = Array.from({ length: PLAN_MAX_DEPENDENCIES + 1 }, (_, i) => item(`d${i}`));
	assert.match(dependencyStructureErrors([...many, item("x", "pending", many.map((m) => m.id))]).join(), new RegExp(`x may depend on at most ${PLAN_MAX_DEPENDENCIES} items`));
});

test("cycles are rejected and named", () => {
	assert.match(dependencyStructureErrors([item("a", "pending", ["c"]), item("b", "pending", ["a"]), item("c", "pending", ["b"])]).join(), /dependency cycle: a -> c -> b -> a/);
	assert.match(dependencyStructureErrors([item("a", "pending", ["b"]), item("b", "pending", ["a"])]).join(), /dependency cycle/);
});

test("an item waits until every dependency is done; ready items are in plan order", () => {
	const items = [item("a", "done"), item("b", "pending", ["a"]), item("c", "pending", ["b"]), item("d")];
	assert.deepEqual(unmetDependencies(items, items[2]), ["b"]);
	assert.deepEqual(readyItems(items).map((i) => i.id), ["b", "d"]);
});

test("status rule: no in_progress or newly done item may wait on an unfinished dependency", () => {
	const plan = [item("a", "in_progress"), item("b", "in_progress", ["a"])];
	assert.match(dependencyStatusErrors(plan).join(), /b cannot be in_progress yet: it depends on a \(in_progress\)/);
	assert.match(dependencyStatusErrors([item("a"), item("b", "done", ["a"])], new Set(["b"])).join(), /b cannot be done yet/);
	assert.deepEqual(dependencyStatusErrors([item("a", "done"), item("b", "in_progress", ["a"])]), [], "finish a and start b together");
	assert.deepEqual(dependencyStatusErrors([item("a", "pending"), item("b", "done", ["a"])]), [], "an earlier done item stays done (history)");
	assert.match(dependencyStatusErrors([item("a", "pending"), item("b", "in_progress", ["a"])]).join(), /b cannot be in_progress/, "reopening a dependency under an in-progress dependent is refused");
});

test("pending work that waits on a blocked or deferred item, directly or transitively, is stuck", () => {
	const items = [item("a", "blocked"), item("b", "pending", ["a"]), item("c", "pending", ["b"]), item("d", "deferred"), item("e", "pending", ["d"]), item("f")];
	assert.deepEqual(stuckItems(items).map((s) => [s.item.id, s.on]), [["b", ["a"]], ["c", ["b"]], ["e", ["d"]]]);
	assert.deepEqual(readyItems(items).map((i) => i.id), ["f"]);
});
