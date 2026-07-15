import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isBashMutation, looksFailingOutput } from "../lib/command-policy.ts";
import { decideOutcomeAction } from "../lib/loop-outcome.ts";
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
const LOCAL_ONLY = process.env.LB_LOCAL_ONLY === "1";
// Tier-3 action. Default "abort" — gracefully stop the looping run (return to idle,
// pi stays alive, the outer ralph/gate or the user takes over). "shutdown" kills pi;
// "block" is the old soft behavior (block the repeated call, let the run continue).
export function resolveStopMode(env: string | undefined): "block" | "abort" | "shutdown" {
	return env === "shutdown" ? "shutdown" : env === "block" ? "block" : "abort";
}
const HARD_STOP_MODE = resolveStopMode(process.env.LB_HARD_STOP);

// Tools that count as progress (reset the loop episode). Everything else
// (read, bash, grep, find, ls, ...) is non-progress.
const PROGRESS_TOOLS = new Set(["edit", "write", "plan_write"]);

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
function resetEpisode(): void {
	ep = newEpisode();
	abortArmed = false;
}

// ---------- outcome-loop detector ----------

// Only tools whose result is an OUTCOME (command output, apply result). Never
// read/grep/find — their results are file CONTENT; a file containing "FAILED"
// must not register as a failing outcome.
const OUTCOME_TOOLS = new Set(["bash", "edit", "write", "multiedit"]);

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
	pi.on("session_start", async () => {
		resetEpisode();
		resetOutcomes();
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
		for (const r of event.toolResults) {
			if (!OUTCOME_TOOLS.has(r.toolName)) continue;
			const text = r.content.map((c) => ("text" in c ? c.text : "")).join(" ");
			if (!looksFailingOutput(text, r.isError)) continue;
			const fp = outcomeFp(r.toolName, text);
			const n = (outcomeCounts.get(fp) ?? 0) + 1;
			outcomeCounts.set(fp, n);
			if (!outcomeLabels.has(fp)) {
				const call = toolCalls.find((c) => c.id === r.toolCallId);
				outcomeLabels.set(fp, call ? labelFor(call.name, call.args) : r.toolName);
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

		// Progress = an edit/write/plan_write tool, a file-mutating bash command,
		// or a turn with no tool calls (a final/text answer). Any of these means
		// the model is acting, not looping → reset.
		const hasProgress =
			toolCalls.length === 0 ||
			toolCalls.some((c) => PROGRESS_TOOLS.has(c.name)) ||
			toolCalls.some((c) => c.name === "bash" && isBashMutation(String(c.args.command ?? "")));
		if (hasProgress) {
			// Compliance signal: the model made progress after being steered — how
			// many turns did the steer take to land?
			if (ep.lastSteerTurn !== null) {
				record("loop-breaker", "progress-after-steer", { turns_since: event.turnIndex - ep.lastSteerTurn });
			}
			resetEpisode();
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
