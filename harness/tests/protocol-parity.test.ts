import assert from "node:assert/strict";
import test from "node:test";
import {
	emptyProtocolObservation, observeAssistantMessage, observeProtocolDelta, summarizeProtocolParity,
} from "../lib/protocol-parity.ts";

test("protocol parity is bounded to declarations and observed stream shape", () => {
	const observation = emptyProtocolObservation();
	observeProtocolDelta(observation, "thinking_delta", "opaque");
	observeProtocolDelta(observation, "toolcall_delta", "{}");
	observeProtocolDelta(observation, "text_delta", "ok");
	observeAssistantMessage(observation, { role: "assistant", content: [{ type: "thinking", thinking: "secret" }, { type: "toolCall", name: "read" }] });
	const summary = summarizeProtocolParity({
		api: "openai-completions", reasoning: true,
		thinkingLevelMap: { low: "low", high: "high" },
		compat: { thinkingFormat: "qwen-chat-template", supportsStrictMode: false },
	}, observation);
	assert.deepEqual(summary, {
		api: "openai-completions", reasoning: "enabled", thinkingFormat: "qwen-chat-template", thinkingLevels: 2,
		strictSampling: "false", streamShape: "thinking+toolcalls", thinkingObserved: true, toolCallsObserved: true,
	});
	assert.equal(JSON.stringify(summary).includes("secret"), false);
});

test("unknown provider metadata fails closed instead of echoing it", () => {
	const secret = "DUMMY_PROTOCOL_SECRET";
	const summary = summarizeProtocolParity({
		api: `https://private.invalid/v1?token=${secret}\ncustom-api`,
		compat: { thinkingFormat: "https://secret.invalid" },
	}, emptyProtocolObservation());
	assert.equal(summary.api, "custom");
	assert.equal(summary.thinkingFormat, "unknown");
	assert.doesNotMatch(JSON.stringify(summary), /DUMMY_PROTOCOL_SECRET|private\.invalid|custom-api/);
});
