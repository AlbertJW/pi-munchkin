import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { classifyBashCommand, isBashMutation, looksFailingOutput } from "../lib/command-policy.ts";
import {
	boundedResultText, FailureEpisodeTracker, isFailureObservation,
	planItemHash, sha256, strategyHash,
	type FailureEpisode, type FailureObservation, type RecoveryKind,
} from "../lib/failure-episodes.ts";
import { decideOutcomeAction } from "../lib/loop-outcome.ts";
import {
	recoveryReceipt, tierForCount, writeLoopRecoveryReceipt,
	type LoopTier,
} from "../lib/loop-recovery.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

// Agentic loop-breaker.
//
// Small local models can fall into CROSS-TURN loops: each turn re-reads the same
// files / re-emits the same reasoning and never commits an edit. presence/repeat
// penalties don't help (they only act within one generation). This watches each
// `turn_end`, counts repeated tool calls + repeated reasoning since the last
// "progress" turn (an edit/write/plan_write, or a final text answer), and escalates:
//   T1 steer -> T2 steer + block the repeated call -> T3 hard wall (keeps pi alive).
// State is in-memory and reset on progress and on session_start.
//
// Second detector: OUTCOME loops. A mutate→test→same-failure cycle is invisible
// to the call detector (edits reset the episode; test commands vary slightly),
// but the failing RESULT repeats verbatim. Track failing results from outcome
// tools (bash/edit/write), fingerprint with digits stripped (pids/counts jitter),
// and steer when the same failure keeps coming back despite changes between.
// Outcome state survives progress resets — that's the point.

function envInt(name: string, def: number): number {
	const v = process.env[name];
	if (!v) return def;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? Math.max(2, n) : def;
}

// A loop is REPETITION (same tool call or same reasoning, N times). Repetition
// drives every tier, including the block. A long, *varied* read streak is NOT a
// loop (it's investigation), so streak only ever produces a gentle Tier-1 nudge
// or a very-high Tier-3 runaway backstop — it never blocks.
//
// Tier thresholds are picked per turn by model class (see `thresh`): small local
// models loop sooner and are cheap to interrupt, so they get tighter defaults.
// An explicit LB_* env var overrides both tiers.
export function thresh(name: string, cloudDef: number, localDef: number, isLocal: boolean): number {
	const v = process.env[name];
	if (v) {
		const n = Number.parseInt(v, 10);
		if (Number.isFinite(n)) return Math.max(2, n);
	}
	return isLocal ? localDef : cloudDef;
}

const MIN_REASON_LEN = envInt("LB_MIN_REASON_LEN", 40);
// Deployment/ops scope knob, not an A/B candidate -- deliberately absent from
// schema.json's thresholds.fields (real_gate.sh's static configs test WHETHER a
// mechanism helps; this only decides WHERE loop-breaker runs at all). Set
// directly in a session's env, not via a candidate config.
const LOCAL_ONLY = process.env.LB_LOCAL_ONLY === "1";
// Tier-3 action. Default "abort" — gracefully stop the looping run (return to idle,
// pi stays alive, the outer ralph/gate or the user takes over). "shutdown" kills pi;
// "block" is the old soft behavior (block the repeated call, let the run continue).
export function resolveStopMode(env: string | undefined): "block" | "abort" | "shutdown" {
	return env === "shutdown" ? "shutdown" : env === "block" ? "block" : "abort";
}
const HARD_STOP_MODE = resolveStopMode(process.env.LB_HARD_STOP);
const EPISODE_MODE = process.env.LOOP_EPISODE_MODE === "off" ? "off" :
	process.env.LOOP_EPISODE_MODE === "enforce" ? "enforce" : "shadow";

// Tools that count as progress (reset the loop episode). Everything else
// (read, bash, grep, find, ls, ...) is non-progress.
const PROGRESS_TOOLS = new Set(["edit", "write"]);

function normText(s: string): string {
	return s.trim().replace(/\s+/g, " ").toLowerCase();
}

// FNV-1a 32-bit; collisions are harmless here (only used for equality counting).
function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 0x01000193);
	}
	return (h >>> 0).toString(36);
}

function stableStringify(v: unknown): string {
	if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
	if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
	const o = v as Record<string, unknown>;
	return `{${Object.keys(o)
		.sort()
		.map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
		.join(",")}}`;
}

// Fingerprint a tool call. For bash we key on the command; for read on
// path@offset — the SAME offset re-read collides (a jiggled verbatim re-read
// repeats its offset), but paginating a large file (offset 0, 2000, 4000, …)
// is the read tool's own documented workflow and must NOT count as repetition.
export function fpKey(name: string, args: Record<string, unknown>): string {
	let key: string;
	if (name === "bash") key = normText(String(args.command ?? ""));
	else if (name === "read") key = `${normText(String(args.path ?? ""))}@${Number(args.offset ?? 0) || 0}`;
	else key = normText(stableStringify(args));
	return hash(`${name}\0${key}`);
}

function labelFor(name: string, args: Record<string, unknown>): string {
	if (name === "bash") return `bash: ${String(args.command ?? "").slice(0, 80)}`;
	if (name === "read") return `read ${String(args.path ?? "")}`;
	return `${name} ${stableStringify(args).slice(0, 80)}`;
}

