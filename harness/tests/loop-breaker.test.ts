import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { thresh, resolveStopMode, fpKey, decideTier, tallySessionRepeats, type Thresholds } from "../extensions/loop-breaker.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const TH: Thresholds = { t1: 2, t2: 3, t3: 5, streakSoft: 8, streakHard: 20 }; // local defaults

test("fpKey: read pagination (different offsets) does NOT collide", () => {
	// The read tool truncates large files and instructs "continue with offset=N";
	// paginating must NOT look like a repeated call.
	const p0 = fpKey("read", { path: "src/app.ts", offset: 0 });
	const p1 = fpKey("read", { path: "src/app.ts", offset: 2000 });
	const p2 = fpKey("read", { path: "src/app.ts", offset: 4000 });
	assert.notEqual(p0, p1);
	assert.notEqual(p1, p2);
});

test("fpKey: verbatim re-read (same offset) DOES collide", () => {
	assert.equal(fpKey("read", { path: "a.ts" }), fpKey("read", { path: "a.ts", offset: 0 }));
	assert.equal(fpKey("read", { path: "a.ts", offset: 50 }), fpKey("read", { path: "a.ts", offset: 50 }));
});

test("decideTier: reasoning repetition steers but NEVER blocks a fingerprint", () => {
	// maxReason drives the tier, maxTool=0 (each turn a different tool) → no block.
	const d2 = decideTier(0, TH.t2, 1, TH); // reasoning repeated to the T2 threshold
	assert.equal(d2.tier, 2);
	assert.equal(d2.byReasonRepeat, true);
	assert.equal(d2.byToolRepeat, false);
	assert.equal(d2.blockWorst, false, "must not block an innocent n=1 tool call on reasoning repeats");
});

test("decideTier: genuine tool repetition DOES block at tier 2", () => {
	const d = decideTier(TH.t2, 0, 1, TH);
	assert.equal(d.tier, 2);
	assert.equal(d.blockWorst, true);
});

test("decideTier: a long VARIED read streak nudges (T1) but never blocks", () => {
	const d = decideTier(1, 0, TH.streakSoft, TH); // no repetition, just a long streak
	assert.equal(d.tier, 1);
	assert.equal(d.blockWorst, false);
	assert.equal(d.byToolRepeat, false);
});

test("decideTier: escalates to tier 3 on repeat or hard streak", () => {
	assert.equal(decideTier(TH.t3, 0, 1, TH).tier, 3);
	assert.equal(decideTier(1, 0, TH.streakHard, TH).tier, 3);
	assert.equal(decideTier(1, 1, 1, TH).tier, 0); // below everything
});

test("thresh: explicit LB_* env wins for both tiers", () => {
	process.env.LB_REPEAT_T1 = "7";
	try {
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, true), 7);
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, false), 7);
	} finally {
		delete process.env.LB_REPEAT_T1;
	}
});

test("thresh: local default < cloud default when env unset", () => {
	assert.equal(thresh("LB_STREAK_SOFT", 12, 8, true), 8);
	assert.equal(thresh("LB_STREAK_SOFT", 12, 8, false), 12);
});

test("thresh: env value below floor is clamped to 2", () => {
	process.env.LB_REPEAT_T1 = "1";
	try {
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, true), 2);
	} finally {
		delete process.env.LB_REPEAT_T1;
	}
});

test("resolveStopMode: default is abort (graceful run-stop); env overrides", () => {
	assert.equal(resolveStopMode(undefined), "abort"); // new default: tier 3 stops the run
	assert.equal(resolveStopMode("shutdown"), "shutdown");
	assert.equal(resolveStopMode("block"), "block"); // opt back into old soft behavior
	assert.equal(resolveStopMode("garbage"), "abort");
});

