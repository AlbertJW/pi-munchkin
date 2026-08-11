import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	attemptKey, boardState, emptyState, noteHarnessSignal, noteTool, renderCockpitHtml,
	renderLens, resetBoard, restore, snapshot,
} from "../lib/blackboard.ts";
import { emitHarnessSignal, onHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

// Run: cd ~/.pi/agent && TELEMETRY_FILE=$(mktemp) TELEMETRY_SOURCE=test \
//        npx -y tsx --test tests/blackboard.test.ts
// (TELEMETRY_FILE is not optional: without it these tests append REAL rows to
//  ~/.pi/agent/telemetry/events.jsonl tagged source=\"interactive\", polluting the
//  live telemetry stream the harness is measured from.)

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
	const bash = s.attempts[attemptKey("bash", { command: "npm test" })];
	assert.equal(bash.count, 2, "normalized command collapses case/whitespace variants");
	assert.equal(bash.errors, 2);
	assert.equal(bash.lastError, "1 failing", "first line only");
	assert.equal(s.attempts[attemptKey("read", { path: "src/a.ts" })].errors, 0);
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

test("typed signals fold plan gates, context receipts, and compactions", () => {
	const s = fresh();
	const runIdHash = signalRunId("r1");
	noteHarnessSignal(s, { v: 1, type: "plan/gate", pass: false, fails: 2, runIdHash, gateHash: null });
	noteHarnessSignal(s, { v: 1, type: "context/receipt", contextPct: 41.5, staleShare: 0.4, duplicateShare: 0.1 });
	noteHarnessSignal(s, { v: 1, type: "context/compacted" });
	assert.deepEqual(s.plan.lastGate, { pass: false, fails: 2 });
	assert.equal(s.plan.runId, runIdHash);
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
	assert.equal(boardState().attempts[attemptKey("bash", { command: "ls" })].count, 1);
	restore({ v: 99, junk: true });
	assert.equal(boardState().attempts[attemptKey("bash", { command: "ls" })].count, 1, "wrong version ignored");
});

test("v2 snapshots redact ledgers and v1 restore intentionally drops them", () => {
	const s = fresh();
	noteTool(s, { toolName: "bash", args: { command: "curl https://private.invalid API_KEY=dummy-secret-value" }, isError: true, errorText: "API_KEY=dummy-secret-value failed at /Users/private/work/x" });
	const encoded = JSON.stringify(snapshot(s));
	const surfaces = [encoded, renderLens(s, 1200), renderCockpitHtml(s, { cwd: "/Users/private/secret-project", renderedAt: "now" })].join("\n");
	assert.equal(surfaces.includes("dummy-secret-value"), false);
	assert.equal(surfaces.includes("private.invalid"), false);
	assert.equal(surfaces.includes("/Users/private"), false);
	assert.match(Object.keys(s.attempts)[0], /^[a-f0-9]{64}$/);
	restore({ v: 1, turn: 9, compactions: 2, attempts: { raw: { label: "secret", count: 1 } }, delegations: [{ agent: "raw" }], plan: { runId: "r1", itemId: null, lastGate: null, openItems: 2 }, context: { pct: 40, staleShare: null, dupShare: null } });
	assert.deepEqual(boardState().attempts, {});
	assert.deepEqual(boardState().delegations, []);
	assert.equal(boardState().plan.openItems, 2);
});

test("typed domain signals remain live when telemetry is disabled", () => {
	const fp = makeFakePi();
	const seen: string[] = [];
	onHarnessSignal(fp.pi.events as never, (signal) => seen.push(signal.type));
	const previous = process.env.TELEMETRY;
	process.env.TELEMETRY = "off";
	try {
		emitHarnessSignal(fp.pi.events as never, { v: 1, type: "context/compacted" });
	} finally {
		if (previous === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previous;
	}
	assert.deepEqual(seen, ["context/compacted"]);
});

test("extension: BLACKBOARD=off registers nothing; default steer lens performs no per-call context mutation", async () => {
	const fp = makeFakePi();
	const prevBb = process.env.BLACKBOARD;
	const prevLens = process.env.STATE_LENS;
	try {
		process.env.BLACKBOARD = "off";
		const off = await import(`../extensions/session-blackboard.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0);
		assert.equal(fp.commands.size, 0);

		delete process.env.BLACKBOARD;
		delete process.env.STATE_LENS;
		const on = await import(`../extensions/session-blackboard.ts?on=${Date.now()}-${Math.random()}`);
		on.default(fp.pi as never);
		assert.ok(fp.handlers.has("turn_end"));
		assert.ok(!fp.handlers.has("context"), "default steer mode has no per-call context hook");

		fp.handlers.clear();
		process.env.STATE_LENS = "off";
		const lensOff = await import(`../extensions/session-blackboard.ts?lensoff=${Date.now()}-${Math.random()}`);
		lensOff.default(fp.pi as never);
		assert.ok(fp.handlers.has("turn_end"), "cockpit still runs with the lens killed");
		assert.ok(!fp.handlers.has("context"), "STATE_LENS=off is the kill switch — no context hook");

		fp.handlers.clear();
		process.env.STATE_LENS = "view";
		const lens = await import(`../extensions/session-blackboard.ts?lens=${Date.now()}-${Math.random()}`);
		lens.default(fp.pi as never);
		assert.ok(fp.handlers.has("context"), "explicit STATE_LENS=view still registers the view hook");
	} finally {
		if (prevBb === undefined) delete process.env.BLACKBOARD; else process.env.BLACKBOARD = prevBb;
		if (prevLens === undefined) delete process.env.STATE_LENS; else process.env.STATE_LENS = prevLens;
	}
});

test("lens view hook appends a tail block only when the lens is non-empty", async () => {
	const fp = makeFakePi();
	const prevLens = process.env.STATE_LENS;
	process.env.STATE_LENS = "view";
	try {
		const mod = await import(`../extensions/session-blackboard.ts?viewhook=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const hook = fp.handlers.get("context")![0];
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

test("cockpit is atomically rendered outside the project with private permissions", async () => {
	const project = mkdtempSync(join(tmpdir(), "bb-project-"));
	const agent = mkdtempSync(join(tmpdir(), "bb-agent-"));
	const previous = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = agent;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/session-blackboard.ts?private=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", { reason: "new" }, { cwd: project, sessionManager: { getBranch: () => [] } });
		await fire(fp, "agent_end", {}, {});
		assert.equal(existsSync(join(agent, "artifacts", "session-cockpits")), false,
			"agent_end may be followed by retry or compaction and is not final");
		await fire(fp, "agent_settled", {}, {});
		const dir = join(agent, "artifacts", "session-cockpits");
		const files = readdirSync(dir);
		assert.equal(files.length, 1);
		assert.match(files[0], /^[a-f0-9]{64}\.html$/);
		assert.equal(statSync(join(dir, files[0])).mode & 0o777, 0o600);
		assert.equal(existsSync(join(project, "artifacts")), false);
		assert.equal(readFileSync(join(dir, files[0]), "utf8").includes(project), false, "absolute cwd is not persisted");
	} finally {
		if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous;
	}
});

test("resume/fork ALWAYS resets before restoring — no cross-session ledger bleed", async () => {
	// The board lives on globalThis. A resume whose snapshot is missing must not
	// inherit the previous session's ledger, or the state lens would present
	// another session's attempts as this session's ground truth.
	const fp = makeFakePi();
	const prev = process.env.BLACKBOARD;
	delete process.env.BLACKBOARD;
	try {
		const mod = await import(`../extensions/session-blackboard.ts?bleed=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		// Session A leaves state behind (start from a known board — the store is
		// process-global, so sibling tests in this file share it).
		resetBoard();
		const stale = boardState();
		stale.turn = 7;
		noteTool(stale, { toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "session A failure" });
		assert.equal(Object.keys(boardState().attempts).length, 1);

		// Session B resumes; the branch carries no blackboard entry.
		await fire(fp, "session_start", 
			{ reason: "resume" },
			{ cwd: process.cwd(), sessionManager: { getBranch: () => [] } },
		);
		assert.deepEqual(boardState().attempts, {}, "stale ledger must not survive into the resumed session");
		assert.equal(boardState().turn, 0);
	} finally {
		if (prev === undefined) delete process.env.BLACKBOARD; else process.env.BLACKBOARD = prev;
		resetBoard();
	}
});

test("lens steer skips abort/shutdown proposals — hard stops must not be fought", async () => {
	const { buildControlProposal, emitControlProposal } = await import("../lib/control-proposal.ts");
	const fp = makeFakePi();
	const prevLens = process.env.STATE_LENS;
	delete process.env.STATE_LENS; // default steer mode
	try {
		const mod = await import(`../extensions/session-blackboard.ts?abortguard=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		resetBoard();
		const s = boardState();
		s.turn = 20;
		noteTool(s, { toolName: "bash", args: { command: "npm test" }, isError: true, errorText: "fail" });

		// tier-3 abort proposal (what loop-breaker emits in LB_HARD_STOP=abort):
		// the lens must stay silent — a steer here fights the abort.
		emitControlProposal(fp.pi.events as never, buildControlProposal({
			boundarySequence: 20, kind: "safe_abort", reason: "loop_hard_stop",
			source: "loop-breaker", cooldownKey: "exact:3:abort",
			messageFactory: "loop-tier", effect: "abort",
		}), { abort: () => {} });
		assert.equal(fp.deliveries.length, 0, "no lens steer on an abort-effect proposal");

		// same boundary, message-effect proposal: the lens DOES fire.
		emitControlProposal(fp.pi.events as never, buildControlProposal({
			boundarySequence: 20, kind: "failure_recovery", reason: "loop_strategy_change",
			source: "loop-breaker", cooldownKey: "exact:1",
			messageFactory: "loop-tier", effect: "message",
		}), { message: "tier steer" });
		assert.equal(fp.deliveries.length, 1, "message-effect proposal still gets a lens steer");
		assert.match(fp.deliveries[0].text, /session-state/);
	} finally {
		if (prevLens === undefined) delete process.env.STATE_LENS; else process.env.STATE_LENS = prevLens;
		resetBoard();
	}
});
