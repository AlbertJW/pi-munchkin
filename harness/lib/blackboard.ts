// Session blackboard: ground-truth working memory derived from harness events.
// Pure reducer + renderers; the store lives on globalThis (pi gives each
// extension its own module instance, so module scope cannot be shared — same
// constraint as telemetry.ts's caches and compaction-coordinator's fix).
import { createHash } from "node:crypto";
import type { HarnessSignalV1 } from "./harness-signals.ts";
import type { RunStateV1 } from "./run-kernel-types.ts";
import { basename, isAbsolute } from "node:path";

// Nothing here is model-visible; the state-lens renderer's OUTPUT becomes
// model-visible only when session-blackboard.ts injects it under STATE_LENS.

export type AttemptRecord = {
	label: string;
	count: number;
	errors: number;
	lastError: string | null;
	lastTurn: number;
};

export type BlackboardState = {
	v: 2;
	turn: number;
	compactions: number;
	attempts: Record<string, AttemptRecord>;
	delegations: { agent: string; mode: string; ok: boolean; turn: number }[];
	plan: {
		runId: string | null;
		itemId: string | null;
		lastGate: { pass: boolean; fails: number } | null;
		openItems: number | null;
	};
	verify: { gateCmd: string | null; mutated: boolean; verifiedOk: boolean; fires: number; sessionFires: number } | null;
	loop: { sessionRepeats: number; seen: number; streak: number } | null;
	context: { pct: number | null; staleShare: number | null; dupShare: number | null };
	// Deep-research counts only (RESEARCH_LEDGER=on). Counts, never URLs/queries —
	// the provenance lives in the ledger FILE, and telemetry bans URL fields.
	research: { searches: number; reads: number; notes: number; notesRejected: number; cacheHits: number } | null;
};

export function emptyState(): BlackboardState {
	return {
		v: 2, turn: 0, compactions: 0, attempts: {}, delegations: [],
		plan: { runId: null, itemId: null, lastGate: null, openItems: null },
		verify: null, loop: null,
		context: { pct: null, staleShare: null, dupShare: null },
		research: null,
	};
}

export function boardState(): BlackboardState {
	const g = globalThis as Record<string, unknown>;
	if (!g.__pi_blackboard_v2) g.__pi_blackboard_v2 = emptyState();
	return g.__pi_blackboard_v2 as BlackboardState;
}

export function resetBoard(state: BlackboardState = boardState()): void {
	Object.assign(state, emptyState());
}

const norm = (s: string) => s.trim().replace(/\s+/g, " ");
const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);
const safeAtom = (s: string) => clip(s.replace(/[^a-zA-Z0-9_.:@/-]/g, "?"), 40);
const redact = (s: string) => s
	.replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/gi, "[redacted]")
	.replace(/\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/gi, "$1=[redacted]")
	.replace(/\/Users\/[^/\s]+|\/home\/[^/\s]+/g, "~");

