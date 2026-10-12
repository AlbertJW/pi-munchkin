// plan_write accepts model-chosen stable ids for new items (2026-10 trace finding:
// fresh plans were rejected with "unknown item_id ... Valid ids: (none)").
import assert from "node:assert/strict";
import test from "node:test";
import { structuralItems } from "../lib/plan-service.ts";

const plan = (phase: "planned" | "executing", items: Array<{ id: string; title: string; status: string }>) =>
	({ phase, items }) as never;

test("a new plan keeps the item ids the model chose", () => {
	const items = structuralItems(undefined, [{ item_id: "health", title: "Check health" }, { title: "Report" }]);
	assert.equal(items[0].id, "health");
	assert.ok(items[1].id.length > 0);
});

test("revising keeps existing items by id and adopts new chosen ids", () => {
	const previous = plan("planned", [{ id: "a", title: "A", status: "done" }]);
	const items = structuralItems(previous, [{ item_id: "a", title: "A" }, { item_id: "b", title: "B" }]);
	assert.deepEqual(items.map((item) => [item.id, item.status]), [["a", "done"], ["b", "pending"]]);
});

test("an executing plan still refuses to silently drop unresolved items", () => {
	const previous = plan("executing", [{ id: "a", title: "A", status: "pending" }]);
	assert.throws(() => structuralItems(previous, [{ item_id: "typo-a", title: "A" }]), /unresolved item_id\(s\) omitted: a/);
});

test("duplicate and malformed ids are still rejected", () => {
	assert.throws(() => structuralItems(undefined, [{ item_id: "x", title: "1" }, { item_id: "x", title: "2" }]), /duplicate item_id x/);
	assert.throws(() => structuralItems(undefined, [{ item_id: "has space", title: "1" }]), /invalid item_id/);
});
