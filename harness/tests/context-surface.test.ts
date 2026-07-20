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
	const a = buildContextSurfaceReceipt(messages, system, { tokens: 123, contextWindow: 4096, percent: 3 }, { compactionGeneration: 2, planRunId: "plan-1", planItemId: "item-1" });
	const b = buildContextSurfaceReceipt(structuredClone(messages), system, { tokens: 123, contextWindow: 4096, percent: 3 }, { compactionGeneration: 2, planRunId: "plan-1", planItemId: "item-1" });
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
	const a = buildContextSurfaceReceipt(repeated, system, undefined);
	const b = buildContextSurfaceReceipt([{ role: "user", content: [{ type: "text", text: "different" }] }], system, undefined);
	assert.ok(a.exact_duplicate_block_share > 0);
	assert.notEqual(a.surface_sha256, b.surface_sha256);
	const metadataOnly = structuredClone(repeated);
	(metadataOnly[0] as Record<string, unknown>).customMetadata = { exact: "surface field" };
	assert.notEqual(a.surface_sha256, buildContextSurfaceReceipt(metadataOnly, system, undefined).surface_sha256,
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
	const receipt = buildContextSurfaceReceipt(messages, systemPromptReceipt("s"), undefined);
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
