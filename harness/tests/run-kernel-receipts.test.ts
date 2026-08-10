import assert from "node:assert/strict";
import test from "node:test";
import { boundedReceiptText, ReceiptNormalizerV1, resultPayloadBytes } from "../lib/run-kernel-receipts.ts";

const SURFACE = "a".repeat(64);

function normalizer(gate: string | null = "npm test") {
	return new ReceiptNormalizerV1({
		surfaceHash: () => SURFACE,
		detectedGate: () => gate,
		planItemId: () => "item-private-name",
	});
}

function result(call = "c1", tool = "bash", input: Record<string, unknown> = { command: "npm test" }) {
	return {
		type: "tool_result" as const, toolCallId: call, toolName: tool, input,
		content: [{ type: "text" as const, text: "ok" }], details: {}, isError: false,
	};
}

test("normalizer emits one canonical receipt from start, result, and end", () => {
	const n = normalizer();
	const start = n.start({ toolCallId: "c1", toolName: "bash", args: { command: "npm test" } }, 2, 20);
	assert.equal(start?.verification, "project_gate");
	n.noteToolResult(result(), 3, 30);
	const receipt = n.finish({
		toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "passed" }] }, isError: false,
	}, 4, 40);
	assert.equal(receipt?.status, "succeeded");
	assert.equal(receipt?.hadStart, true);
	assert.equal(receipt?.hadToolResult, true);
	assert.equal(receipt?.resultBytes, 6);
	assert.equal(n.finish({ toolCallId: "c1", toolName: "bash", result: {}, isError: false }, 5, 50), null);
});

test("validation rejection without tool_result remains an observable failure", () => {
	const n = normalizer(null);
	n.start({ toolCallId: "bad", toolName: "plan_write", args: { plan: "sensitive" } }, 1, 1);
	const receipt = n.finish({
		toolCallId: "bad", toolName: "plan_write",
		result: { content: [{ type: "text", text: "schema validation failed for secret" }] }, isError: true,
	}, 2, 2);
	assert.equal(receipt?.status, "rejected");
	assert.equal(receipt?.failureClass, "schema_validation");
	assert.equal(receipt?.hadToolResult, false);
	assert.equal(JSON.stringify(receipt).includes("sensitive"), false);
	assert.equal(JSON.stringify(receipt).includes("secret"), false);
});

test("missing start/result facts are explicit and successful output text is not retained", () => {
	const n = normalizer(null);
	const input = { path: "/Users/private/project/secret.txt" };
	n.noteToolResult(result("read-1", "read", input), 7, 70);
	const receipt = n.finish({
		toolCallId: "read-1", toolName: "read",
		result: { content: [{ type: "text", text: "FAILED record with dummy signed token" }] }, isError: false,
	}, 8, 80);
	assert.equal(receipt?.status, "succeeded");
	assert.equal(receipt?.hadStart, false);
	assert.equal(receipt?.failureClass, null);
	const encoded = JSON.stringify(receipt);
	assert.equal(encoded.includes("/Users/private"), false);
	assert.equal(encoded.includes("dummy signed token"), false);
	assert.equal(resultPayloadBytes({ content: [{ text: "abc" }, { data: "de" }], details: { secret: "never" } }), 5);
});

test("mutating and verification classifications use the shared command policy", () => {
	const n = normalizer("npm test");
	assert.equal(n.start({ toolCallId: "m", toolName: "bash", args: { command: "sed -i '' s/a/b/ src.ts" } }, 1, 1)?.mutation, "source");
	assert.equal(n.start({ toolCallId: "wrong", toolName: "bash", args: { command: "tsc --noEmit" } }, 2, 2)?.verification, "none");
	assert.equal(n.start({ toolCallId: "right", toolName: "bash", args: { command: "npm test" } }, 3, 3)?.verification, "project_gate");
});

test("failure text reader exits at its prefix bound without touching later blocks", () => {
	const later = {} as { type?: string };
	Object.defineProperty(later, "type", { get: () => { throw new Error("read past bound"); } });
	const text = boundedReceiptText({ content: [{ type: "text", text: "x".repeat(4096) }, later] }, 2048);
	assert.equal(text.length, 2048);
	assert.equal(text, "x".repeat(2048));
});
