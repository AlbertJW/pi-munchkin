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

test("each note rejection names its own cause", async () => {
	// All three used to share one message. A 12-byte note containing a carriage return
	// was rejected as "at most 900 UTF-8 bytes", so the only action the message
	// suggested — shorten it — could never succeed. plan_update is an OUTCOME_TOOLS
	// member, so that unactionable loop fed the tier ladder toward an abort.
	const items = [{ id: "x", title: "t", status: "pending" as const }];
	const carriage = applyPlanDeltas(items, [{ item_id: "x", note: "line1\r\nline2" }]);
	assert.equal(carriage.ok, false);
	assert.match(carriage.errors[0], /carriage return/);
	assert.doesNotMatch(carriage.errors[0], /900/, "a 12-byte note must not be told it is too long");

	const long = applyPlanDeltas(items, [{ item_id: "x", note: "界".repeat(301) }]);
	assert.equal(long.ok, false);
	assert.match(long.errors[0], /900 UTF-8 bytes/);

	assert.equal(applyPlanDeltas(items, [{ item_id: "x", note: "plain\nnewlines are fine" }]).ok, true);
});

test("truncateBytes cuts on a code-point boundary, never mid-surrogate", async () => {
	// `.slice(0, -1)` removes one UTF-16 code unit, so trimming a string that ends in a
	// non-BMP character dropped the LOW surrogate and left the high one — at which
	// point the byte budget was satisfied and the loop stopped. The result survives
	// JSON.stringify into plan-state.json but becomes U+FFFD when the Markdown
	// projection is written as UTF-8, so the authoritative file and its projection
	// disagree byte-for-byte.
	const { truncateBytes } = await import("../extensions/plan-runner.ts");
	const lone = (value: string) => {
		for (let i = 0; i < value.length; i += 1) {
			const code = value.charCodeAt(i);
			if (code >= 0xD800 && code <= 0xDBFF) {
				const next = value.charCodeAt(i + 1);
				if (!(next >= 0xDC00 && next <= 0xDFFF)) return true;
				i += 1;
			} else if (code >= 0xDC00 && code <= 0xDFFF) return true;
		}
		return false;
	};
	for (const budget of [110, 118, 119, 120, 121, 900]) {
		const out = truncateBytes(`${"界".repeat(39)}😀`, budget);
		assert.ok(Buffer.byteLength(out, "utf8") <= budget, `exceeded ${budget} bytes`);
		assert.equal(lone(out), false, `lone surrogate at budget ${budget}`);
		assert.equal(Buffer.from(out, "utf8").toString("utf8"), out, `not UTF-8 round-trip stable at ${budget}`);
	}
	assert.equal(truncateBytes("plain", 900), "plain");
});
