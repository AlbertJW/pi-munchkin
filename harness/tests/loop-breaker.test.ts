import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { thresh, resolveStopMode, fpKey, decideTier, sessionEpisodeThresholds, tallySessionRepeats, type Thresholds } from "../extensions/loop-breaker.ts";
import { planItemHash } from "../lib/failure-episodes.ts";
import { loopRecoveryPath } from "../lib/loop-recovery.ts";
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

test("LB_SESSION_REPEAT remains a compatibility alias for enforced tier one", () => {
	assert.deepEqual(sessionEpisodeThresholds({ LB_SESSION_REPEAT: "9" } as NodeJS.ProcessEnv), [9, 11, 28]);
	assert.deepEqual(sessionEpisodeThresholds({ LB_SESSION_T1: "8", LB_SESSION_REPEAT: "20" } as NodeJS.ProcessEnv), [8, 11, 28]);
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
	await fire(fp, "tool_execution_start", {
		toolCallId: "good-plan", toolName: "plan_write", args: { items: [] },
	}, ctx);
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

test("candidate progress resets repetition only after its successful execution end", async () => {
	const candidates = [
		{ name: "edit", args: { path: "src/x.ts" } },
		{ name: "write", args: { path: "src/x.ts" } },
		{ name: "multiedit", args: { path: "src/x.ts" } },
		{ name: "plan_write", args: { items: [] } },
		{ name: "plan_update", args: { id: "item-1", status: "done" } },
		{ name: "bash", args: { command: "touch src/x.ts" } },
	] as const;
	const readTurn = (id: string, turnIndex: number) => ({
		turnIndex, toolResults: [],
		message: { role: "assistant", provider: "local-llama", content: [
			{ type: "toolCall", id, name: "read", arguments: { path: "src/repeat.ts" } },
		] },
	});

	for (const [index, candidate] of candidates.entries()) {
		for (const outcome of ["failed", "missing", "succeeded"] as const) {
			const fp = makeFakePi();
			const mod = await import(`../extensions/loop-breaker.ts?progress=${index}-${outcome}-${Date.now()}-${Math.random()}`);
			mod.default(fp.pi as never);
			const ctx = { ui: { notify() {} }, abort() {}, shutdown() {}, cwd: "/tmp" };
			await fire(fp, "session_start", {}, ctx);
			await fire(fp, "turn_end", readTurn("read-1", 1), ctx);
			await fire(fp, "turn_end", readTurn("read-2", 2), ctx);
			assert.equal(fp.sent.length, 1, `${candidate.name}: setup must reach exact-call tier one`);
			fp.sent.length = 0;

			const callId = `${candidate.name}-${outcome}`;
			await fire(fp, "tool_execution_start", {
				toolCallId: callId, toolName: candidate.name, args: candidate.args,
			}, ctx);
			if (outcome !== "missing") {
				await fire(fp, "tool_execution_end", {
					toolCallId: callId, toolName: candidate.name, isError: outcome === "failed",
					result: { content: [{ type: "text", text: outcome === "failed" ? "operation failed" : "ok" }] },
				}, ctx);
			}
			await fire(fp, "turn_end", {
				turnIndex: 3, toolResults: [],
				message: { role: "assistant", provider: "local-llama", content: [
					{ type: "toolCall", id: callId, name: candidate.name, arguments: candidate.args },
				] },
			}, ctx);
			await fire(fp, "turn_end", readTurn("read-3", 4), ctx);
			assert.equal(
				fp.sent.length,
				outcome === "succeeded" ? 0 : 1,
				`${candidate.name}: ${outcome} execution ${outcome === "succeeded" ? "must" : "must not"} reset exact repetition`,
			);
		}
	}
});

test("coincident exact-outcome and exact-call tiers deliver only the outcome correction", async () => {
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?one-action=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const ctx = { ui: { notify() {} }, abort() {}, shutdown() {}, cwd: "/tmp" };
	await fire(fp, "session_start", {}, ctx);
	for (let attempt = 1; attempt <= 2; attempt++) {
		const id = `same-failure-${attempt}`;
		await fire(fp, "turn_end", {
			turnIndex: attempt,
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id, name: "bash", arguments: { command: "npm test" } },
			] },
			toolResults: [{
				toolCallId: id, toolName: "bash", isError: true,
				content: [{ type: "text", text: "1 failing AssertionError" }],
			}],
		}, ctx);
	}
	assert.equal(fp.sent.length, 1, "one boundary must produce one loop action");
	assert.match(fp.sent[0]!, /Same failing result/,
		"equal-tier exact outcome outranks the exact-call correction");
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

test("tool starts preserve plan-item correlation and status reports both overrun metrics", async () => {
	const g = globalThis as Record<string, unknown>;
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?episode-correlation=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const notices: string[] = [];
	const ctx = { cwd: "/tmp", ui: { notify(message: string) { notices.push(message); } }, abort() {} };
	await fire(fp, "session_start", {}, ctx);
	for (let attempt = 1; attempt <= 2; attempt++) {
		g.__pi_active_plan_context = { item_id: "item-at-start" };
		const id = `start-item-${attempt}`;
		await fire(fp, "tool_execution_start", {
			toolCallId: id, toolName: "bash", args: { command: attempt === 1 ? "npm test" : "pnpm test" },
		}, ctx);
		g.__pi_active_plan_context = { item_id: "item-after-start" };
		await fire(fp, "tool_execution_end", {
			toolCallId: id, toolName: "bash", isError: true,
			result: { content: [{ type: "text", text: "1 failing AssertionError" }] },
		}, ctx);
	}
	let snapshot = g.__pi_failure_episode_state as {
		active: Array<{ count: number; planItemHash: string }>;
		semanticFailureOverrun: number;
		correlatedFailureOverrun: number;
	};
	assert.equal(snapshot.active.length, 1, "result-time plan changes must not split the episode");
	assert.equal(snapshot.active[0]?.count, 2);
	assert.equal(snapshot.active[0]?.planItemHash, planItemHash("item-at-start"));

	g.__pi_active_plan_context = { item_id: "item-at-start" };
	await fire(fp, "tool_execution_start", {
		toolCallId: "unrelated", toolName: "read", args: { path: "src/other.ts" },
	}, ctx);
	await fire(fp, "tool_execution_start", {
		toolCallId: "correlated", toolName: "bash", args: { command: "npm run test -- --new-strategy" },
	}, ctx);
	snapshot = g.__pi_failure_episode_state as typeof snapshot;
	assert.equal(snapshot.semanticFailureOverrun, 2);
	assert.equal(snapshot.correlatedFailureOverrun, 1);
	await fp.commands.get("loop-status").handler("", ctx);
	assert.match(notices.at(-1)!, /semantic_overrun=2; correlated_overrun=1/);
	assert.deepEqual(fp.swallowedErrors, []);
	delete g.__pi_active_plan_context;
	delete g.__pi_failure_episode_state;
});

test("compaction settles semantic episodes and clears their exposed overrun window", async () => {
	const g = globalThis as Record<string, unknown>;
	const fp = makeFakePi();
	const mod = await import(`../extensions/loop-breaker.ts?compact-exposure=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const ctx = { cwd: "/tmp", ui: { notify() {} }, abort() {} };
	await fire(fp, "session_start", {}, ctx);
	for (let attempt = 1; attempt <= 2; attempt++) {
		const id = `compact-failure-${attempt}`;
		await fire(fp, "tool_execution_start", {
			toolCallId: id, toolName: "bash", args: { command: "npm test" },
		}, ctx);
		await fire(fp, "tool_execution_end", {
			toolCallId: id, toolName: "bash", isError: true,
			result: { content: [{ type: "text", text: "1 failing AssertionError" }] },
		}, ctx);
	}
	let snapshot = g.__pi_failure_episode_state as {
		active: unknown[]; completed: unknown[]; semanticFailureOverrun: number;
	};
	assert.equal(snapshot.active.length, 1, "setup must expose one active episode");
	await fire(fp, "session_compact", {}, ctx);
	await fire(fp, "tool_execution_start", {
		toolCallId: "after-compact", toolName: "read", args: { path: "src/x.ts" },
	}, ctx);
	snapshot = g.__pi_failure_episode_state as typeof snapshot;
	assert.equal(snapshot.active.length, 0);
	assert.equal(snapshot.completed.length, 1);
	assert.equal(snapshot.semanticFailureOverrun, 0,
		"post-compaction calls must not remain inside a settled episode window");
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

test("semantic tiers steer at two/four and abort silently at six with a private receipt", async () => {
	const root = mkdtempSync(join(tmpdir(), "lb-enforce-"));
	const cwd = join(root, "work");
	const previous = { ...process.env };
	process.env.LOOP_EPISODE_MODE = "enforce";
	process.env.PI_CODING_AGENT_DIR = root;
	process.env.LB_REPEAT_T1 = "99";
	process.env.LB_REPEAT_T2 = "100";
	process.env.LB_REPEAT_T3 = "101";
	process.env.LB_OUTCOME_T1 = "99";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/loop-breaker.ts?semantic-enforce=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		let aborts = 0;
		const ctx = { cwd, ui: { notify() {} }, abort() { aborts += 1; } };
		await fire(fp, "session_start", {}, ctx);
		for (let index = 1; index <= 6; index++) {
			const id = `gate-${index}`;
			const command = index <= 2 ? "npm test -- --shard=repeat" : `npm test -- --shard=${index}`;
			await fire(fp, "tool_execution_start", { toolCallId: id, toolName: "bash", args: { command } }, ctx);
			await fire(fp, "tool_execution_end", {
				toolCallId: id, toolName: "bash", isError: true,
				result: { content: [{ type: "text", text: `error TS1234 DUMMY_FAILURE_${index}` }] },
			}, ctx);
			await fire(fp, "turn_end", {
				turnIndex: index, toolResults: [],
				message: { role: "assistant", provider: "local-llama", content: [
					{ type: "toolCall", id, name: "bash", arguments: { command } },
				] },
			}, ctx);
		}
		assert.equal(fp.sent.length, 2, "tier three injects no automatic continuation");
		assert.match(fp.sent[0]!, /failure_class=compile_or_lint/);
		assert.match(fp.sent[1]!, /Delegate or report Blocked/);
		assert.equal(aborts, 1);
		const raw = readFileSync(loopRecoveryPath(cwd, process.env), "utf8");
		assert.equal(raw.includes("npm test"), false);
		assert.equal(raw.includes("DUMMY_FAILURE"), false);
		assert.equal(raw.includes(cwd), false);
		assert.equal(raw.includes("endpoint"), false);
		const repeated = await fire(fp, "tool_call", {
			toolName: "bash", input: { command: "npm test -- --shard=repeat" },
		}, ctx) as { block?: boolean } | undefined;
		const alternative = await fire(fp, "tool_call", {
			toolName: "bash", input: { command: "npm test -- --shard=new-strategy" },
		}, ctx) as { block?: boolean } | undefined;
		assert.equal(repeated?.block, true, "only an exact previously repeated call is walled");
		assert.equal(alternative, undefined, "a new call in the semantic family remains allowed");
		await fp.commands.get("loop-resume").handler("", ctx);
		assert.equal(await fire(fp, "tool_call", {
			toolName: "bash", input: { command: "npm test -- --shard=repeat" },
		}, ctx), undefined, "manual resume clears the exact-call wall");
	} finally {
		for (const key of ["LOOP_EPISODE_MODE", "PI_CODING_AGENT_DIR", "LB_REPEAT_T1", "LB_REPEAT_T2", "LB_REPEAT_T3", "LB_OUTCOME_T1"]) {
			if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
		}
	}
});

test("coincident semantic and cumulative tiers produce one highest-tier intervention", async () => {
	const previous = { ...process.env };
	Object.assign(process.env, {
		LOOP_EPISODE_MODE: "enforce", LB_EPISODE_T1: "3", LB_EPISODE_T2: "50", LB_EPISODE_T3: "60",
		LB_SESSION_T1: "2", LB_SESSION_T2: "50", LB_SESSION_T3: "60",
		LB_REPEAT_T1: "99", LB_REPEAT_T2: "100", LB_REPEAT_T3: "101", LB_OUTCOME_T1: "99",
	});
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/loop-breaker.ts?coincident=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const ctx = { cwd: "/tmp", ui: { notify() {} }, abort() {} };
		await fire(fp, "session_start", {}, ctx);
		for (let index = 1; index <= 3; index++) {
			const id = `semantic-${index}`;
			const command = `npm test -- --shard=${index}`;
			await fire(fp, "tool_execution_start", { toolCallId: id, toolName: "bash", args: { command } }, ctx);
			await fire(fp, "tool_execution_end", {
				toolCallId: id, toolName: "bash", isError: true,
				result: { content: [{ type: "text", text: "error TS1234" }] },
			}, ctx);
			await fire(fp, "turn_end", {
				turnIndex: index, toolResults: [],
				message: { role: "assistant", provider: "local-llama", content: [
					{ type: "toolCall", id, name: "bash", arguments: { command } },
					{ type: "toolCall", id: `read-${index}`, name: "read", arguments: { path: "same.ts" } },
				] },
			}, ctx);
		}
		assert.equal(fp.sent.length, 1);
		assert.match(fp.sent[0]!, /failure_class=compile_or_lint/);
		await fire(fp, "turn_end", {
			turnIndex: 4, toolResults: [],
			message: { role: "assistant", provider: "local-llama", content: [
				{ type: "toolCall", id: "read-4", name: "read", arguments: { path: "same.ts" } },
			] },
		}, ctx);
		assert.equal(fp.sent.length, 1, "a reached session tier intervenes once, not every later turn");
	} finally {
		for (const key of [
			"LOOP_EPISODE_MODE", "LB_EPISODE_T1", "LB_EPISODE_T2", "LB_EPISODE_T3",
			"LB_SESSION_T1", "LB_SESSION_T2", "LB_SESSION_T3",
			"LB_REPEAT_T1", "LB_REPEAT_T2", "LB_REPEAT_T3", "LB_OUTCOME_T1",
		]) {
			if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
		}
	}
});

test("shadow mode observes the measured 7/11/28 session tail without intervening", async () => {
	const telemetry = join(mkdtempSync(join(tmpdir(), "lb-shadow-")), "events.jsonl");
	const previous = { ...process.env };
	Object.assign(process.env, {
		LOOP_EPISODE_MODE: "shadow", TELEMETRY_FILE: telemetry, LB_SESSION_REPEAT: "100",
		LB_REPEAT_T1: "99", LB_REPEAT_T2: "100", LB_REPEAT_T3: "101",
		LB_STREAK_SOFT: "99", LB_STREAK_HARD: "100",
	});
	delete process.env.LB_SESSION_T1;
	delete process.env.LB_SESSION_T2;
	delete process.env.LB_SESSION_T3;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/loop-breaker.ts?shadow-tail=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		let aborts = 0;
		const ctx = { cwd: "/tmp", ui: { notify() {} }, abort() { aborts += 1; } };
		await fire(fp, "session_start", {}, ctx);
		for (let index = 0; index < 29; index++) {
			await fire(fp, "turn_end", {
				turnIndex: index, toolResults: [],
				message: { role: "assistant", provider: "local-llama", content: [
					{ type: "toolCall", id: `read-${index}`, name: "read", arguments: { path: "same.ts" } },
				] },
			}, ctx);
		}
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const observed = rows.filter((row) => row.ext === "failure-episode" && row.kind === "tier-observed" && row.detector === "session");
		assert.deepEqual(observed.map((row) => [row.tier, row.count]), [[1, 7], [2, 11], [3, 28]]);
		assert.equal(fp.sent.length, 0);
		assert.equal(aborts, 0);
	} finally {
		for (const key of [
			"LOOP_EPISODE_MODE", "TELEMETRY_FILE", "LB_SESSION_REPEAT", "LB_SESSION_T1", "LB_SESSION_T2", "LB_SESSION_T3",
			"LB_REPEAT_T1", "LB_REPEAT_T2", "LB_REPEAT_T3",
			"LB_STREAK_SOFT", "LB_STREAK_HARD",
		]) {
			if (previous[key] === undefined) delete process.env[key]; else process.env[key] = previous[key];
		}
	}
});

test("loop status is redacted and loop resume clears active episodes with one deterministic message", async () => {
	const previous = process.env.LOOP_EPISODE_MODE;
	process.env.LOOP_EPISODE_MODE = "shadow";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/loop-breaker.ts?commands=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const notices: string[] = [];
		const ctx = { cwd: "/tmp", ui: { notify(message: string) { notices.push(message); } }, abort() {} };
		await fire(fp, "session_start", {}, ctx);
		await fire(fp, "tool_execution_start", {
			toolCallId: "private", toolName: "edit", args: { path: "/private/DUMMY_SECRET_PATH" },
		}, ctx);
		await fire(fp, "tool_execution_end", {
			toolCallId: "private", toolName: "edit", isError: true,
			result: { content: [{ type: "text", text: "permission denied DUMMY_SECRET_ERROR" }] },
		}, ctx);
		await fp.commands.get("loop-status").handler("", ctx);
		assert.match(notices.at(-1)!, /failure_class=permission/);
		assert.equal(notices.at(-1)!.includes("DUMMY_SECRET"), false);
		await fp.commands.get("loop-resume").handler("", ctx);
		assert.equal(fp.sent.at(-1), "[loop-breaker] Recovery walls cleared. Re-ground from the current plan and exact-gate state; use a different strategy or report Blocked.");
		const snapshot = (globalThis as Record<string, any>).__pi_failure_episode_state;
		assert.equal(snapshot.active.length, 0);
	} finally {
		if (previous === undefined) delete process.env.LOOP_EPISODE_MODE; else process.env.LOOP_EPISODE_MODE = previous;
	}
});
