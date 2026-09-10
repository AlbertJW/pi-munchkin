import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { summarizePiJsonScreen } from "../lib/pi-json-screen.ts";

test("Pi JSON screen summaries retain tool counts and final-answer digest without retaining content", () => {
	const raw = [
		JSON.stringify({ type: "tool_execution_start", toolName: "bash" }),
		JSON.stringify({ type: "tool_execution_end", toolName: "bash", isError: true, result: { content: [{ type: "text", text: "x".repeat(9001) }] } }),
		JSON.stringify({ type: "agent_end", messages: [{ role: "assistant", content: [{ type: "text", text: "NOISY_RECOVERED" }] }] }),
	].join("\n");
	const summary = summarizePiJsonScreen(raw);
	assert.deepEqual(summary, {
		bash_starts: 1, bash_ends: 1, bash_errors: 1, max_visible_bash_chars: 9001,
		final_text_sha256: createHash("sha256").update("NOISY_RECOVERED").digest("hex"), final_text_bytes: 15,
	});
	assert.equal(JSON.stringify(summary).includes("NOISY_RECOVERED"), false);
});
