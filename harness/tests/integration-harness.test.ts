import assert from "node:assert/strict";
import test from "node:test";
import {
	EVENT_STRATEGY, TEST_EXTENSION_PATH, callTool, callToolRaw, fire, makeFakePi, resetPiGlobals,
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
	assert.ok(Array.isArray(out), "context returns the BARE array, not {messages} (runner.js:771)");
	assert.equal(out.length, 3, "both context handlers compose");
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

test("callTool fires the tool_result chain on BOTH the return and throw paths", async () => {
	// pi runs finalizeExecutedToolCall after execute() settles either way, so a
	// tool_result observer must be reachable through a normal tool call. Omitting
	// this made plan-runner's write-rejected observer unreachable except by
	// hand-firing an event pi may never emit.
	const seen: Array<{ isError: boolean; name: string }> = [];
	const fp = makeFakePi();
	fp.pi.registerTool({ name: "ok", execute: async () => ({ content: [{ type: "text", text: "fine" }] }) } as never);
	fp.pi.registerTool({ name: "bad", execute: async () => { throw new Error("nope"); } } as never);
	fp.pi.on("tool_result", async (e: any) => { seen.push({ isError: e.isError, name: e.toolName }); });

	await callTool(fp, "ok", {}, "/tmp");
	await callTool(fp, "bad", {}, "/tmp");
	assert.deepEqual(seen, [{ isError: false, name: "ok" }, { isError: true, name: "bad" }]);
});

// ---------------------------------------------------------------------------
// Second adversarial pass (2026-07-30). Everything below pins a contract the
// double had backwards. None of these failed before the fix by accident — they
// were unreachable from production code, which is exactly why they were wrong
// for a whole review cycle. They are traps disarmed, not bugs caught.
// ---------------------------------------------------------------------------

test("D1: a throwing handler is SWALLOWED and the event proceeds (every emitter but tool_call)", async () => {
	// runner.js wraps the handler in try/catch → emitError → continue in emit,
	// emitToolResult, emitContext, emitMessageEnd, emitBeforeAgentStart,
	// emitInput, emitResourcesDiscover, emitUserBash, emitBeforeProviderRequest.
	// The double propagated instead, so a throwing hint handler made callTool
	// itself reject — "the tool broke" where pi says "the handler was skipped".
	const fp = makeFakePi();
	fp.pi.registerTool({ name: "t", execute: async () => ({ content: [{ type: "text", text: "ok" }] }) } as never);
	fp.pi.on("tool_result", async () => { throw new Error("hint handler exploded"); });
	fp.pi.on("tool_result", async (e: any) => ({ content: [...e.content, { type: "text", text: "later-handler-still-ran" }] }));

	const r = await callTool(fp, "t", {}, "/tmp");
	assert.equal(r.isError, false, "a broken observer must not fail the tool");
	assert.deepEqual(r.content.map((c: any) => c.text), ["ok", "later-handler-still-ran"]);
	assert.match(fp.swallowedErrors[0], /hint handler exploded/, "raised and dropped, recoverable for assertions");

	// context is the same rule, and the surviving handler still composes.
	const c = makeFakePi();
	c.pi.on("context", async () => { throw new Error("lens exploded"); });
	c.pi.on("context", async (e: any) => ({ messages: [...e.messages, { role: "user", content: "survived" }] }));
	const out: any = await fire(c, "context", { messages: [] });
	assert.equal(out.length, 1);
	assert.match(c.swallowedErrors[0], /lens exploded/);
});

test("D2: callTool fires the FULL emitted shape — type and usage included", async () => {
	// A handler guarding `event.type === "tool_result"` — the habit every other pi
	// event teaches — was a silent no-op through the double while working live.
	const fp = makeFakePi();
	fp.pi.registerTool({ name: "t", execute: async () => ({ content: [], usage: { in: 1 } }) } as never);
	let seen: any;
	fp.pi.on("tool_result", async (e: any) => {
		seen = { type: e.type, usage: e.usage }; // snapshot: `e` is pi's ONE mutating event
		if (e.type !== "tool_result") return undefined; // the realistic guard
		return { usage: { in: 1, patched: true } };
	});
	const r = await callTool(fp, "t", {}, "/tmp");
	assert.equal(seen.type, "tool_result");
	assert.deepEqual(seen.usage, { in: 1 }, "the tool's usage reaches the handler");
	assert.deepEqual(r.usage, { in: 1, patched: true }, "and a usage patch reaches the caller (LOOP:498)");
});

test("D2: content is normalized AFTER the chain, so push() on a missing array throws as pi does", async () => {
	const fp = makeFakePi();
	fp.pi.registerTool({ name: "t", execute: async () => ({ details: { only: "details" } }) } as never);
	fp.pi.on("tool_result", async (e: any) => { e.content.push({ type: "text", text: "boom" }); });
	const r = await callTool(fp, "t", {}, "/tmp");
	assert.match(fp.swallowedErrors[0] ?? "", /push/, "pi throws here too; normalizing first would forgive it");
	assert.deepEqual(r.content, [], "and the caller still gets the normalized empty array");
});

test("D3: sendMessage without triggerTurn is APPENDED, and no turn runs", async () => {
	const fp = makeFakePi();
	fp.pi.sendMessage({ content: "note" });
	assert.equal(fp.customDeliveries[0].effective, "appended-no-turn",
		"SESSION:1089-1094 pushes to state.messages and runs no turn — collapsing this into 'delivered' made the branch untestable");
	fp.pi.sendMessage({ content: "go" }, { triggerTurn: 1 as never });
	assert.equal(fp.customDeliveries[1].effective, "delivered", "SESSION:1086 tests truthiness, not === true");
});

test("D4: sendUserMessage uses prompt()'s ladder — nextTurn is NOT special there", async () => {
	// SESSION:1126-1131 maps deliverAs -> streamingBehavior and never passes
	// triggerTurn or touches _pendingNextTurnMessages. Sharing classify() between
	// the two APIs was wrong in OPPOSITE directions.
	const idle = makeFakePi();
	idle.pi.sendUserMessage("x", { deliverAs: "nextTurn" });
	assert.equal(idle.deliveries[0].effective, "delivered", "idle: prompt() always runs a turn (SESSION:1097)");

	const busy = makeFakePi({ streaming: true });
	busy.pi.sendUserMessage("x", { deliverAs: "nextTurn" });
	assert.equal(busy.deliveries[0].effective, "queued-steer", "streaming: anything not followUp steers");
});

test("D5: a tool_result return that sets no known field leaves the event unmodified", async () => {
	const fp = makeFakePi();
	fp.pi.on("tool_result", async () => ({}));
	assert.equal(await fire(fp, "tool_result", { toolName: "t", content: [] }), undefined,
		"runner.js:659-674 sets `modified` inside each field block, not on any truthy return");
});

test("D6: an input transform omitting text WIPES it; images fall back to current", async () => {
	const fp = makeFakePi();
	fp.pi.on("input", async () => ({ action: "transform", images: ["img"] }));
	const out: any = await fire(fp, "input", { text: "original", images: undefined });
	assert.equal(out.text, undefined, "runner.js:947 assigns text unconditionally — a real prompt-wipe hazard");
	assert.deepEqual(out.images, ["img"]);

	const keep = makeFakePi();
	keep.pi.on("input", async (e: any) => ({ action: "transform", text: `${e.text}!` }));
	const out2: any = await fire(keep, "input", { text: "hi", images: ["keep-me"] });
	assert.deepEqual(out2.images, ["keep-me"], "runner.js:948 uses `?? currentImages`");
});

test("D7: resources_discover paths come back TAGGED, not bare", async () => {
	const fp = makeFakePi();
	fp.pi.on("resources_discover", async () => ({ skillPaths: ["/s/a.md"] }));
	const out: any = await fire(fp, "resources_discover", {});
	assert.deepEqual(out.skillPaths, [{ path: "/s/a.md", extensionPath: TEST_EXTENSION_PATH }],
		"runner.js:903 maps every path to {path, extensionPath}; consumers never see bare strings");
});

test("D8: before_agent_start drops a FALSY message and honours a no-op prompt rewrite", async () => {
	const fp = makeFakePi();
	fp.pi.on("before_agent_start", async () => ({ message: "" }));
	assert.equal(await fire(fp, "before_agent_start", { systemPrompt: "base" }), undefined,
		"runner.js:859 pushes on truthiness, so an empty message is not a modification");

	const noop = makeFakePi();
	noop.pi.on("before_agent_start", async (e: any) => ({ systemPrompt: e.systemPrompt }));
	const out: any = await fire(noop, "before_agent_start", { systemPrompt: "base" });
	assert.equal(out.systemPrompt, "base",
		"runner.js:862-865 flags the rewrite rather than comparing values — rewriting to the same string still counts");
	assert.equal(out.messages, undefined, "both keys present, the untouched one undefined (runner.js:880-885)");
});

test("M1: a throwing pi.events subscriber cannot break emit or starve later subscribers", async () => {
	// event-bus.js:9-17 wraps every subscriber in an async safeHandler. The double
	// looped naked — D1's bug class in a second subsystem, which both lenses missed.
	const fp = makeFakePi();
	const ran: string[] = [];
	fp.pi.events.on("ch", () => { ran.push("first"); throw new Error("tap exploded"); });
	fp.pi.events.on("ch", () => { ran.push("second"); });
	assert.doesNotThrow(() => fp.pi.events.emit("ch", {}));
	assert.deepEqual(ran, ["first", "second"]);
	assert.match(fp.swallowedErrors[0], /tap exploded/);
});

test("M2: before_provider_headers hands one SHARED object to mutate, and returns it", async () => {
	// Missing from EVENT_STRATEGY entirely, so it fell to `discard` and returned
	// undefined — the same silent-shape trap as D7, one event over.
	const fp = makeFakePi();
	fp.pi.on("before_provider_headers", async (e: any) => { e.headers["x-a"] = "1"; });
	fp.pi.on("before_provider_headers", async (e: any) => {
		assert.equal(e.headers["x-a"], "1", "handler 2 sees handler 1's mutation");
		e.headers["x-b"] = "2";
		return { headers: { ignored: true } }; // runner.js:806-833 ignores the return
	});
	const out: any = await fire(fp, "before_provider_headers", { headers: { "x-base": "0" } });
	assert.deepEqual(out, { "x-base": "0", "x-a": "1", "x-b": "2" });
});

test("M4: `sent` records BOTH apis, so sent-based assertions are not blind to sendMessage", async () => {
	const fp = makeFakePi();
	fp.pi.sendUserMessage("from-user-api");
	fp.pi.sendMessage({ content: "from-custom-api" }, { triggerTurn: true });
	assert.deepEqual(fp.sent, ["from-user-api", "from-custom-api"]);
});

test("a tool_result handler's patch reaches the caller of callTool", async () => {
	const fp = makeFakePi();
	fp.pi.registerTool({ name: "t", execute: async () => ({ content: [{ type: "text", text: "raw" }] }) } as never);
	fp.pi.on("tool_result", async (e: any) => ({ content: [...e.content, { type: "text", text: "appended" }] }));
	const r = await callTool(fp, "t", {}, "/tmp");
	assert.deepEqual(r.content.map((c: any) => c.text), ["raw", "appended"]);
});
