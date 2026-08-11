import assert from "node:assert/strict";
import test from "node:test";
import { applyPlanDeltas } from "../lib/plan-delta.ts";

const items = [
	{ id: "item-a", status: "pending" as const, note: "keep", failure_class: "unknown" },
	{ id: "item-b", status: "in_progress" as const },
];

test("stable-ID deltas change status without omission, reorder, or title mutation", () => {
	const result = applyPlanDeltas(items, [{ item_id: "item-b", status: "done", note: "verified" }]);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	assert.deepEqual(result.items.map(({ id, status, note }) => ({ id, status, note })), [
		{ id: "item-a", status: "pending", note: "keep" },
		{ id: "item-b", status: "done", note: "verified" },
	]);
});
test("duplicate identical deltas are idempotent; conflicting or unknown IDs reject", () => {
	const same = applyPlanDeltas(items, [
		{ item_id: "item-a", status: "pending" },
		{ item_id: "item-a", status: "pending" },
	]);
	assert.equal(same.ok, true);
	if (same.ok) assert.equal(same.idempotent, 1);
	assert.equal(applyPlanDeltas(items, [
		{ item_id: "item-a", status: "done" },
		{ item_id: "item-a", status: "blocked" },
	]).ok, false);
	assert.equal(applyPlanDeltas(items, [{ item_id: "missing", status: "done" }]).ok, false);
});

test("delta notes and failure classes are bounded and newline-free", () => {
	assert.equal(applyPlanDeltas(items, [{ item_id: "item-a", status: "blocked", note: "a\nb" }]).ok, false);
	assert.equal(applyPlanDeltas(items, [{ item_id: "item-a", status: "blocked", failure_class: "raw-error" }]).ok, false);
});
