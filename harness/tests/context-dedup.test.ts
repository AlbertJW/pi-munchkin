import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { dedupReadResults } from "../lib/context-dedup.ts";
import { buildContextSurfaceReceipt, systemPromptReceipt } from "../lib/context-surface.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const fileText = "export const answer = 42;\n".repeat(20); // large enough to matter
const readPair = (callId: string, path: string, text: string, isError = false) => [
	{ role: "assistant", content: [{ type: "toolCall", id: callId, name: "read", arguments: { path } }] },
	{ role: "toolResult", toolCallId: callId, toolName: "read", content: [{ type: "text", text }], isError },
];

test("dedup replaces the LATER identical read, keeps the earlier one intact, accounts bytes", () => {
	const messages = [
		...readPair("r1", "src/a.ts", fileText),
		{ role: "assistant", content: [{ type: "text", text: "thinking about it" }] },
		...readPair("r2", "src/a.ts", fileText),
	];
	const result = dedupReadResults(messages);
	assert.ok(result, "identical re-read must be collapsed");
	assert.equal(result.replaced, 1);
	assert.ok(result.savedBytes > 0);
	const first = result.messages[1] as { content: Array<{ text: string }> };
	assert.equal(first.content[0].text, fileText, "earlier copy untouched — prefix stays cacheable");
	const later = result.messages[4] as { content: Array<{ text: string }> };
	assert.match(later.content[0].text, /identical to the result at message #1/);
	assert.match(later.content[0].text, /src\/a\.ts/);
	assert.ok(!later.content[0].text.includes("answer = 42"), "stub carries no file content");
});

test("different content for the same path, errored reads, and other tools are untouched", () => {
	const changed = [
		...readPair("r1", "src/a.ts", fileText),
		...readPair("r2", "src/a.ts", fileText + "// changed\n"),
	];
	assert.equal(dedupReadResults(changed), null, "changed content is NOT a duplicate");

	const errored = [
		...readPair("r1", "src/a.ts", "ENOENT boom", true),
		...readPair("r2", "src/a.ts", "ENOENT boom", true),
	];
	assert.equal(dedupReadResults(errored), null, "error results are never collapsed");

	const bash = [
		{ role: "assistant", content: [{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "cat a" } }] },
		{ role: "toolResult", toolCallId: "b1", toolName: "bash", content: [{ type: "text", text: fileText }], isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "b2", name: "bash", arguments: { command: "cat a" } }] },
		{ role: "toolResult", toolCallId: "b2", toolName: "bash", content: [{ type: "text", text: fileText }], isError: false },
	];
	assert.equal(dedupReadResults(bash), null, "v1 scope is the read tool only");

	// M5: a tiny repeated result must NOT be replaced by a longer stub —
	// dedup only ever shrinks the context, so savedBytes stays non-negative.
	const tiny = [
		...readPair("r1", "v", "1"),
		...readPair("r2", "v", "1"),
	];
	assert.equal(dedupReadResults(tiny), null, "stub larger than the result -> no replacement");
});

test("dedup output measurably lowers the surface's exact-duplicate share and keeps prefix_stable", () => {
	const system = systemPromptReceipt("s");
	const messages = [...readPair("r1", "a.ts", fileText), ...readPair("r2", "a.ts", fileText)];
	const before = buildContextSurfaceReceipt(messages, system, undefined).receipt;
	const deduped = dedupReadResults(messages)!;
	const after = buildContextSurfaceReceipt(deduped.messages, system, undefined).receipt;
	assert.ok(after.exact_duplicate_block_share < before.exact_duplicate_block_share,
		`dedup must lower the measured dup share (${before.exact_duplicate_block_share} -> ${after.exact_duplicate_block_share})`);

	// cross-call prefix stability: call N deduped, call N+1 = same + appended turn
	const callN = buildContextSurfaceReceipt(deduped.messages, system, undefined);
	const appended = [...deduped.messages, { role: "user", content: [{ type: "text", text: "next" }] }];
	const callN1 = buildContextSurfaceReceipt(appended, system, undefined, {}, { messageHashes: callN.messageHashes, systemSha: system.sha256 });
	assert.equal(callN1.receipt.prefix_stable, true, "later-copy replacement must stay append-safe across calls");
});

test("integration: READ_DEDUP=on transforms the context view; off leaves it alone; nudge steers over threshold with cooldown", async () => {
	const dir = mkdtempSync(join(tmpdir(), "context-dedup-"));
	process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
	process.env.TELEMETRY_SOURCE = "test";
	try {
		// off: handler not registered
		delete process.env.READ_DEDUP;
		delete process.env.CTX_REDUNDANCY_NUDGE;
		const offFp = makeFakePi();
		(await import(`../extensions/context-dedup.ts?off=${Date.now()}-${Math.random()}`)).default(offFp.pi as any);
		const messages = [...readPair("r1", "a.ts", fileText), ...readPair("r2", "a.ts", fileText)];
		assert.equal(await fire(offFp, "context", { messages }, {}), undefined, "dark by default");

		// on: returns a transformed view, original array untouched
		process.env.READ_DEDUP = "on";
		const onFp = makeFakePi();
		(await import(`../extensions/context-dedup.ts?on=${Date.now()}-${Math.random()}`)).default(onFp.pi as any);
		const before = structuredClone(messages);
		const result = await fire(onFp, "context", { messages }, {});
		assert.ok(result?.messages, "transformed view returned");
		assert.deepEqual(messages, before, "original array untouched");
		assert.match(JSON.stringify(result.messages), /identical to the result at message/);

		// nudge: fires over threshold, respects cooldown
		process.env.CTX_REDUNDANCY_NUDGE = "on";
		const nudgeFp = makeFakePi();
		(await import(`../extensions/context-dedup.ts?nudge=${Date.now()}-${Math.random()}`)).default(nudgeFp.pi as any);
		(globalThis as Record<string, unknown>).__pi_ctx_redundancy_pct = 80;
		await fire(nudgeFp, "turn_end", { turnIndex: 5 }, {});
		assert.equal(nudgeFp.sent.length, 1, "steer fired over threshold");
		assert.match(nudgeFp.sent[0], /compact_context/);
		assert.equal(nudgeFp.deliveries[0].deliverAs, "steer");
		await fire(nudgeFp, "turn_end", { turnIndex: 7 }, {});
		assert.equal(nudgeFp.sent.length, 1, "cooldown suppresses immediate repeat");
		(globalThis as Record<string, unknown>).__pi_ctx_redundancy_pct = 10;
		await fire(nudgeFp, "turn_end", { turnIndex: 20 }, {});
		assert.equal(nudgeFp.sent.length, 1, "below threshold stays silent");

		// M7: a new session resets the cooldown — turn indices restart at 0,
		// so a stale lastNudgeTurn must not suppress the first nudge.
		(globalThis as Record<string, unknown>).__pi_ctx_redundancy_pct = 80;
		await fire(nudgeFp, "session_start", { reason: "new" }, {});
		await fire(nudgeFp, "turn_end", { turnIndex: 0 }, {});
		assert.equal(nudgeFp.sent.length, 2, "cooldown resets across sessions");
	} finally {
		delete process.env.READ_DEDUP;
		delete process.env.CTX_REDUNDANCY_NUDGE;
		delete process.env.TELEMETRY_FILE;
		delete process.env.TELEMETRY_SOURCE;
		delete (globalThis as Record<string, unknown>).__pi_ctx_redundancy_pct;
		rmSync(dir, { recursive: true, force: true });
	}
});