// Small local models do most file mutations through bash (cat > f, cat >> f,
// sed -i, python heredocs, git commit, ...), not the edit/write tools. Treat
// those as progress so real work doesn't get counted as a non-progress turn.
type Episode = {
	toolCounts: Map<string, number>;
	reasonCounts: Map<string, number>;
	labels: Map<string, string>;
	streak: number;
	steered: Set<number>;
	blocked: Set<string>;
	lastSteerTurn: number | null; // telemetry: measures steer → progress compliance
};

function newEpisode(): Episode {
	return {
		toolCounts: new Map(),
		reasonCounts: new Map(),
		labels: new Map(),
		streak: 0,
		steered: new Set(),
		blocked: new Set(),
		lastSteerTurn: null,
	};
}

let ep = newEpisode();
// Tier-3 "abort" backstop: armed when a loop is confirmed, fires on the next looping
// tool call (turn_end is ~idle, so its own abort may no-op — this guarantees the stop).
let abortArmed = false;

// SESSION-CUMULATIVE repeat counter — deliberately NOT cleared by resetEpisode().
//
// The episode counters measure repetition *since the last progress*, and progress
// includes a turn with no tool calls at all. That catches a model stuck in place but
// is blind to one that GRINDS: fail, fail, fail, one edit, repeat — every cycle resets
// the episode. Measured over 1,505 sessions, grinding is where the waste actually is:
// the worst session logged 164 repeated calls / 150 tool errors and still PASSED, and
// the top decile of sessions carries 43% of all 7,673 wasted tool calls. Every one of
// those episodes was reset away before it could trip a tier.
const SESSION_REPEAT_LIMIT = envInt("LB_SESSION_REPEAT", 25); // ~p95 of observed repeats
const EPISODE_T1 = envInt("LB_EPISODE_T1", 2);
const EPISODE_T2 = Math.max(EPISODE_T1, envInt("LB_EPISODE_T2", 4));
const EPISODE_T3 = Math.max(EPISODE_T2, envInt("LB_EPISODE_T3", 6));
const SESSION_SHADOW_T1 = envInt("LB_SESSION_T1", 7);
const SESSION_SHADOW_T2 = Math.max(SESSION_SHADOW_T1, envInt("LB_SESSION_T2", 11));
const SESSION_SHADOW_T3 = Math.max(SESSION_SHADOW_T2, envInt("LB_SESSION_T3", 28));
const sessionSeenCalls = new Set<string>();
const sessionCallCounts = new Map<string, number>();
let sessionRepeats = 0;
let sessionRepeatFired = false;

export function sessionEpisodeThresholds(env: NodeJS.ProcessEnv = process.env): [number, number, number] {
	const explicitT1 = env.LB_SESSION_T1 ?? env.LB_SESSION_REPEAT;
	const t1 = explicitT1 ? Math.max(2, Number.parseInt(explicitT1, 10) || 7) : 7;
	const t2 = Math.max(t1, Number.parseInt(env.LB_SESSION_T2 ?? "11", 10) || 11);
	const t3 = Math.max(t2, Number.parseInt(env.LB_SESSION_T3 ?? "28", 10) || 28);
	return [t1, t2, t3];
}

/** How many of these calls have been seen before this session. Mutates `seen`.
 *  Pure and exported so the grinding case is unit-testable without a live pi. */
export function tallySessionRepeats(seen: Set<string>, calls: Array<{ name: string; args: Record<string, unknown> }>): number {
	let repeats = 0;
	for (const c of calls) {
		const fp = fpKey(c.name, c.args);
		if (seen.has(fp)) repeats += 1;
		else seen.add(fp);
	}
	return repeats;
}

function resetEpisode(): void {
	ep = newEpisode();
	abortArmed = false;
}

// ---------- outcome-loop detector ----------

// Only tools whose result is an OUTCOME (command output, apply result). Never
// read/grep/find — their results are file CONTENT; a file containing "FAILED"
// must not register as a failing outcome.
const OUTCOME_TOOLS = new Set(["bash", "edit", "write", "multiedit", "plan_write"]);

function isFailingOutcome(toolName: string, text: string, isError: boolean, command = ""): boolean {
	if (isError) return true;
	if (toolName !== "bash") return false;
	// Successful inspection output is content, not an outcome. Only recognised
	// suites/build checks get the exit-0 textual-failure fallback.
	if (!classifyBashCommand(command).verifyLike) return false;
	return looksFailingOutput(text, false);
}

// Fingerprint a failing result: digits stripped so pids/durations/counts jitter
// doesn't break equality ("FAIL: 1" ≈ "FAIL: 2" — same stuck outcome class).
function outcomeFp(toolName: string, text: string): string {
	return hash(`${toolName} ${normText(text.slice(0, 2000)).replace(/\d+/g, "#")}`);
}

function outcomeMessage(n: number, label: string): string {
	return steerText(
		"LB_OUTCOME",
		"[loop-breaker] Same failing result {n}× ({label}) despite changes between. " +
			"Patching isn't moving the outcome. Stop — read the full error, change approach " +
			"(different fix point, add a debug print, simplify the repro), or mark blocked.",
		{ n, label },
	);
}

// Survives progress resets (mutations are PART of an outcome loop). Reset on
// session_start only. Fires once at OUTCOME_T1 and once more at 2×, per outcome.
let outcomeCounts = new Map<string, number>();
let outcomeLabels = new Map<string, string>();
let outcomeFired = new Map<string, number>();
function resetOutcomes(): void {
	outcomeCounts = new Map();
	outcomeLabels = new Map();
	outcomeFired = new Map();
	// verify-gate reads this cross-extension flag by wall-clock TTL, not by session —
	// clear it here too (session_start), else a stale timestamp from a prior session
	// in the same process can suppress verify-gate's nag in an unrelated new session.
	delete (globalThis as Record<string, unknown>).__pi_lb_outcome_at;
}

