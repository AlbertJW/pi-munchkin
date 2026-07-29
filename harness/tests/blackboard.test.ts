import assert from "node:assert/strict";
import test from "node:test";
import {
	attemptKey, boardState, emptyState, noteTelemetry, noteTool, renderCockpitHtml,
	renderLens, resetBoard, restore, snapshot,
} from "../lib/blackboard.ts";
import { record } from "../lib/telemetry.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/blackboard.test.ts

function fresh() {
	resetBoard();
	return boardState();
}

test("attempt ledger: counts, errors, labels, delegations", () => {
	const s = fresh();
	s.turn = 3;
	noteTool(s, { toolName: "bash", args: { command: "npm  TEST" }, isError: true, errorText: "1 failing\nstack..." });
	noteTool(s, { toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "1 failing" });
	noteTool(s, { toolName: "read", args: { path: "src/a.ts" }, isError: false });
	noteTool(s, { toolName: "subagent", args: { agent: "executor", mode: "spawn" }, isError: false });
	const bash = s.attempts["bash:npm test"];
	assert.equal(bash.count, 2, "normalized command collapses case/whitespace variants");
	assert.equal(bash.errors, 2);
	assert.equal(bash.lastError, "1 failing", "first line only");
	assert.equal(s.attempts["read:src/a.ts"].errors, 0);
	assert.deepEqual(s.delegations, [{ agent: "executor", mode: "spawn", ok: true, turn: 3 }]);
});

test("attemptKey falls back to sorted-arg blob for unknown tools", () => {
	assert.equal(attemptKey("mytool", { b: 1, a: 2 }), attemptKey("mytool", { a: 2, b: 1 }));
});

