import assert from "node:assert/strict";
import test from "node:test";
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
