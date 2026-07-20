import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildContextSurfaceReceipt, systemPromptReceipt } from "../lib/context-surface.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const baseMessages = () => [
	{ role: "user", content: [{ type: "text", text: "Keep café_id exact and αβ stable" }], timestamp: 1 },
	{ role: "assistant", content: [
		{ type: "text", text: "read one two three four five repeated one two three four five" },
		{ type: "toolCall", id: "r1", name: "read", arguments: { path: "private.txt" } },
	], timestamp: 2 },
	{ role: "toolResult", toolCallId: "r1", toolName: "read", content: [{ type: "text", text: "secret file contents" }], isError: false, timestamp: 3 },
	{ role: "assistant", content: [{ type: "toolCall", id: "e1", name: "edit", arguments: { path: "x.ts" } }], timestamp: 4 },
	{ role: "toolResult", toolCallId: "e1", toolName: "edit", content: [{ type: "text", text: "done" }], isError: false, timestamp: 5 },
	{ role: "custom", customType: "note", content: [{ type: "image", data: Buffer.from("pixels").toString("base64"), mimeType: "image/png" }], timestamp: 6 },
	{ role: "toolResult", toolCallId: "bad", toolName: "bash", content: [{ type: "text", text: "raw exception payload" }], isError: true, timestamp: 7 },
];

test("context receipt is deterministic for Unicode, images, custom messages, tool errors, and mutation boundaries", () => {
	const messages = baseMessages();
	const system = systemPromptReceipt("system π");
	const a = buildContextSurfaceReceipt(messages, system, { tokens: 123, contextWindow: 4096, percent: 3 }, { compactionGeneration: 2, planRunId: "plan-1", planItemId: "item-1" }).receipt;
	const b = buildContextSurfaceReceipt(structuredClone(messages), system, { tokens: 123, contextWindow: 4096, percent: 3 }, { compactionGeneration: 2, planRunId: "plan-1", planItemId: "item-1" }).receipt;
	assert.deepEqual(a, b);
	assert.match(a.surface_sha256, /^[0-9a-f]{64}$/);
	assert.equal(a.image_count, 1);
	assert.equal(a.image_bytes, 6);
	assert.equal(a.compaction_generation, 2);
	assert.ok(a.repeated_five_token_shingle_share > 0);
	assert.ok(a.stale_tool_result_share > 0, "read result before successful edit is stale evidence");
	assert.deepEqual(a.tool_names, [...a.tool_names].sort());
	assert.doesNotMatch(JSON.stringify(a), /secret file contents|private\.txt|raw exception/);
});

test("exact duplicate blocks increase duplicate share and changed content changes the receipt", () => {
	const system = systemPromptReceipt("s");
	const repeated = [{ role: "user", content: [{ type: "text", text: "same block" }, { type: "text", text: "same block" }] }];
	const a = buildContextSurfaceReceipt(repeated, system, undefined).receipt;
	const b = buildContextSurfaceReceipt([{ role: "user", content: [{ type: "text", text: "different" }] }], system, undefined).receipt;
	assert.ok(a.exact_duplicate_block_share > 0);
	assert.notEqual(a.surface_sha256, b.surface_sha256);
	const metadataOnly = structuredClone(repeated);
	(metadataOnly[0] as Record<string, unknown>).customMetadata = { exact: "surface field" };
	assert.notEqual(a.surface_sha256, buildContextSurfaceReceipt(metadataOnly, system, undefined).receipt.surface_sha256,
		"the receipt must bind every provider-visible message field, not only known content blocks");
});

test("read-only bash is not a mutation boundary and largest tool-result share is per result", () => {
	const messages = [
		{ role: "assistant", content: [{ type: "toolCall", id: "r", name: "read", arguments: { path: "a" } }] },
		{ role: "toolResult", toolCallId: "r", toolName: "read", content: [{ type: "text", text: "1234" }], isError: false },
		{ role: "assistant", content: [{ type: "toolCall", id: "b", name: "bash", arguments: { command: "ls" } }] },
		{ role: "toolResult", toolCallId: "b", toolName: "bash", content: [{ type: "text", text: "12" }], isError: false },
		{ role: "toolResult", toolCallId: "r2", toolName: "read", content: [{ type: "text", text: "12" }], isError: false },
	];
	const { receipt } = buildContextSurfaceReceipt(messages, systemPromptReceipt("s"), undefined);
	assert.equal(receipt.stale_tool_result_share, 0, "read-only bash must not create a successful-mutation boundary");
	assert.equal(receipt.largest_tool_result_share, 0.5, "share is the largest individual result, not a per-tool aggregate");
});