test("lens: empty state renders empty; failures lead; clamp respected; deterministic", () => {
	const s = fresh();
	assert.equal(renderLens(s, 1200), "", "no failures, no mutations, no plan → zero surface");
	s.turn = 5;
	noteTool(s, { toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "assert 3 !== 4" });
	noteTool(s, { toolName: "edit", args: { path: "src/x.ts" }, isError: true, errorText: "no match" });
	noteTool(s, { toolName: "edit", args: { path: "src/x.ts" }, isError: true, errorText: "no match" });
	const lens = renderLens(s, 1200);
	assert.match(lens, /^\[session-state/);
	assert.match(lens, /attempted\+failing:/);
	assert.ok(lens.indexOf("edit src/x.ts ×2") < lens.indexOf("bash"), "most-failing first");
	assert.equal(renderLens(s, 1200), lens, "deterministic");
	const clamped = renderLens(s, 200);
	assert.ok(clamped.length <= 200);
});

test("noteTelemetry folds plan gates, context receipts, and compactions", () => {
	const s = fresh();
	noteTelemetry(s, "plan-runner", "gate", { pass: false, fails: 2, run_id: "r1" });
	noteTelemetry(s, "context-surface", "receipt", { context_pct: 41.5, stale_tool_result_share: 0.4, exact_duplicate_block_share: 0.1 });
	noteTelemetry(s, "context-watcher", "compacted", { requester: "pi" });
	assert.deepEqual(s.plan.lastGate, { pass: false, fails: 2 });
	assert.equal(s.plan.runId, "r1");
	assert.equal(s.context.pct, 41.5);
	assert.equal(s.compactions, 1);
});

test("snapshot/restore round-trips through JSON; bad data is ignored", () => {
	const s = fresh();
	noteTool(s, { toolName: "bash", args: { command: "ls" }, isError: false });
	const snap = snapshot(s);
	resetBoard();
	assert.equal(Object.keys(boardState().attempts).length, 0);
	restore(snap);
	assert.equal(boardState().attempts["bash:ls"].count, 1);
	restore({ v: 99, junk: true });
	assert.equal(boardState().attempts["bash:ls"].count, 1, "wrong version ignored");
});

test("telemetry tap: sees events across module instances, and a throwing tap never breaks record()", async () => {
	const g = globalThis as Record<string, unknown>;
	const prevTaps = g.__pi_telemetry_taps;
	const seen: string[] = [];
	try {
		g.__pi_telemetry_taps = [
			() => { throw new Error("bad tap"); },
			(ext: string, kind: string) => { seen.push(`${ext}/${kind}`); },
		];
		const prevTelemetry = process.env.TELEMETRY;
		process.env.TELEMETRY = "off"; // taps must fire even with the sink disabled
		try {
			assert.doesNotThrow(() => record("blackboard", "rendered", { chars: 1, attempts: 0 }));
			const other = await import(`../lib/telemetry.ts?tapinstance=${Date.now()}-${Math.random()}`);
			other.record("blackboard", "restored", { attempts: 2 });
		} finally {
			if (prevTelemetry === undefined) delete process.env.TELEMETRY;
			else process.env.TELEMETRY = prevTelemetry;
		}
		assert.deepEqual(seen, ["blackboard/rendered", "blackboard/restored"]);
	} finally {
		g.__pi_telemetry_taps = prevTaps;
	}
});

test("extension: BLACKBOARD=off registers nothing; STATE_LENS unset registers no context hook", async () => {
	const handlers = new Map<string, unknown>();
	const commands: string[] = [];
	const fakePi = {
		on: (name: string, fn: unknown) => handlers.set(name, fn),
		registerCommand: (name: string) => commands.push(name),
		sendUserMessage: () => {},
		appendEntry: () => {},
	};
	const prevBb = process.env.BLACKBOARD;
	const prevLens = process.env.STATE_LENS;
	try {
		process.env.BLACKBOARD = "off";
		const off = await import(`../extensions/session-blackboard.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fakePi as never);
		assert.equal(handlers.size, 0);
		assert.equal(commands.length, 0);

		delete process.env.BLACKBOARD;
		delete process.env.STATE_LENS;
		const on = await import(`../extensions/session-blackboard.ts?on=${Date.now()}-${Math.random()}`);
		on.default(fakePi as never);
		assert.ok(handlers.has("turn_end"));
		assert.ok(!handlers.has("context"), "lens dark by default — no context hook at all");

		handlers.clear();
		process.env.STATE_LENS = "view";
		const lens = await import(`../extensions/session-blackboard.ts?lens=${Date.now()}-${Math.random()}`);
		lens.default(fakePi as never);
		assert.ok(handlers.has("context"), "STATE_LENS=view registers the view hook");
	} finally {
		if (prevBb === undefined) delete process.env.BLACKBOARD; else process.env.BLACKBOARD = prevBb;
		if (prevLens === undefined) delete process.env.STATE_LENS; else process.env.STATE_LENS = prevLens;
	}
});

test("lens view hook appends a tail block only when the lens is non-empty", async () => {
	const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
	const fakePi = {
		on: (name: string, fn: never) => handlers.set(name, fn),
		registerCommand: () => {},
		sendUserMessage: () => {},
		appendEntry: () => {},
	};
	const prevLens = process.env.STATE_LENS;
	process.env.STATE_LENS = "view";
	try {
		const mod = await import(`../extensions/session-blackboard.ts?viewhook=${Date.now()}-${Math.random()}`);
		mod.default(fakePi as never);
		const hook = handlers.get("context")!;
		resetBoard();
		const emptyMessages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
		assert.equal(await hook({ messages: emptyMessages }, {}), undefined, "empty board → untouched view");
		assert.equal(emptyMessages[0].content.length, 1);

		const s = boardState();
		s.turn = 4;
		noteTool(s, { toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "fail" });
		const messages = [{ role: "user", content: [{ type: "text", text: "hi" }] }];
		const out = (await hook({ messages }, {})) as { messages: typeof messages };
		const tail = out.messages[0].content.at(-1)!;
		assert.match(tail.text, /session-state/);
	} finally {
		if (prevLens === undefined) delete process.env.STATE_LENS; else process.env.STATE_LENS = prevLens;
		resetBoard();
	}
});

test("cockpit HTML escapes hostile labels", () => {
	const s = fresh();
	noteTool(s, { toolName: "bash", args: { command: "<script>alert(1)</script>" }, isError: true, errorText: "<img onerror=x>" });
	const html = renderCockpitHtml(s, { cwd: "/tmp/x", renderedAt: "now" });
	assert.ok(!html.includes("<script>alert"));
	assert.ok(!html.includes("<img onerror"));
});