test("session repeats survive the progress reset that clears an episode", () => {
	// The grinding pattern from the field: fail, fail, fail, one edit, repeat.
	// Every `edit` turn calls resetEpisode(), so the since-progress counters never
	// reach a tier — which is why a real session logged 164 repeats and 150 tool
	// errors and still passed. The cumulative counter must see straight through it.
	const seen = new Set<string>();
	let repeats = 0;
	for (let cycle = 0; cycle < 10; cycle++) {
		for (let i = 0; i < 3; i++) {
			repeats += tallySessionRepeats(seen, [{ name: "bash", args: { command: "npm test" } }]);
		}
		// progress turn — in the extension this calls resetEpisode()
		repeats += tallySessionRepeats(seen, [{ name: "edit", args: { path: `f${cycle}.ts` } }]);
	}
	assert.equal(repeats, 29, "3 repeats/cycle after the first call, across 10 cycles");
	assert.ok(repeats >= 25, "trips the default LB_SESSION_REPEAT limit the episode counter never reaches");
});

test("session repeats do NOT count read pagination or genuinely new work", () => {
	const seen = new Set<string>();
	let repeats = 0;
	repeats += tallySessionRepeats(seen, [{ name: "read", args: { path: "big.ts", offset: 0 } }]);
	repeats += tallySessionRepeats(seen, [{ name: "read", args: { path: "big.ts", offset: 2000 } }]);
	repeats += tallySessionRepeats(seen, [{ name: "read", args: { path: "big.ts", offset: 4000 } }]);
	repeats += tallySessionRepeats(seen, [{ name: "bash", args: { command: "npm test" } }]);
	assert.equal(repeats, 0, "paginating a large file and doing new work is not grinding");
	repeats += tallySessionRepeats(seen, [{ name: "read", args: { path: "big.ts", offset: 2000 } }]);
	assert.equal(repeats, 1, "a verbatim re-read IS a repeat");
});

test("successful read-only bash output containing FAILED is never an outcome loop", async () => {
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?readonly-failed=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	let aborts = 0;
	const ctx = { ui: { notify() {} }, abort() { aborts += 1; }, cwd: "/tmp" };
	await fire(fp, "session_start", {});
	for (let index = 0; index < 6; index++) {
		await fire(fp, "turn_end", {
			turnIndex: index,
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id: `rg-${index}`, name: "bash", arguments: { command: `rg FAILED logs-${index}.txt` } },
			] },
			toolResults: [{ toolCallId: `rg-${index}`, toolName: "bash", isError: false, content: [{ type: "text", text: "FAILED record" }] }],
		}, ctx);
	}
	assert.equal(fp.sent.some((message) => message.includes("Same failing result")), false);
	assert.equal(aborts, 0);
});

test("rejected plan_write participates in outcomes; successful plan_write resets the episode", async () => {
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?plan-reject=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const ctx = { ui: { notify() {} }, abort() {}, cwd: "/tmp" };
	await fire(fp, "session_start", {});
	for (let index = 0; index < 2; index++) {
		const id = `bad-plan-${index}`;
		await fire(fp, "tool_execution_end", {
			toolCallId: id, toolName: "plan_write", isError: true,
			result: { content: [{ type: "text", text: "plan_write rejected: unknown dependency" }] },
		}, ctx);
		await fire(fp, "turn_end", {
			turnIndex: index,
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id, name: "plan_write", arguments: { items: [] } },
			] },
			toolResults: [],
		}, ctx);
	}
	assert.equal(fp.sent.some((message) => message.includes("plan_write rejection")), true,
		"execution-end-only rejection reaches the outcome ladder");

	// Build an ordinary repeated-call episode, then prove a successful plan_write
	// clears it: the next identical read starts again at count one.
	await fire(fp, "session_start", {});
	fp.sent.length = 0;
	const readTurn = (id: string, turnIndex: number) => ({
		turnIndex, toolResults: [],
		message: { role: "assistant", provider: "local-llama", content: [
			{ type: "toolCall", id, name: "read", arguments: { path: "src/x.ts" } },
		] },
	});
	await fire(fp, "turn_end", readTurn("r1", 3), ctx);
	await fire(fp, "turn_end", readTurn("r2", 4), ctx);
	assert.ok(fp.sent.length > 0, "the repeated read episode actually steered");
	fp.sent.length = 0;
	await fire(fp, "tool_execution_end", { toolCallId: "good-plan", toolName: "plan_write", isError: false, result: { content: [] } }, ctx);
	await fire(fp, "turn_end", {
		turnIndex: 5, toolResults: [],
		message: { role: "assistant", provider: "local-llama", content: [
			{ type: "toolCall", id: "good-plan", name: "plan_write", arguments: { items: [] } },
		] },
	}, ctx);
	await fire(fp, "turn_end", readTurn("r3", 6), ctx);
	assert.equal(fp.sent.length, 0, "successful plan_write resets the repetition episode");
});