test("context extension observes without replacing or mutating the original message array", async () => {
	const dir = mkdtempSync(join(tmpdir(), "context-surface-"));
	const file = join(dir, "events.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = file;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/context-surface.ts?test=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		await fire(fp, "before_agent_start", { systemPrompt: "assembled", prompt: "raw", images: [] }, {});
		const messages = baseMessages();
		const before = structuredClone(messages);
		const result = await fire(fp, "context", { messages }, {
			model: { provider: "test-provider", id: "test-model" },
			getContextUsage: () => ({ tokens: 10, contextWindow: 100, percent: 10 }),
		});
		assert.equal(result, undefined);
		assert.deepEqual(messages, before);
		const row = JSON.parse(readFileSync(file, "utf8").trim());
		assert.equal(row.ext, "context-surface");
		assert.equal(row.kind, "receipt");
		assert.equal(row.source, "test");
		assert.doesNotMatch(JSON.stringify(row), /assembled|raw exception|secret file contents|private\.txt/);
	} finally {
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
		rmSync(dir, { recursive: true, force: true });
	}
});

test("KV-cache invariants: append-only sequences are prefix_stable, mutations and truncations are detected", () => {
	const system = systemPromptReceipt("s");
	const msgs = (texts: string[]) => texts.map((text) => ({ role: "user", content: [{ type: "text", text }] }));
	const first = buildContextSurfaceReceipt(msgs(["a", "b"]), system, undefined);
	assert.equal(first.receipt.prefix_stable, null, "no prior on the first call");
	assert.equal(first.receipt.appended_only, null);
	assert.equal(first.receipt.system_prompt_changed, null);
	const prior = { blockHashes: first.blockHashes, systemSha: system.sha256 };

	const appended = buildContextSurfaceReceipt(msgs(["a", "b", "c"]), system, undefined, {}, prior);
	assert.equal(appended.receipt.prefix_stable, true);
	assert.equal(appended.receipt.appended_only, true);
	assert.equal(appended.receipt.system_prompt_changed, false);

	const mutated = buildContextSurfaceReceipt(msgs(["a", "CHANGED", "c"]), system, undefined, {}, prior);
	assert.equal(mutated.receipt.prefix_stable, false, "an edited early block breaks the cacheable prefix");
	assert.equal(mutated.receipt.appended_only, false);

	const truncated = buildContextSurfaceReceipt(msgs(["a"]), system, undefined, {}, prior);
	assert.equal(truncated.receipt.prefix_stable, true, "the surviving prefix is unchanged");
	assert.equal(truncated.receipt.appended_only, false, "but blocks were removed, not appended");

	const newSystem = systemPromptReceipt("different");
	const swapped = buildContextSurfaceReceipt(msgs(["a", "b"]), newSystem, undefined, {}, prior);
	assert.equal(swapped.receipt.system_prompt_changed, true);
});

test("near-duplicate share: almost-identical large blocks count, exact repeats and small/unrelated blocks do not", () => {
	const system = systemPromptReceipt("s");
	const big = "The quick brown fox jumps over the lazy dog while reading configuration files. ".repeat(8); // ~640 bytes
	const nearCopy = big.replace("lazy dog", "sleepy dog");
	const unrelated = "Completely different content about database migrations and indexes altogether here. ".repeat(8);
	const wrap = (texts: string[]) => texts.map((text) => ({ role: "user", content: [{ type: "text", text }] }));

	const near = buildContextSurfaceReceipt(wrap([big, nearCopy]), system, undefined).receipt;
	assert.ok(near.near_duplicate_block_share > 0, `near-copy must register: ${near.near_duplicate_block_share}`);
	assert.equal(near.exact_duplicate_block_share, 0, "not an exact duplicate");

	const exact = buildContextSurfaceReceipt(wrap([big, big]), system, undefined).receipt;
	assert.equal(exact.near_duplicate_block_share, 0, "exact repeats belong to the exact share only");
	assert.ok(exact.exact_duplicate_block_share > 0);

	const distinct = buildContextSurfaceReceipt(wrap([big, unrelated]), system, undefined).receipt;
	assert.equal(distinct.near_duplicate_block_share, 0);

	const small = buildContextSurfaceReceipt(wrap(["tiny a", "tiny b"]), system, undefined).receipt;
	assert.equal(small.near_duplicate_block_share, 0, "sub-256-byte blocks are ignored");

	const again = buildContextSurfaceReceipt(wrap([big, nearCopy]), system, undefined).receipt;
	assert.deepEqual(near, again, "deterministic");
});
