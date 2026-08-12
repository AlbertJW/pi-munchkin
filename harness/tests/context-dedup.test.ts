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

test("integration: READ_DEDUP=on transforms the context view and off leaves it alone", async () => {
	const dir = mkdtempSync(join(tmpdir(), "context-dedup-"));
	process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
	process.env.TELEMETRY_SOURCE = "test";
	try {
		// ADOPTED 2026-08-07: READ_DEDUP default-on (was dark candidate c26) —
		// =off kills the handler.
		process.env.READ_DEDUP = "off";
		const offFp = makeFakePi();
		(await import(`../extensions/context-dedup.ts?off=${Date.now()}-${Math.random()}`)).default(offFp.pi as any);
		const messages = [...readPair("r1", "a.ts", fileText), ...readPair("r2", "a.ts", fileText)];
		// Off means the VIEW IS UNCHANGED, not that pi returns nothing: emitContext
		// always yields the (cloned) array regardless of what handlers do. Asserting
		// `undefined` here pinned the old double's shape, not the extension's darkness.
		assert.equal(offFp.handlers.has("context"), false, "READ_DEDUP=off — no handler registered");
		assert.deepEqual(await fire(offFp, "context", { messages }, {}), messages, "view unchanged when off");

		// unset = default-on: returns a transformed view, original array untouched
		delete process.env.READ_DEDUP;
		const onFp = makeFakePi();
		(await import(`../extensions/context-dedup.ts?on=${Date.now()}-${Math.random()}`)).default(onFp.pi as any);
		const before = structuredClone(messages);
		const result = await fire(onFp, "context", { messages }, {});
		// pi's emitContext returns the BARE array (runner.js:771), not {messages}.
		assert.ok(Array.isArray(result), "transformed view returned as a bare array");
		assert.deepEqual(messages, before, "original array untouched");
		assert.match(JSON.stringify(result), /identical to the result at message/);
	} finally {
		delete process.env.READ_DEDUP;
		delete process.env.TELEMETRY_FILE;
		delete process.env.TELEMETRY_SOURCE;
		rmSync(dir, { recursive: true, force: true });
	}
});