test("failure episodes include execution-end-only validation failures and deduplicate tool_result", async () => {
	const g = globalThis as Record<string, unknown>;
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?episode-dedupe=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const ctx = { ui: { notify() {} }, abort() {}, cwd: "/tmp" };
	await fire(fp, "session_start", {}, ctx);
	await fire(fp, "tool_execution_start", {
		toolCallId: "bad-plan", toolName: "plan_write",
		args: { items: [], marker: "DUMMY_EPISODE_VALUE_DO_NOT_PERSIST" },
	}, ctx);
	await fire(fp, "tool_execution_end", {
		toolCallId: "bad-plan", toolName: "plan_write", isError: true,
		result: { content: [{ type: "text", text: "Invalid input: required property items" }] },
	}, ctx);
	await fire(fp, "tool_result", {
		type: "tool_result", toolCallId: "bad-plan", toolName: "plan_write",
		input: { items: [] }, isError: true, details: {},
		content: [{ type: "text", text: "Invalid input: required property items" }],
	}, ctx);
	const snapshot = g.__pi_failure_episode_state as {
		totalFailures: number; active: Array<{ failureClass: string }>;
	};
	assert.equal(snapshot.totalFailures, 1, "execution-end and tool_result describe one call");
	assert.equal(snapshot.active[0]?.failureClass, "schema_validation");
	assert.equal(JSON.stringify(snapshot).includes("DUMMY_EPISODE_VALUE_DO_NOT_PERSIST"), false);
	delete g.__pi_failure_episode_state;
});

test("exact verification state recovers a semantic verification episode", async () => {
	const g = globalThis as Record<string, unknown>;
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?episode-gate=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const ctx = { ui: { notify() {} }, abort() {}, cwd: "/tmp" };
	await fire(fp, "session_start", {}, ctx);
	await fire(fp, "tool_execution_start", {
		toolCallId: "red", toolName: "bash", args: { command: "npm test" },
	}, ctx);
	await fire(fp, "tool_execution_end", {
		toolCallId: "red", toolName: "bash", isError: true,
		result: { content: [{ type: "text", text: "1 failing AssertionError" }] },
	}, ctx);
	g.__pi_vg_state = { gateCmd: "npm test", mutated: true, verifiedOk: true };
	await fire(fp, "turn_start", { turnIndex: 2, timestamp: Date.now() }, ctx);
	const snapshot = g.__pi_failure_episode_state as {
		active: unknown[]; completed: Array<{ recovery: string }>;
	};
	assert.equal(snapshot.active.length, 0);
	assert.equal(snapshot.completed.at(-1)?.recovery, "exact_gate");
	delete g.__pi_vg_state;
	delete g.__pi_failure_episode_state;
});