function canonical(value: unknown): string {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

function displayPath(value: string): string {
	const cleaned = redact(value);
	return isAbsolute(value) ? `…/${safeAtom(basename(cleaned))}` : clip(cleaned, 60);
}

function bashSummary(command: string): string {
	if (/^bash [a-z0-9_.:@-]+(?: [a-z0-9:_-]+)?$/i.test(command)) return command;
	const segment = norm(command).split(/(?:&&|\|\||[;|])/u, 1)[0] ?? "";
	const tokens = segment.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
	while (tokens[0] && /^(?:sudo|env|command|timeout)$/i.test(tokens[0])) tokens.shift();
	while (tokens[0] && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) tokens.shift();
	const executable = safeAtom((tokens.shift() ?? "command").replace(/^.*\//, ""));
	const subcommandTools = new Set(["npm", "pnpm", "yarn", "git", "cargo", "go", "ruff", "python", "python3", "node", "just", "make"]);
	const candidate = tokens.find((token) => !token.startsWith("-"))?.replace(/^['"]|['"]$/g, "");
	const subcommand = subcommandTools.has(executable.toLowerCase()) && candidate && /^[a-z0-9:_-]{1,24}$/i.test(candidate)
		? candidate : undefined;
	return `bash ${executable}${subcommand ? ` ${safeAtom(subcommand)}` : ""}`;
}

// Ledger key: tool + its primary argument, normalized. Deliberately NOT
// loop-breaker's fpKey (that would import an extension from a lib); the ledger
// is an independent view and only needs stability, not parity.
export function attemptKey(toolName: string, args: Record<string, unknown>): string {
	let identity: unknown = args;
	if (toolName === "bash" && typeof args.command === "string") identity = { command: norm(args.command).toLowerCase() };
	else if ((toolName === "read" || toolName === "edit" || toolName === "write") && typeof args.path === "string") identity = { path: norm(args.path) };
	else if (toolName === "subagent" && typeof args.agent === "string") identity = { agent: norm(args.agent).toLowerCase() };
	return createHash("sha256").update(`${toolName}\0${canonical(identity)}`).digest("hex");
}

export function attemptLabel(toolName: string, args: Record<string, unknown>): string {
	if (toolName === "bash" && typeof args.command === "string") return bashSummary(args.command);
	if (typeof args.path === "string") return `${safeAtom(toolName)} ${displayPath(args.path)}`;
	if (toolName === "subagent" && typeof args.agent === "string") return `subagent(${safeAtom(args.agent)})`;
	return toolName;
}

function firstLine(text: unknown): string | null {
	if (typeof text !== "string" || text.length === 0) return null;
	return clip(redact(norm(text.split("\n", 1)[0] ?? "")), 90) || null;
}

export function noteTool(
	state: BlackboardState,
	call: { toolName: string; args: Record<string, unknown>; isError: boolean; errorText?: string | null },
): void {
	const key = attemptKey(call.toolName, call.args);
	const rec = state.attempts[key] ?? {
		label: attemptLabel(call.toolName, call.args), count: 0, errors: 0, lastError: null, lastTurn: 0,
	};
	rec.count += 1;
	rec.lastTurn = state.turn;
	if (call.isError) {
		rec.errors += 1;
		rec.lastError = firstLine(call.errorText) ?? rec.lastError ?? "error";
	}
	state.attempts[key] = rec;
	if (call.toolName === "subagent") {
		state.delegations.push({
			agent: typeof call.args.agent === "string" ? safeAtom(call.args.agent) : "?",
			mode: typeof call.args.mode === "string" ? safeAtom(call.args.mode) : "default",
			ok: !call.isError,
			turn: state.turn,
		});
		if (state.delegations.length > 20) state.delegations.shift();
	}
}

// Folds typed cross-extension facts. Telemetry is only a sink and can be
// disabled without changing blackboard state or control behavior.
export function noteHarnessSignal(state: BlackboardState, signal: HarnessSignalV1): void {
	if (signal.type === "plan/write") {
		state.plan.runId = signal.runIdHash;
		state.plan.openItems = signal.openItems;
	} else if (signal.type === "plan/go") {
		state.plan.runId = signal.runIdHash;
	} else if (signal.type === "plan/gate") {
		state.plan.runId = signal.runIdHash;
		state.plan.lastGate = { pass: signal.pass, fails: signal.fails };
	} else if (signal.type === "context/receipt") {
		state.context = {
			pct: signal.contextPct ?? state.context.pct,
			staleShare: signal.staleShare ?? state.context.staleShare,
			dupShare: signal.duplicateShare ?? state.context.dupShare,
		};
	} else if (signal.type === "context/compacted") {
		state.compactions += 1;
	}
}

/** Pure compatibility projection for human/read-only consumers. The deployed
 * state lens does not call this in capsule shadow mode. */
export function projectRunStateToBlackboard(state: BlackboardState, run: RunStateV1): BlackboardState {
	const projected = structuredClone(state);
	projected.plan.runId = run.identity.runIdHash;
	projected.plan.itemId = run.plan.currentItemHash;
	projected.plan.openItems = run.plan.openItems;
	projected.verify = {
		gateCmd: null,
		mutated: run.mutation.count > 0,
		verifiedOk: run.verification.validAfterMutation,
		fires: state.verify?.fires ?? 0,
		sessionFires: state.verify?.sessionFires ?? 0,
	};
	projected.context.pct = run.context.usagePct;
	projected.compactions = run.context.compactionGeneration;
	return projected;
}

export function syncBus(state: BlackboardState): void {
	const g = globalThis as Record<string, unknown>;
	const lb = g.__pi_lb_state as BlackboardState["loop"] | undefined;
	if (lb) state.loop = { sessionRepeats: lb.sessionRepeats, seen: lb.seen, streak: lb.streak };
	const vg = g.__pi_vg_state as BlackboardState["verify"] | undefined;
	if (vg) state.verify = { ...vg };
	const plan = g.__pi_active_plan_context as { run_id?: string; item_id?: string } | undefined;
	if (plan) {
		state.plan.runId = plan.run_id ?? state.plan.runId;
		state.plan.itemId = plan.item_id ?? state.plan.itemId;
	}
	const research = g.__pi_research_state as
		{ searches?: number; reads?: number; notes?: number; notesRejected?: number; cacheHits?: number } | undefined;
	if (research) {
		state.research = {
			searches: research.searches ?? 0, reads: research.reads ?? 0, notes: research.notes ?? 0,
			notesRejected: research.notesRejected ?? 0, cacheHits: research.cacheHits ?? 0,
		};
	}
}

// ---- state lens (model-visible ONLY when session-blackboard injects it) ----

// Deterministic, bounded, ground-truth-only. Failing attempts first (that's what
// a spiraling model most needs), then verify state, then plan, then context.
export function renderLens(state: BlackboardState, maxChars: number): string {
	const failing = Object.values(state.attempts)
		.filter((a) => a.errors > 0)
		.sort((a, b) => b.errors - a.errors || b.lastTurn - a.lastTurn)
		.slice(0, 6)
		.map((a) => `${a.label} ×${a.count}${a.errors ? ` FAIL(${a.lastError ?? "error"})` : ""}`);
	const research = state.research;
	const researchActive = research != null && (research.notes > 0 || research.notesRejected > 0);
	if (failing.length === 0 && !state.verify?.mutated && state.plan.runId === null && !researchActive) return "";
	const parts: string[] = [];
	if (failing.length) parts.push(`attempted+failing: ${failing.join(" | ")}`);
	// A rejected note means a proposed citation did not record. The lens does NOT
	// diagnose why: notesRejected covers three different causes (quote in no
	// fetched page, quote ambiguous across 2+ pages, ledger write failed) whose
	// remedies differ and even conflict — "re-quote" is actively wrong for the
	// ambiguous case, where the fix is a LONGER, more distinctive span. The tool's
	// own refusal text carries the specific reason; the lens just surfaces that it
	// happened.
	if (researchActive) {
		parts.push(`research: ${research.notes} verified note(s)${research.notesRejected > 0 ? `, ${research.notesRejected} refused (see each tool result for the reason)` : ""}`);
	}
	if (state.verify) {
		parts.push(state.verify.verifiedOk
			? `verified: green${state.verify.gateCmd ? ` (${bashSummary(state.verify.gateCmd)})` : ""}`
			: state.verify.mutated ? `verified: NOT yet${state.verify.gateCmd ? ` — run ${bashSummary(state.verify.gateCmd)}` : ""}` : "");
	}
	if (state.plan.runId) {
		parts.push(`plan: ${state.plan.itemId ?? "active"}${state.plan.openItems != null ? ` (${state.plan.openItems} open)` : ""}${state.plan.lastGate && !state.plan.lastGate.pass ? ` gate-fails:${state.plan.lastGate.fails}` : ""}`);
	}
	if (state.loop && state.loop.sessionRepeats > 0) parts.push(`repeats this session: ${state.loop.sessionRepeats}`);
	const body = parts.filter(Boolean).join("\n");
	if (!body) return "";
	return clip(`[session-state — ground truth from the harness; do not re-derive]\n${body}`, Math.max(200, maxChars));
}

// ---- cockpit (human-only) ----

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function renderCockpitHtml(state: BlackboardState, meta: { cwd: string; renderedAt: string }): string {
	const rows = Object.values(state.attempts)
		.sort((a, b) => b.lastTurn - a.lastTurn)
		.slice(0, 40)
		.map((a) => `<tr><td>${esc(a.label)}</td><td>${a.count}</td><td>${a.errors ? `⛔ ${a.errors}× — <small>${esc(a.lastError ?? "")}</small>` : "✅"}</td><td>${a.lastTurn}</td></tr>`)
		.join("\n");
	const delegs = state.delegations.slice(-8).map((d) => `<li>turn ${d.turn}: ${esc(d.agent)} (${esc(d.mode)}) ${d.ok ? "✅" : "⛔"}</li>`).join("");
	const ctx = state.context;
	return `<!doctype html><html><head><meta charset="utf-8"><title>Session cockpit</title>
<style>body{font:14px/1.5 system-ui;margin:1.5rem auto;max-width:64rem;padding:0 1rem}
table{border-collapse:collapse;width:100%}td,th{border:1px solid #ccc;padding:.3rem .5rem;text-align:left}
small{color:#666}.k{color:#444}</style></head><body>
<h1>Session cockpit</h1>
<p class="k">${esc(displayPath(meta.cwd))} · turn ${state.turn} · rendered ${esc(meta.renderedAt)} · compactions ${state.compactions}</p>
<p>
 verify: <b>${state.verify ? (state.verify.verifiedOk ? "green" : state.verify.mutated ? "UNVERIFIED changes" : "no mutations") : "—"}</b>
 ${state.verify?.gateCmd ? ` <small>(${esc(bashSummary(state.verify.gateCmd))})</small>` : ""}
 · plan: <b>${esc(state.plan.itemId ?? state.plan.runId ?? "none")}</b>${state.plan.openItems != null ? ` <small>${state.plan.openItems} open</small>` : ""}
 · repeats: <b>${state.loop?.sessionRepeats ?? 0}</b>
 · ctx: <b>${ctx.pct != null ? `${Math.round(ctx.pct)}%` : "—"}</b>${ctx.staleShare != null ? ` <small>stale ${Math.round(ctx.staleShare * 100)}%</small>` : ""}
</p>
<h2>Attempt ledger</h2>
<table><tr><th>action</th><th>count</th><th>outcome</th><th>last turn</th></tr>
${rows || "<tr><td colspan=4>none yet</td></tr>"}
</table>
${delegs ? `<h2>Delegations</h2><ul>${delegs}</ul>` : ""}
</body></html>`;
}

export function snapshot(state: BlackboardState): Record<string, unknown> {
	const copy = JSON.parse(JSON.stringify(state)) as BlackboardState;
	if (copy.verify?.gateCmd) copy.verify.gateCmd = bashSummary(copy.verify.gateCmd);
	return copy as unknown as Record<string, unknown>;
}

export function restore(data: unknown): void {
	if (!data || typeof data !== "object") return;
	const raw = data as Partial<BlackboardState> & { v?: unknown };
	if (raw.v === 2) {
		Object.assign(boardState(), emptyState(), raw);
		return;
	}
	if (raw.v === 1) {
		// v1 persisted raw commands, paths, delegation labels, and errors. Retain
		// only validated aggregate state; intentionally reset the sensitive ledger.
		const next = emptyState();
		if (Number.isFinite(raw.turn)) next.turn = Number(raw.turn);
		if (Number.isFinite(raw.compactions)) next.compactions = Number(raw.compactions);
		if (raw.plan && typeof raw.plan === "object") next.plan = { ...next.plan, ...raw.plan };
		if (raw.verify && typeof raw.verify === "object") next.verify = { ...raw.verify } as BlackboardState["verify"];
		if (raw.loop && typeof raw.loop === "object") next.loop = { ...raw.loop } as BlackboardState["loop"];
		if (raw.context && typeof raw.context === "object") next.context = { ...next.context, ...raw.context };
		Object.assign(boardState(), next);
	}
}
