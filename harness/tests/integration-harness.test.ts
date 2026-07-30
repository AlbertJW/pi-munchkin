import assert from "node:assert/strict";
import test from "node:test";
import {
	EVENT_STRATEGY, callTool, callToolRaw, fire, makeFakePi, resetPiGlobals,
} from "./integration-harness.ts";

// The double judges every other suite, so it must itself be provably faithful to
// pi 0.83. Each test below pins one cited contract. If pi changes, these fail
// first — which is the point.

function toolFp(execute: (...a: any[]) => any) {
	const fp = makeFakePi();
	fp.pi.registerTool({ name: "t", execute } as never);
	return fp;
}

test("C1.1: a returned isError NEVER marks a tool failed (DOC:1959)", async () => {
	const fp = toolFp(async () => ({ content: [{ type: "text", text: "nope" }], isError: true, details: { a: 1 } }));
	const r = await callTool(fp, "t", {}, "/tmp");
	assert.equal(r.isError, false, "pi hard-codes isError:false on the return path (LOOP:466)");
	assert.deepEqual(r.details, { a: 1 }, "details pass through unchanged on success");
});

test("C1.2: a THROW yields message-as-content, empty details, isError true", async () => {
	const fp = toolFp(async () => { throw new Error("rejected: fix the deps"); });
	const r = await callTool(fp, "t", {}, "/tmp");
	assert.equal(r.isError, true);
	assert.deepEqual(r.content, [{ type: "text", text: "rejected: fix the deps" }]);
	assert.deepEqual(r.details, {}, "the tool's own details are LOST on throw (LOOP:515-520)");
});

test("C1.4: missing content normalizes to [] (LOOP:530-543)", async () => {
	const fp = toolFp(async () => ({ details: { only: "details" } }));
	assert.deepEqual((await callTool(fp, "t", {}, "/tmp")).content, []);
	// callToolRaw is the escape hatch and must NOT normalize.
	assert.equal((await callToolRaw(fp, "t", {}, "/tmp")).content, undefined);
});

test("C2.2: nextTurn is checked before streaming and ignores triggerTurn", () => {
	const fp = makeFakePi();
	fp.pi.sendMessage({ content: "x" }, { deliverAs: "nextTurn", triggerTurn: true });
	assert.equal(fp.customDeliveries[0].effective, "queued-next-turn",
		"triggerTurn is ignored for nextTurn — the compact-tool defect");
	fp.setStreaming(true);
	fp.pi.sendMessage({ content: "y" }, { deliverAs: "nextTurn", triggerTurn: true });
	assert.equal(fp.customDeliveries[1].effective, "queued-next-turn", "nextTurn wins even while streaming");
});

test("C2.2: while streaming, anything that is not followUp becomes steer", () => {
	const fp = makeFakePi({ streaming: true });
	fp.pi.sendMessage({ content: "a" }, { deliverAs: "followUp" });
	fp.pi.sendMessage({ content: "b" }, { deliverAs: "steer" });
	fp.pi.sendMessage({ content: "c" }, { deliverAs: "not-a-real-mode" });
	assert.deepEqual(fp.customDeliveries.map((d) => d.effective),
		["queued-follow-up", "queued-steer", "queued-steer"]);
});

test("C2.4/C2.5: sendUserMessage while streaming without deliverAs is LOST, silently", () => {
	const fp = makeFakePi({ streaming: true });
	assert.doesNotThrow(() => fp.pi.sendUserMessage("please continue"),
		"pi swallows this into emitError; the extension never sees it");
	assert.equal(fp.deliveries[0].effective, "lost");
	assert.equal(fp.sent.length, 0, "a lost message must not appear as sent");
	assert.match(fp.swallowedErrors[0], /Specify streamingBehavior/);
});

test("tool_result CHAINS: handler 2 sees handler 1's patched content (DOC:820-823)", async () => {
	const fp = makeFakePi();
	fp.pi.on("tool_result", async (e: any) => ({ content: [...e.content, { type: "text", text: "hint-A" }] }));
	fp.pi.on("tool_result", async (e: any) => ({ content: [...e.content, { type: "text", text: "hint-B" }] }));
	const out: any = await fire(fp, "tool_result", { toolName: "bash", content: [{ type: "text", text: "out" }] });
	assert.deepEqual(out.content.map((c: any) => c.text), ["out", "hint-A", "hint-B"],
		"both hints survive — the old first-wins double could never show this");
});