test("session_start clears SESSION-cumulative state (no bleed across /new, /fork, /resume)", async () => {
	// sessionSeenCalls/sessionRepeats/sessionRepeatFired live at MODULE scope, and
	// pi returns the cached extension factory across session replacement
	// (loader.js:318-322 — cleared only on cwd change). So module scope means
	// "until the cwd changes", not "until the session ends": repeats bled into the
	// next session, sessionRepeatFired latched the steer off for the whole process,
	// and blackboard.ts:127-128 rendered the stale count into the c48 lens as
	// "repeats this session: N" right after the board was deliberately cleared.
	const g = globalThis as Record<string, unknown>;
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?sess=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);

	const repeated = {
		turnIndex: 1,
		toolResults: [],
		message: {
			role: "assistant",
			provider: "local-llama",
			content: [
				{ type: "toolCall", id: "a", name: "read", arguments: { path: "src/x.ts" } },
				{ type: "toolCall", id: "b", name: "read", arguments: { path: "src/x.ts" } },
			],
		},
	};
	const ctx = { ui: { notify() {} }, abort() {}, cwd: "/tmp" };
	const state = () => g.__pi_lb_state as { sessionRepeats: number; seen: number } | undefined;

	await fire(fp, "session_start", {});
	await fire(fp, "turn_end", repeated, ctx);
	assert.deepEqual(fp.swallowedErrors, [], "no handler threw — a swallowed throw would fake a passing test");
	const firstTurn = { ...state()! }; // the two identical calls in ONE turn are a legitimate repeat
	await fire(fp, "turn_end", repeated, ctx);
	const accumulated = { ...state()! };
	assert.ok(accumulated.sessionRepeats > firstTurn.sessionRepeats, "repeats accumulate within a session");

	// A new session through the SAME cached factory must land back on the first-turn
	// numbers, not continue the previous session's tally.
	await fire(fp, "session_start", {});
	assert.equal(state(), undefined, "the published lens state must not survive session_start");
	await fire(fp, "turn_end", repeated, ctx);
	assert.deepEqual(state(), firstTurn,
		`a fresh session's first turn must match the original first turn, not carry ${accumulated.sessionRepeats} repeats forward`);
	delete g.__pi_lb_state;
});

test("agent_start drops the steer anchor — turns_since can never go negative", async () => {
	// turnIndex is NOT monotonic: agent-session.js:428-429 zeroes _turnIndex on every
	// agent_start, which fires again on retry, on auto-compaction, and on any message
	// queued with triggerTurn. loop-breaker keeps its episode across those, so a steer
	// at turn 9 followed by a restart and progress at turn 1 recorded turns_since: -8.
	// Nothing rejected it — the catalog types turns_since as a bare `number` and
	// telemetry-report.sh takes its median.
	const telemetry = join(mkdtempSync(join(tmpdir(), "lb-")), "telemetry.jsonl");
	const prev = process.env.TELEMETRY_FILE;
	process.env.TELEMETRY_FILE = telemetry;
	const g = globalThis as Record<string, unknown>;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/loop-breaker.ts?agentstart=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const ctx = { ui: { notify() {} }, abort() {}, cwd: "/tmp" };
		const repeatTurn = (turnIndex: number) => ({
			turnIndex, toolResults: [],
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id: "a", name: "read", arguments: { path: "src/x.ts" } },
				{ type: "toolCall", id: "b", name: "read", arguments: { path: "src/x.ts" } },
			] },
		});
		// A mutation is "progress", which is what emits progress-after-steer.
		const progressTurn = (turnIndex: number) => ({
			turnIndex, toolResults: [],
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id: "m", name: "edit", arguments: { path: "src/x.ts" } },
			] },
		});

		await fire(fp, "session_start", {});
		// EXACTLY two repeat turns: tier 1 then tier 2, leaving lastSteerTurn = 2. A
		// third would hit tier 3, whose abort resets the episode and clears the anchor —
		// so a longer loop here makes this test vacuous (the first draft used six and
		// passed with the fix reverted).
		for (let t = 1; t <= 2; t++) await fire(fp, "turn_end", repeatTurn(t), ctx);
		await fire(fp, "agent_start", {}, ctx);   // retry / compaction: turnIndex restarts
		await fire(fp, "turn_end", progressTurn(1), ctx);
		assert.deepEqual(fp.swallowedErrors, [], "no handler threw");

		const rows = existsSync(telemetry)
			? readFileSync(telemetry, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
			: [];
		assert.ok(rows.some((r) => r.ext === "loop-breaker" && r.kind === "steer"),
			"the steer must actually land, or this test proves nothing about the anchor");
		const deltas = rows.filter((r) => r.ext === "loop-breaker" && r.kind === "progress-after-steer")
			.map((r) => r.turns_since);
		// Without the reset this is exactly [-1] (steer at turn 2, progress at turn 1).
		assert.deepEqual(deltas, [],
			`a steer straddling agent_start must emit NO record, got turns_since ${JSON.stringify(deltas)}`);
	} finally {
		if (prev === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = prev;
		delete g.__pi_lb_state;
	}
});