// Planning in flight? (flag set by plan-runner on /plan, cleared on /plan-go /
// agent_end — same pi process). While planning, never steer toward "edit":
// the PLAN contract is no edits, the right act is plan_write.
function isPlanning(): boolean {
	return (globalThis as Record<string, unknown>)["__pi_plan_phase_active"] === true;
}
function actWord(): string {
	return isPlanning() ? "write the plan (plan_write)" : "edit";
}

// Pure tier/block decision (unit-testable without the SDK). Tier is driven by
// the max of tool/reason repetition (or streak); a fingerprint is BLOCKED only
// when TOOL repetition reaches the block threshold — reasoning repetition steers
// but must never wall an innocent (n=1) tool call.
export type Thresholds = { t1: number; t2: number; t3: number; streakSoft: number; streakHard: number };
export function decideTier(
	maxTool: number,
	maxReason: number,
	streak: number,
	th: Thresholds,
): { tier: 0 | 1 | 2 | 3; byToolRepeat: boolean; byReasonRepeat: boolean; blockWorst: boolean } {
	const repeat = Math.max(maxTool, maxReason);
	let tier: 0 | 1 | 2 | 3 = 0;
	if (repeat >= th.t3 || streak >= th.streakHard) tier = 3;
	else if (repeat >= th.t2) tier = 2;
	else if (repeat >= th.t1 || streak >= th.streakSoft) tier = 1;
	return {
		tier,
		byToolRepeat: maxTool >= th.t1,
		byReasonRepeat: maxReason >= th.t1,
		blockWorst: tier === 2 && maxTool >= th.t2, // tier-3 walls separately (every repeated fp)
	};
}

// Steer texts route through lib/steer-texts.ts: env PI_MSG_<NAME> overrides the
// template (munchkin's `messages` search dimension); with no override the output
// is byte-identical to the historical literals (asserted in tests).
function tier1Message(label: string, repeat: number, streak: number, byToolRepeat: boolean, byReasonRepeat: boolean): string {
	if (byToolRepeat) {
		return steerText(
			"LB_T1_TOOL",
			"[loop-breaker] Repeated {label} {repeat}×, no file change. You have this. " +
				"Do ONE now: {act} · mark blocked + stop · name the one missing fact + how you'll get it. " +
				"Don't re-run that read/grep/command.",
			{ label, repeat, act: actWord() },
		);
	}
	if (byReasonRepeat) {
		return steerText(
			"LB_T1_REASON",
			"[loop-breaker] Same reasoning repeated {repeat}× with no file change. Thinking it again " +
				"won't change it. Do ONE now: {act} · mark blocked + stop · name the one missing fact.",
			{ repeat, act: actWord() },
		);
	}
	// LB_T1_STREAK: one override name, default chosen by mode (plan vs execute).
	const streakDefault = isPlanning()
		? "[loop-breaker] {streak} read-only turns, no change. Enough to plan? " +
			"Call plan_write now. Need more? Continue, but don't re-run reads you've done."
		: "[loop-breaker] {streak} read-only turns, no change. Enough to act? " +
			"Do it — edit (bash file-writes count) or answer. Need more? Continue, but don't re-run reads you've done.";
	return steerText("LB_T1_STREAK", streakDefault, { streak });
}

function tier2Message(label: string, streak: number, didBlock: boolean): string {
	const blocked = didBlock ? `${label} is now BLOCKED. ` : `You keep circling the same reasoning. `;
	return steerText(
		"LB_T2",
		"[loop-breaker] STILL LOOPING ({streak} turns, no edits). {blocked}" +
			"Stop gathering — act on what you have: {act}, or mark blocked + stop.",
		{ streak, blocked, act: actWord() },
	);
}

function tier3Message(streak: number): string {
	return steerText(
		"LB_T3",
		"[loop-breaker] HARD STOP: {streak} turns, no progress, no edits. Stop investigating. " +
			"{act}, or reply with the one blocker. All repeated read-only actions blocked.",
		{ streak, act: isPlanning() ? "Call plan_write now" : "Edit now" },
	);
}

