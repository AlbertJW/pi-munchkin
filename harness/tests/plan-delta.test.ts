import assert from "node:assert/strict";
import test from "node:test";
import { applyPlanDeltas } from "../lib/plan-delta.ts";

const items = [
	{ id: "item-a", status: "pending" as const, note: "keep" },
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

test("notes are byte-bounded; blocked items require a reason; note-only updates work", () => {
	assert.equal(applyPlanDeltas(items, [{ item_id: "item-a", status: "blocked" }]).ok, false);
	assert.equal(applyPlanDeltas(items, [{ item_id: "item-a", status: "blocked", note: "界".repeat(300) }]).ok, true,
		"900 bytes of multibyte note is accepted (300 was live churn, raised 2026-08-25)");
	assert.equal(applyPlanDeltas(items, [{ item_id: "item-a", status: "blocked", note: "界".repeat(301) }]).ok, false,
		"903 bytes still rejects — the bound moved, it did not vanish");
	const noteOnly = applyPlanDeltas(items, [{ item_id: "item-a", note: "first\nsecond" }]);
	assert.equal(noteOnly.ok, true);
	if (noteOnly.ok) assert.equal(noteOnly.items[0].note, "first\nsecond");
});

test("deferred nodes require an explicit value/risk/rationale decision", () => {
	assert.equal(applyPlanDeltas(items, [{ item_id: "item-a", status: "deferred" }]).ok, false);
	const result = applyPlanDeltas(items, [{
		item_id: "item-a", status: "deferred",
		defer: { value: "low", risk: "bounded", rationale: "accepted remainder" },
	}]);
	assert.equal(result.ok, true);
});

test("distinct delegated owners may progress concurrently but duplicate/local owners may not", () => {
	const delegated = [
		{ id: "a", status: "pending" as const, owner_ref: "owner-a" },
		{ id: "b", status: "pending" as const, owner_ref: "owner-b" },
	];
	assert.equal(applyPlanDeltas(delegated, [
		{ item_id: "a", status: "in_progress" }, { item_id: "b", status: "in_progress" },
	]).ok, true);
	assert.equal(applyPlanDeltas(delegated.map((item) => ({ ...item, owner_ref: "same" })), [
		{ item_id: "a", status: "in_progress" }, { item_id: "b", status: "in_progress" },
	]).ok, false);
});