test("tool_result: a later wholesale replacement ERASES earlier patches", async () => {
	const fp = makeFakePi();
	fp.pi.on("tool_result", async (e: any) => ({ content: [...e.content, { type: "text", text: "hint" }] }));
	fp.pi.on("tool_result", async () => ({ content: [{ type: "text", text: "[withheld]" }], isError: true }));
	const out: any = await fire(fp, "tool_result", { toolName: "bash", content: [{ type: "text", text: "huge" }] });
	assert.deepEqual(out.content, [{ type: "text", text: "[withheld]" }]);
	assert.equal(out.isError, true, "isError IS patchable from tool_result (TYPES:790-795)");
});

test("tool_result: terminate is NOT patchable (C1.5)", async () => {
	const fp = makeFakePi();
	fp.pi.on("tool_result", async () => ({ content: [], terminate: true } as never));
	const out: any = await fire(fp, "tool_result", { toolName: "t", content: [] });
	assert.equal(out.terminate, undefined);
});

test("context CHAINS and the caller's array is never mutated", async () => {
	const fp = makeFakePi();
	fp.pi.on("context", async (e: any) => ({ messages: [...e.messages, { role: "user", content: "one" }] }));
	fp.pi.on("context", async (e: any) => ({ messages: [...e.messages, { role: "user", content: "two" }] }));
	const original = [{ role: "user", content: "orig" }];
	const out: any = await fire(fp, "context", { messages: original });
	assert.equal(out.messages.length, 3, "both context handlers compose");
	assert.equal(original.length, 1, "input is structuredCloned (RUNNER:746)");
});

test("before_agent_start ACCUMULATES messages and CHAINS systemPrompt", async () => {
	const fp = makeFakePi();
	fp.pi.on("before_agent_start", async (e: any) => ({ systemPrompt: `${e.systemPrompt}+brief`, message: "m1" }));
	fp.pi.on("before_agent_start", async (e: any) => {
		assert.equal(e.systemPrompt, "base+brief", "handler 2 sees the chained prompt (DOC:556)");
		return { systemPrompt: `${e.systemPrompt}+more`, message: "m2" };
	});
	const out: any = await fire(fp, "before_agent_start", { systemPrompt: "base" });
	assert.equal(out.systemPrompt, "base+brief+more");
	assert.deepEqual(out.messages, ["m1", "m2"], "messages append, they do not overwrite");
});

test("tool_call is LAST-wins with block short-circuit, and throws propagate (C3.2)", async () => {
	const fp = makeFakePi();
	const ran: string[] = [];
	fp.pi.on("tool_call", async () => { ran.push("a"); return { block: false, reason: "soft" }; });
	fp.pi.on("tool_call", async () => { ran.push("b"); return { block: true, reason: "hard" }; });
	fp.pi.on("tool_call", async () => { ran.push("c"); return undefined; });
	const out: any = await fire(fp, "tool_call", { toolName: "bash" });
	assert.deepEqual(out, { block: true, reason: "hard" });
	assert.deepEqual(ran, ["a", "b"], "block short-circuits before later handlers");

	const thrower = makeFakePi();
	thrower.pi.on("tool_call", async () => { throw new Error("guard exploded"); });
	thrower.pi.on("tool_call", async () => ({ block: false }));
	await assert.rejects(() => fire(thrower, "tool_call", {}), /guard exploded/,
		"pi does not catch tool_call throws — they block the call (fail-safe)");
});

test("discard-strategy events run EVERY handler and return nothing", async () => {
	const fp = makeFakePi();
	const ran: string[] = [];
	fp.pi.on("turn_end", async () => { ran.push("first"); return { pretend: "patch" }; });
	fp.pi.on("turn_end", async () => { ran.push("second"); });
	assert.equal(await fire(fp, "turn_end", {}), undefined);
	assert.deepEqual(ran, ["first", "second"],
		"the old double stopped at the first non-undefined return, skipping the rest");
	assert.equal(EVENT_STRATEGY.turn_end, "discard");
});

test("resetPiGlobals clears the cross-extension bus", () => {
	(globalThis as Record<string, unknown>).__pi_test_marker = 1;
	resetPiGlobals();
	assert.equal((globalThis as Record<string, unknown>).__pi_test_marker, undefined);
});