export default function (pi: ExtensionAPI) {
	// Kill switch (mirrors VERIFY_GATE=off): needed by the harness-off measurement
	// arm (U3b) — does the harness's steering actually buy anything?
	if (process.env.LOOP_BREAKER === "off") return;
	const executionEnds = new Map<string, { toolName: string; isError: boolean; text: string }>();
	const episodeTracker = new FailureEpisodeTracker();
	const episodeArgs = new Map<string, Record<string, unknown>>();
	const episodeProcessed = new Set<string>();
	const episodeTierFired = new Map<string, LoopTier>();
	const exactStrategies = new Map<string, Map<string, { count: number; fp: string }>>();
	const sessionTierFired = new Set<LoopTier>();
	let providerRequest = 0;
	let providerRecovered = true;
	type PendingAction = {
		tier: Exclude<LoopTier, 0>;
		detector: "semantic" | "session" | "combined";
		episode: FailureEpisode | null;
		exactRepeatedFps: string[];
		count: number;
	};
	let pendingAction: PendingAction | null = null;

	function activePlanItemId(): string | null {
		const plan = (globalThis as Record<string, unknown>).__pi_active_plan_context as { item_id?: unknown } | undefined;
		return typeof plan?.item_id === "string" ? plan.item_id : null;
	}

	function publishEpisodes(): void {
		(globalThis as Record<string, unknown>).__pi_failure_episode_state = episodeTracker.snapshot();
	}

	function recordRecovery(episodes: FailureEpisode[]): void {
		for (const episode of episodes) {
			episodeTierFired.delete(episode.id);
			exactStrategies.delete(episode.id);
			if (pendingAction?.episode?.id === episode.id) pendingAction = null;
			record("failure-episode", "recovered", {
				episode_id: episode.id,
				failure_class: episode.failureClass,
				count: episode.count,
				calls_after_second: episode.callsAfterSecond,
				recovery: episode.recovery ?? "tool_success",
			});
		}
		if (episodes.length > 0) publishEpisodes();
	}

	function mergePending(next: PendingAction): void {
		if (!pendingAction) {
			pendingAction = next;
			return;
		}
		if (next.tier > pendingAction.tier) {
			pendingAction = next;
			return;
		}
		if (next.tier < pendingAction.tier) return;
		pendingAction = {
			...pendingAction,
			detector: pendingAction.detector === next.detector ? next.detector : "combined",
			episode: pendingAction.episode ?? next.episode,
			exactRepeatedFps: [...new Set([...pendingAction.exactRepeatedFps, ...next.exactRepeatedFps])],
			count: Math.max(pendingAction.count, next.count),
		};
	}

	function observeSemanticTier(episode: FailureEpisode, toolName: string, args: Record<string, unknown>): void {
		const strategy = strategyHash(toolName, args);
		const strategies = exactStrategies.get(episode.id) ?? new Map<string, { count: number; fp: string }>();
		const current = strategies.get(strategy);
		if (current) current.count += 1;
		else if (strategies.size < 16) strategies.set(strategy, { count: 1, fp: fpKey(toolName, args) });
		exactStrategies.set(episode.id, strategies);

		const tier = tierForCount(episode.count, EPISODE_T1, EPISODE_T2, EPISODE_T3);
		const prior = episodeTierFired.get(episode.id) ?? 0;
		if (tier === 0 || tier <= prior) return;
		episodeTierFired.set(episode.id, tier);
		record("failure-episode", "tier-observed", {
			tier, detector: "semantic", mode: EPISODE_MODE,
			failure_class: episode.failureClass, count: episode.count, session_repeats: sessionRepeats,
		});
		if (EPISODE_MODE !== "enforce") return;
		mergePending({
			tier, detector: "semantic", episode,
			exactRepeatedFps: [...strategies.values()].filter((entry) => entry.count > 1).map((entry) => entry.fp),
			count: episode.count,
		});
	}

	function processEpisodeResult(
		callId: string,
		toolName: string,
		args: Record<string, unknown>,
		isError: boolean,
		text: string,
	): void {
		if (EPISODE_MODE === "off" || episodeProcessed.has(callId)) return;
		episodeProcessed.add(callId);
		const observation: FailureObservation = {
			toolName, args, isError, text: text.slice(0, 2048), planItemId: activePlanItemId(),
		};
		if (!isFailureObservation(observation)) {
			recordRecovery(episodeTracker.observeSuccess({ toolName, args }));
			publishEpisodes();
			return;
		}
		const { episode, opened } = episodeTracker.observeFailure(observation);
		if (opened) {
			record("failure-episode", "opened", {
				episode_id: episode.id,
				failure_class: episode.failureClass,
				tool_family: episode.toolFamily,
				target_hash: episode.targetHash,
				plan_item_hash: episode.planItemHash,
			});
		}
		record("failure-episode", "observed", {
			episode_id: episode.id,
			failure_class: episode.failureClass,
			count: episode.count,
			calls_after_second: episode.callsAfterSecond,
			strategy_count: episode.strategyHashes.length,
		});
		observeSemanticTier(episode, toolName, args);
		publishEpisodes();
	}

	async function applyPendingAction(ctx: {
		cwd: string;
		abort(): void;
		ui: { notify(message: string, level?: "info" | "warning" | "error"): void };
	}, turnIndex: number): Promise<LoopTier> {
		const action = pendingAction;
		pendingAction = null;
		if (!action || EPISODE_MODE !== "enforce") return 0;
		const failureClass = action.episode?.failureClass ?? "unknown";
		let message = "";
		if (action.tier === 1) {
			message = `[loop-breaker] failure_class=${failureClass} repeated. Change strategy family, delegate, or report Blocked.`;
		} else if (action.tier === 2) {
			message = `[loop-breaker] failure_class=${failureClass} persists after a strategy change. Delegate or report Blocked; do not retry the same approach.`;
		}
		record("failure-episode", "intervention", {
			tier: action.tier, detector: action.detector, failure_class: failureClass,
			count: action.count, session_repeats: sessionRepeats, injected_chars: message.length,
			turnIndex,
		});
		if (action.tier < 3) {
			pi.sendUserMessage(message, { deliverAs: "steer" });
			return action.tier;
		}

		for (const fp of action.exactRepeatedFps) ep.blocked.add(fp);
		const gate = (globalThis as Record<string, unknown>).__pi_vg_state as
			{ mutated?: unknown; verifiedOk?: unknown } | undefined;
		const episode = action.episode ?? {
			key: sha256(`session-repeat:${sessionRepeats}`),
			planItemHash: planItemHash(activePlanItemId()),
			failureClass: "unknown" as const,
			toolFamily: "session_repeat",
			strategyHashes: [],
		};
		const receipt = recoveryReceipt(episode, gate, process.env.HARNESS_SURFACE_SHA256);
		let persisted = false;
		try {
			await writeLoopRecoveryReceipt(ctx.cwd, receipt);
			persisted = true;
			(globalThis as Record<string, unknown>).__pi_loop_recovery_receipt = receipt;
		} catch { /* abort remains the safe outcome even if private persistence fails */ }
		record("failure-episode", "receipt", { persisted, strategy_count: receipt.strategy_family_hashes.length });
		abortArmed = true;
		ctx.ui.notify(`loop-breaker: semantic tier 3 — aborting run (failure_class=${failureClass})`, "error");
		ctx.abort();
		return 3;
	}

	function reconcileExactGate(): void {
		if (EPISODE_MODE === "off") return;
		const state = (globalThis as Record<string, unknown>).__pi_vg_state as
			{ gateCmd?: unknown; mutated?: unknown; verifiedOk?: unknown } | undefined;
		if (state?.mutated !== true || state.verifiedOk !== true) return;
		const command = typeof state.gateCmd === "string" ? state.gateCmd : "project gate";
		recordRecovery(episodeTracker.observeSuccess(
			{ toolName: "bash", args: { command }, verifiedExact: true }, "exact_gate",
		));
	}

	function recoverProvider(kind: RecoveryKind = "provider_first_token"): void {
		if (EPISODE_MODE === "off" || providerRecovered) return;
		providerRecovered = true;
		recordRecovery(episodeTracker.observeSuccess({ toolName: "provider", args: {} }, kind));
	}

	pi.on("session_start", async () => {
		resetEpisode();
		resetOutcomes();
		// SESSION-scoped counters live at module scope, and pi's loader returns the
		// CACHED factory across session replacement (loader.js:318-322 — the cache is
		// only cleared on cwd change), so "module scope" really means "until the cwd
		// changes", not "until the session ends". Without these resets a /new, /fork
		// or same-cwd /resume inherited the previous session's repeat tallies, and
		// sessionRepeatFired — assigned once and never cleared — permanently disabled
		// the LB_SESSION_REPEAT steer for the rest of the process. The stale number is
		// model-visible: blackboard.ts:127-128 copies __pi_lb_state into the c48 lens
		// and renders it as "repeats this session: N", immediately after
		// session-blackboard deliberately cleared the board to prevent exactly that.
		// (No gate impact: real_gate.sh runs one session per pi process.)
		sessionSeenCalls.clear();
		sessionCallCounts.clear();
		sessionRepeats = 0;
		sessionRepeatFired = false;
		delete (globalThis as Record<string, unknown>).__pi_lb_state;
		executionEnds.clear();
		episodeTracker.reset();
		episodeArgs.clear();
		episodeProcessed.clear();
		episodeTierFired.clear();
		exactStrategies.clear();
		sessionTierFired.clear();
		pendingAction = null;
		providerRequest = 0;
		providerRecovered = true;
		delete (globalThis as Record<string, unknown>).__pi_failure_episode_state;
		delete (globalThis as Record<string, unknown>).__pi_loop_recovery_receipt;
	});

	pi.registerCommand("loop-status", {
		description: "Show the redacted semantic failure-episode and repeat-tail state.",
		handler: async (_args, ctx) => {
			const active = episodeTracker.activeEpisodes();
			const lines = [
				`loop-status: mode=${EPISODE_MODE}; active=${active.length}; session_repeats=${sessionRepeats}; exact_walls=${ep.blocked.size}`,
				...active.slice(0, 8).map((episode) =>
					`- failure_class=${episode.failureClass}; tool_family=${episode.toolFamily}; attempts=${episode.count}; recovery=pending`),
			];
			ctx.ui.notify(lines.join("\n"), active.length > 0 ? "warning" : "info");
		},
	});

	pi.registerCommand("loop-resume", {
		description: "Clear semantic episode walls and send one deterministic recovery instruction.",
		handler: async (_args, _ctx) => {
			const blocked = ep.blocked.size;
			ep.blocked.clear();
			abortArmed = false;
			pendingAction = null;
			const cleared = episodeTracker.clearActive();
			recordRecovery(cleared);
			const message = "[loop-breaker] Recovery walls cleared. Re-ground from the current plan and exact-gate state; use a different strategy or report Blocked.";
			record("failure-episode", "resumed", { cleared: cleared.length, blocked, injected_chars: message.length });
			publishEpisodes();
			pi.sendUserMessage(message, { deliverAs: "steer" });
		},
	});

	pi.on("tool_execution_start", async (event) => {
		if (EPISODE_MODE === "off") return;
		episodeArgs.set(event.toolCallId, (event.args ?? {}) as Record<string, unknown>);
		episodeTracker.noteToolCall();
		publishEpisodes();
	});

	pi.on("tool_execution_end", async (event) => {
		const text = boundedResultText(event.result);
		executionEnds.set(event.toolCallId, { toolName: event.toolName, isError: event.isError === true, text });
		const args = episodeArgs.get(event.toolCallId) ?? {};
		episodeArgs.delete(event.toolCallId);
		processEpisodeResult(event.toolCallId, event.toolName, args, event.isError === true, text);
	});

	pi.on("tool_result", async (event) => {
		processEpisodeResult(
			event.toolCallId,
			event.toolName,
			(event.input ?? {}) as Record<string, unknown>,
			event.isError === true,
			boundedResultText({ content: event.content }),
		);
	});

	pi.on("before_provider_request", async () => {
		providerRequest += 1;
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (EPISODE_MODE === "off" || event.status < 400) return;
		providerRecovered = false;
		processEpisodeResult(
			`provider-${providerRequest}`,
			"provider",
			{ provider: ctx.model?.provider ?? "unknown" },
			true,
			`provider HTTP ${event.status}`,
		);
	});

	pi.on("message_update", async () => { recoverProvider(); });
	pi.on("turn_start", async () => { reconcileExactGate(); });
	pi.on("agent_settled", async () => {
		reconcileExactGate();
		if (EPISODE_MODE === "off") return;
		const settled = episodeTracker.settle();
		for (const episode of settled) {
			episodeTierFired.delete(episode.id);
			exactStrategies.delete(episode.id);
		}
		pendingAction = null;
		const summary = episodeTracker.snapshot();
		record("failure-episode", "settled", {
			total_episodes: summary.totalEpisodes,
			total_failures: summary.totalFailures,
			longest_episode: summary.longestEpisode,
			semantic_failure_overrun: summary.semanticFailureOverrun,
			settled_without_recovery: summary.settledWithoutRecovery,
		});
		publishEpisodes();
		episodeArgs.clear();
		episodeProcessed.clear();
	});

	// turnIndex is NOT monotonic across a session: agent-session.js's `_turnIndex = 0`
	// in its agent_start path zeroes
	// _turnIndex on every agent_start, and agent_start fires again on retry
	// (retry.enabled), on auto-compaction, and on any message queued with
	// triggerTurn (compact-tool does this). loop-breaker keeps its episode across
	// those, so `event.turnIndex - ep.lastSteerTurn` below goes NEGATIVE — and
	// nothing rejects it: the catalog types turns_since as a bare number and
	// telemetry-report.sh takes its median. Drop the anchor instead, so a
	// straddling steer emits no record rather than a nonsense delta. Same fix as
	// context-dedup.ts:38-46 and session-blackboard.ts.
	pi.on("agent_start", async () => {
		ep.lastSteerTurn = null;
	});

	// Compaction erases file contents from the window: re-reading them afterward
	// is NECESSARY, not a loop. Clear counters and walls (outcome state stays —
	// a stuck failing result is still stuck after compaction).
	pi.on("session_compact", async () => {
		record("loop-breaker", "compact-reset", { streak: ep.streak, blocked: ep.blocked.size });
		resetEpisode();
	});

	// Detection + escalation.
	pi.on("turn_end", async (event, ctx) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		const isLocal = String(msg.provider ?? "").startsWith("local");
		if (LOCAL_ONLY && !isLocal) return;

		// Per-turn tiers by model class (local loops sooner → fires earlier).
		const REPEAT_T1 = thresh("LB_REPEAT_T1", 3, 2, isLocal);
		const REPEAT_T2 = thresh("LB_REPEAT_T2", 5, 3, isLocal);
		const REPEAT_T3 = thresh("LB_REPEAT_T3", 8, 5, isLocal);
		const STREAK_SOFT = thresh("LB_STREAK_SOFT", 12, 8, isLocal);
		const STREAK_HARD = thresh("LB_STREAK_HARD", 30, 20, isLocal);
		const OUTCOME_T1 = thresh("LB_OUTCOME_T1", 3, 2, isLocal);

		const toolCalls: { id: string; name: string; args: Record<string, unknown> }[] = [];
		let thinkingText = "";
		for (const block of msg.content) {
			if (block.type === "toolCall") {
				toolCalls.push({ id: block.id, name: block.name, args: (block.arguments ?? {}) as Record<string, unknown> });
			} else if (block.type === "thinking") {
				thinkingText += ` ${block.thinking}`;
			}
		}

		// Outcome-loop scan — BEFORE the progress reset (mutations are part of an
		// outcome loop; this state deliberately survives them).
		const resultCallIds = new Set(event.toolResults.map((result) => result.toolCallId));
		const outcomes = event.toolResults.map((result) => ({
			toolCallId: result.toolCallId,
			toolName: result.toolName,
			isError: result.isError === true,
			text: result.content.map((part) => ("text" in part ? part.text : "")).join(" "),
		}));
		// Pi validation/execute throws can emit tool_execution_end without a
		// tool_result. Bring those rejected plan writes into the same outcome ladder.
		for (const call of toolCalls) {
			const ended = executionEnds.get(call.id);
			if (call.name === "plan_write" && ended?.isError && !resultCallIds.has(call.id)) {
				outcomes.push({ toolCallId: call.id, toolName: "plan_write", isError: true, text: ended.text || "plan_write rejected" });
			}
		}
		for (const r of outcomes) {
			if (!OUTCOME_TOOLS.has(r.toolName)) continue;
			const call = toolCalls.find((candidate) => candidate.id === r.toolCallId);
			const command = call?.name === "bash" ? String(call.args.command ?? "") : "";
			if (!isFailingOutcome(r.toolName, r.text, r.isError, command)) continue;
			const fp = outcomeFp(r.toolName, r.text);
			const n = (outcomeCounts.get(fp) ?? 0) + 1;
			outcomeCounts.set(fp, n);
			if (!outcomeLabels.has(fp)) {
				outcomeLabels.set(fp, r.toolName === "plan_write" ? "plan_write rejection" : call ? labelFor(call.name, call.args) : r.toolName);
			}
			const fired = outcomeFired.get(fp) ?? 0;
			const action = decideOutcomeAction(n, fired, OUTCOME_T1);
			if (action === "steer") {
				outcomeFired.set(fp, fired + 1);
				// Flag for verify-gate: while an outcome loop is active, its "re-run
				// till green" steer contradicts this "stop, change approach" one.
				(globalThis as Record<string, unknown>).__pi_lb_outcome_at = Date.now();
				{
					const msg = outcomeMessage(n, outcomeLabels.get(fp) ?? r.toolName);
					record("loop-breaker", "outcome-steer", { n, injected_chars: msg.length, turnIndex: event.turnIndex });
					pi.sendUserMessage(msg, { deliverAs: "steer" });
				}
			} else if (action === "escalate") {
				// Two ignored steers and the identical failing outcome STILL repeating:
				// a grinder (seen live: 23-48 identical edit failures post-silence).
				// Escalate like tier 3 instead of watching forever.
				outcomeFired.set(fp, fired + 1);
				if (HARD_STOP_MODE === "abort") {
					record("loop-breaker", "outcome-abort", { n, turnIndex: event.turnIndex });
					ctx.ui.notify(`loop-breaker: hard stop — same failing outcome ${n}× (${outcomeLabels.get(fp) ?? r.toolName})`, "error");
					abortArmed = true;
					ctx.abort();
					return;
				}
				{
					const msg = outcomeMessage(n, outcomeLabels.get(fp) ?? r.toolName);
					record("loop-breaker", "outcome-steer", { n, final: true, injected_chars: msg.length, turnIndex: event.turnIndex });
					pi.sendUserMessage(msg, { deliverAs: "steer" });
				}
			}
		}

		// Count session-cumulative repeats BEFORE the progress check below can reset
		// the episode — grinding is exactly the pattern that resets every few turns.
		// Uses fpKey so read pagination (offset 0, 2000, 4000…) is not a repeat.
		sessionRepeats += tallySessionRepeats(sessionSeenCalls, toolCalls);
		for (const call of toolCalls) {
			const fp = fpKey(call.name, call.args);
			sessionCallCounts.set(fp, (sessionCallCounts.get(fp) ?? 0) + 1);
		}
		// Published for the session blackboard (globalThis bus — module state is
		// per-extension under pi's loader, see __pi_lb_outcome_at above).
		(globalThis as Record<string, unknown>).__pi_lb_state = { sessionRepeats, seen: sessionSeenCalls.size, streak: ep.streak };
		const sessionThresholds = EPISODE_MODE === "enforce"
			? sessionEpisodeThresholds()
			: [SESSION_SHADOW_T1, SESSION_SHADOW_T2, SESSION_SHADOW_T3] as [number, number, number];
		const sessionTier = tierForCount(sessionRepeats, ...sessionThresholds);
		let newSessionTier: LoopTier = 0;
		for (const observedTier of [1, 2, 3] as const) {
			if (observedTier > sessionTier || sessionTierFired.has(observedTier)) continue;
			sessionTierFired.add(observedTier);
			newSessionTier = observedTier;
			record("failure-episode", "tier-observed", {
				tier: observedTier, detector: "session", mode: EPISODE_MODE,
				failure_class: "unknown", count: sessionRepeats, session_repeats: sessionRepeats,
			});
		}
		if (EPISODE_MODE === "enforce" && newSessionTier > 0) {
			mergePending({
				tier: newSessionTier as Exclude<LoopTier, 0>, detector: "session", episode: null,
				exactRepeatedFps: [...sessionCallCounts.entries()].filter(([, count]) => count > 1).map(([fp]) => fp),
				count: sessionRepeats,
			});
		}
		const episodeIntervention = await applyPendingAction(ctx, event.turnIndex);
		if (episodeIntervention === 3) return;

		if (EPISODE_MODE !== "enforce" && !sessionRepeatFired && sessionRepeats >= SESSION_REPEAT_LIMIT) {
			sessionRepeatFired = true; // steer once per session, never nag
			record("loop-breaker", "session-repeat", { repeats: sessionRepeats, turnIndex: event.turnIndex });
			const msg = steerText(
				"LB_SESSION_REPEAT",
				"[loop-breaker] You have repeated {repeats} tool calls this session. Repeating them is not " +
					"working. Stop, state what you actually know, and either change approach or report Blocked " +
					"with what you tried.",
				{ repeats: sessionRepeats },
			);
			pi.sendUserMessage(msg, { deliverAs: "steer" });
		}

		// Progress = an edit/write/plan_write tool, a file-mutating bash command,
		// or a turn with no tool calls (a final/text answer). Any of these means
		// the model is acting, not looping → reset.
		const hasProgress =
			toolCalls.length === 0 ||
			toolCalls.some((c) => PROGRESS_TOOLS.has(c.name)) ||
			toolCalls.some((c) => c.name === "plan_write" && executionEnds.get(c.id)?.isError === false) ||
			toolCalls.some((c) => c.name === "bash" && isBashMutation(String(c.args.command ?? "")));
		for (const call of toolCalls) executionEnds.delete(call.id);
		if (hasProgress) {
			// Compliance signal: the model made progress after being steered — how
			// many turns did the steer take to land?
			if (ep.lastSteerTurn !== null) {
				record("loop-breaker", "progress-after-steer", { turns_since: event.turnIndex - ep.lastSteerTurn });
			}
			resetEpisode();
			// A mutation/final-answer turn means the model moved past whatever it was
			// stuck on — stop suppressing verify-gate's nag for the rest of the 120s
			// window on an outcome loop that's no longer active.
			delete (globalThis as Record<string, unknown>).__pi_lb_outcome_at;
			return;
		}

		ep.streak += 1;

		let maxTool = 0;
		let worstFp = "";
		for (const c of toolCalls) {
			const fp = fpKey(c.name, c.args);
			const n = (ep.toolCounts.get(fp) ?? 0) + 1;
			ep.toolCounts.set(fp, n);
			if (!ep.labels.has(fp)) ep.labels.set(fp, labelFor(c.name, c.args));
			if (n >= maxTool) {
				maxTool = n;
				worstFp = fp;
			}
		}

		let maxReason = 0;
		const norm = normText(thinkingText);
		if (norm.length >= MIN_REASON_LEN) {
			const rfp = hash(norm);
			maxReason = (ep.reasonCounts.get(rfp) ?? 0) + 1;
			ep.reasonCounts.set(rfp, maxReason);
		}

		// Repetition is the loop signal and drives every tier. A bare read streak
		// only ever nudges (T1) or, far out, hard-stops (T3) — a long varied
		// investigation is not a loop.
		const repeat = Math.max(maxTool, maxReason);
		const d = decideTier(maxTool, maxReason, ep.streak, {
			t1: REPEAT_T1, t2: REPEAT_T2, t3: REPEAT_T3, streakSoft: STREAK_SOFT, streakHard: STREAK_HARD,
		});
		const tier = d.tier;
		if (episodeIntervention > 0) return;

		if (tier === 0 || ep.steered.has(tier)) return;
		for (let l = 1; l <= tier; l++) ep.steered.add(l);
		ep.lastSteerTurn = event.turnIndex;

		const label = ep.labels.get(worstFp) ?? "the same action";
		// Pre-build the steer text so its size is logged with the event. Abort mode
		// (tier 3) injects nothing, so its injected_chars is honestly 0.
		const didBlock = tier === 2 && d.blockWorst && !!worstFp;
		let steerMsg = "";
		if (tier === 1) steerMsg = tier1Message(label, repeat, ep.streak, d.byToolRepeat, d.byReasonRepeat);
		else if (tier === 2) steerMsg = tier2Message(label, ep.streak, didBlock);
		else if (HARD_STOP_MODE !== "abort") steerMsg = tier3Message(ep.streak);

		record("loop-breaker", "steer", {
			tier, byTool: d.byToolRepeat, byReason: d.byReasonRepeat,
			repeat, streak: ep.streak, injected_chars: steerMsg.length, turnIndex: event.turnIndex,
		});

		if (tier === 1) {
			pi.sendUserMessage(steerMsg, { deliverAs: "steer" });
			return;
		}

		if (tier === 2) {
			if (didBlock) ep.blocked.add(worstFp);
			pi.sendUserMessage(steerMsg, { deliverAs: "steer" });
			return;
		}

		// tier 3 — wall every genuinely repeated fingerprint and stop firmly.
		for (const [fp, n] of ep.toolCounts) {
			if (n >= REPEAT_T1) ep.blocked.add(fp);
		}
		if (HARD_STOP_MODE === "shutdown") {
			pi.sendUserMessage(steerMsg, { deliverAs: "steer" });
			ctx.ui.notify("loop-breaker: hard stop — shutting down pi", "error");
			ctx.shutdown();
			return;
		}
		if (HARD_STOP_MODE === "abort") {
			// NO steer here: a corrective user message would fight the abort and can
			// restart the run if the abort lands first.
			// Notify the UI, arm the mid-turn
			// backstop, and stop.
			record("loop-breaker", "abort", { streak: ep.streak, turnIndex: event.turnIndex });
			ctx.ui.notify(`loop-breaker: hard stop — aborting run (${ep.streak} turns, no progress)`, "error");
			// Fresh counters so a NEW loop after the stop escalates from scratch;
			// keep the walls (blocked persists until real progress) and stay armed.
			const blocked = ep.blocked;
			ep = newEpisode();
			ep.blocked = blocked;
			abortArmed = true; // backstop: abort on the next looping tool call (reliable mid-turn hook)
			ctx.abort(); // best-effort stop now — no-op if already idle between turns
			return;
		}
		// "block" mode: steer + wall, run continues. Reset counters (keep walls) so
		// continued looping can escalate again instead of latching silent forever.
		pi.sendUserMessage(tier3Message(ep.streak), { deliverAs: "steer" });
		const blocked = ep.blocked;
		ep = newEpisode();
		ep.blocked = blocked;
	});

	// Tier 2/3 enforcement: block the specific repeated call(s).
	pi.on("tool_call", async (event, ctx) => {
		const fp = fpKey(event.toolName, (event.input ?? {}) as Record<string, unknown>);
		if (!ep.blocked.has(fp)) return;
		record("loop-breaker", "block", { tool: event.toolName, abortArmed });
		if (abortArmed) {
			abortArmed = false; // one-shot: stop the looping run, then fall back to plain blocking
			ctx.abort();
		}
		return {
			block: true,
			reason:
				`failure_class=cross_turn_loop. This exact ${event.toolName} call repeated with no edit — blocked. ` +
				`Use what you have: edit, or mark blocked + stop. Re-running stays blocked.`,
		};
	});
}
