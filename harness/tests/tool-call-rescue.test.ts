import assert from "node:assert/strict";
import test from "node:test";
import { fire, makeFakePi } from "./integration-harness.ts";
import { detectPseudoToolCall, rescueMessage } from "../extensions/tool-call-rescue.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/tool-call-rescue.test.ts

test("detects the measured qwen artifact shapes", () => {
	const qwen = detectPseudoToolCall('<tool_call></tool_call>\n<function=bash>{"command":"ls"}</function>');
	assert.equal(qwen?.signature, "function-tag");
	assert.equal(qwen?.toolName, "bash");

	const bare = detectPseudoToolCall("I will call the tool now: <tool_call>");
	assert.equal(bare?.signature, "tool-call-tag");
	assert.equal(bare?.toolName, null);

	const fenced = detectPseudoToolCall('Here is the call:\n```json\n{"name": "read", "arguments": {"path": "a.ts"}}\n```');
	assert.equal(fenced?.signature, "fenced-json-call");
	assert.equal(fenced?.toolName, "read");
});

test("does not fire on prose, non-call JSON, or ordinary code fences", () => {
	assert.equal(detectPseudoToolCall("I ran the tests and they pass."), null);
	assert.equal(detectPseudoToolCall('```json\n{"status": "ok", "count": 3}\n```'), null);
	assert.equal(detectPseudoToolCall("```js\nconsole.log(1)\n```"), null);
	assert.equal(detectPseudoToolCall(""), null);
});

test("rescue message carries the self-correction instruction and tool name", () => {
	const msg = rescueMessage({ signature: "function-tag", toolName: "bash" });
	assert.match(msg, /not a valid tool call/);
	assert.match(msg, /`bash`/);
	assert.match(msg, /REAL tool call/);
});

test("extension: dark by default; steers at most twice; detection keeps recording", async () => {
	const fp = makeFakePi();
	const sent = fp.sent;
	const prev = process.env.TOOL_CALL_RESCUE;
	try {
		delete process.env.TOOL_CALL_RESCUE;
		const off = await import(`../extensions/tool-call-rescue.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0, "dark by default");

		process.env.TOOL_CALL_RESCUE = "on";
		const on = await import(`../extensions/tool-call-rescue.ts?on=${Date.now()}-${Math.random()}`);
		on.default(fp.pi as never);
		await fire(fp, "session_start", {});
		const pseudo = {
			turnIndex: 1,
			message: { role: "assistant", content: [{ type: "text", text: "<function=bash>ls</function>" }] },
		};
		await fire(fp, "turn_end", pseudo);
		await fire(fp, "turn_end", pseudo);
		await fire(fp, "turn_end", pseudo); // damper: third detection, no steer
		assert.equal(sent.length, 2, "max 2 rescues per session");

		const real = {
			turnIndex: 4,
			message: {
				role: "assistant",
				content: [
					{ type: "text", text: "<tool_call> mentioned in passing" },
					{ type: "toolCall", id: "x", name: "bash", arguments: {} },
				],
			},
		};
		await fire(fp, "turn_end", real);
		assert.equal(sent.length, 2, "real toolCall present — never fires");

		await fire(fp, "session_start", {});
		await fire(fp, "turn_end", pseudo);
		assert.equal(sent.length, 3, "damper resets per session");

		// Now assertable for the first time: the inline fake dropped the options
		// argument, so the rescue's DELIVERY MODE was never checked. A rescue that
		// pi silently drops would revive nothing — the exact class of defect this
		// candidate exists to fix.
		for (const d of fp.deliveries) {
			assert.equal(d.deliverAs, "steer");
			assert.equal(d.effective, "delivered", "a rescue must actually reach the model");
		}
	} finally {
		if (prev === undefined) delete process.env.TOOL_CALL_RESCUE; else process.env.TOOL_CALL_RESCUE = prev;
	}
});
