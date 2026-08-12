// Session blackboard: bounded working memory derived from harness events.
// Pure reducer + renderers; the store lives on globalThis (pi gives each
// extension its own module instance, so module scope cannot be shared — same
// constraint as telemetry.ts's caches and compaction-coordinator's fix).
import { createHash } from "node:crypto";
import type { HarnessSignalV1 } from "./harness-signals.ts";
import type { RunStateV1 } from "./run-kernel-types.ts";
import { basename, isAbsolute } from "node:path";
import { classifyFailure, isFailureClass, type FailureClass } from "./failure-episodes.ts";

// Nothing here is model-visible; the state-lens renderer's OUTPUT becomes
// model-visible only when session-blackboard.ts injects it under STATE_LENS.

export type AttemptRecord = {
	label: string;
	count: number;
	errors: number;
	lastError: FailureClass | null;
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
		rec.lastError = classifyFailure({
			toolName: call.toolName,
			args: call.args,
			text: typeof call.errorText === "string" ? call.errorText : "",
			isError: true,
		});
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

// Deterministic and bounded. Failing attempts first (that's what
// a spiraling model most needs), then verify state, then plan, then context.
export function renderLens(state: BlackboardState, maxChars: number): string {
	const failing = Object.values(state.attempts)
		.filter((a) => a.errors > 0)
		.sort((a, b) => b.errors - a.errors || b.lastTurn - a.lastTurn)
		.slice(0, 6)
		.map((a) => `${a.label} ×${a.count}${a.errors ? ` FAIL(${a.lastError ?? "unknown"})` : ""}`);
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
	return clip(`[harness summary]\n${body}`, Math.max(200, maxChars));
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

const isObject = (value: unknown): value is Record<string, unknown> =>
	value !== null && typeof value === "object" && !Array.isArray(value);
// Restored counters are COUNTS: non-negative integers with a sane ceiling. Any
// finite number admitted -1, 0.5 and 1e308 into model-visible summaries ("open",
// repeat counts, gate fails), and a nonsensical magnitude dominates a small
// model's reading even without classic injection.
const MAX_RESTORED_COUNT = 1_000_000;
const count = (value: unknown): number | null =>
	Number.isFinite(value) ? Math.min(MAX_RESTORED_COUNT, Math.max(0, Math.trunc(Number(value)))) : null;
const percentage = (value: unknown): number | null =>
	Number.isFinite(value) ? Math.min(100, Math.max(0, Number(value))) : null;
const ratio = (value: unknown): number | null =>
	Number.isFinite(value) ? Math.min(1, Math.max(0, Number(value))) : null;
const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

/** Every string that can reach the lens is re-sanitized here, on the way IN. */
function safeText(value: unknown, max = 90): string | null {
	return typeof value === "string" && value.length > 0 ? clip(redact(norm(value)), max) || null : null;
}

function restoredFailureClass(value: unknown): FailureClass | null {
	if (value === null || value === undefined || value === "") return null;
	return isFailureClass(value) ? value : "unknown";
}

// A label is a bounded TOOL IDENTITY, not free text. The write path emits
// exactly four shapes — `bash <exe>[ <sub>]`, `<tool> <path>`,
// `subagent(<agent>)`, `<tool>` — i.e. at most three safeAtom-charset tokens.
// Validating that shape (rather than re-running safeAtom, which would mangle
// every legitimate "bash npm test" into "bash?npm?test" and silently change
// resumed sessions) keeps honest labels byte-identical while a restored
// sentence — the injection vector, which is necessarily many tokens — cannot
// masquerade as one.
const LABEL_ATOM_RE = /^[a-zA-Z0-9_.:@/()-]+$/;
function restoredLabel(value: unknown): string | null {
	const text = safeText(value, 60);
	if (text === null) return null;
	const tokens = text.split(" ").filter(Boolean);
	if (tokens.length <= 3 && tokens.every((token) => LABEL_ATOM_RE.test(token))) return tokens.join(" ");
	// Not a label the harness could have written: keep only the leading atom.
	return safeAtom(tokens[0] ?? "") || null;
}

// Persisted board state is UNTRUSTED INPUT, exactly like a run-capsule entry
// (run-capsule-store.ts validEntry is the in-repo exemplar this mirrors).
// `v === 2` is a version LABEL, not a shape check: a wrong-typed field used to
// survive `Object.assign` and then either crash renderLens for the rest of the
// session (with the corrupt board still installed and the failure swallowed) or
// — worse — carry hostile prose into a model-visible harness summary. SEVEN
// slots were raw-interpolated, not
// the two originally reported, and numeric slots are string-injection sites
// because they are template-interpolated without coercion.
//
// Fails CLOSED: anything that does not type-check is dropped, never coerced,
// and a state that is not an object at all yields null so the caller can record
// the rejection instead of silently running on a half-restored board.
function sanitizeState(data: unknown): BlackboardState | null {
	if (!isObject(data)) return null;
	const next = emptyState();
	next.turn = count(data.turn) ?? 0;
	next.compactions = count(data.compactions) ?? 0;
	if (isObject(data.attempts)) {
		// Aggregate cap: an oversized restored ledger costs synchronous parse and
		// iteration time on every render, and the lens only shows the top few.
		const MAX_RESTORED_ATTEMPTS = 200;
		let admitted = 0;
		for (const [key, value] of Object.entries(data.attempts)) {
			if (admitted >= MAX_RESTORED_ATTEMPTS) break;
			// Keys are sha256 hex on the write path (attemptKey); anything else is foreign.
			if (!/^[a-f0-9]{64}$/.test(key) || !isObject(value)) continue;
			const label = restoredLabel(value.label);
			if (label === null) continue;
			admitted += 1;
			next.attempts[key] = {
				label,
				count: count(value.count) ?? 0,
				errors: count(value.errors) ?? 0,
				lastError: restoredFailureClass(value.lastError),
				lastTurn: count(value.lastTurn) ?? 0,
			};
		}
	}
	if (Array.isArray(data.delegations)) {
		next.delegations = data.delegations.filter(isObject).slice(0, 50).map((item) => ({
			agent: safeAtom(safeText(item.agent, 40) ?? "?"),
			mode: safeAtom(safeText(item.mode, 20) ?? "?"),
			ok: bool(item.ok) ?? false,
			turn: count(item.turn) ?? 0,
		}));
	}
	if (isObject(data.plan)) {
		const gate = isObject(data.plan.lastGate) ? data.plan.lastGate : null;
		next.plan = {
			runId: safeText(data.plan.runId, 64) === null ? null : safeAtom(safeText(data.plan.runId, 64) as string),
			itemId: safeText(data.plan.itemId, 64) === null ? null : safeAtom(safeText(data.plan.itemId, 64) as string),
			lastGate: gate ? { pass: bool(gate.pass) ?? false, fails: count(gate.fails) ?? 0 } : null,
			openItems: count(data.plan.openItems),
		};
	}
	if (isObject(data.verify)) {
		next.verify = {
			gateCmd: safeText(data.verify.gateCmd, 80),
			mutated: bool(data.verify.mutated) ?? false,
			verifiedOk: bool(data.verify.verifiedOk) ?? false,
			fires: count(data.verify.fires) ?? 0,
			sessionFires: count(data.verify.sessionFires) ?? 0,
		};
	}
	if (isObject(data.loop)) {
		next.loop = {
			sessionRepeats: count(data.loop.sessionRepeats) ?? 0,
			seen: count(data.loop.seen) ?? 0,
			streak: count(data.loop.streak) ?? 0,
		};
	}
	if (isObject(data.context)) {
		next.context = {
			pct: percentage(data.context.pct), staleShare: ratio(data.context.staleShare), dupShare: ratio(data.context.dupShare),
		};
	}
	if (isObject(data.research)) {
		next.research = {
			searches: count(data.research.searches) ?? 0, reads: count(data.research.reads) ?? 0,
			notes: count(data.research.notes) ?? 0, notesRejected: count(data.research.notesRejected) ?? 0,
			cacheHits: count(data.research.cacheHits) ?? 0,
		};
	}
	return next;
}

/** @returns true when a board was installed; false when the state was rejected. */
export function restore(data: unknown): boolean {
	if (!data || typeof data !== "object") return false;
	const raw = data as Record<string, unknown>;
	const version = raw.v;
	// v1 persisted raw commands, paths, delegation labels and errors, so its
	// ledger is dropped wholesale; both versions now go through one validator
	// (the v1 branch's "retain only validated aggregate state" was never true —
	// it spread four foreign objects unchecked).
	if (version !== 1 && version !== 2) return false;
	const next = sanitizeState(raw);
	if (!next) return false;
	if (version === 1) { next.attempts = {}; next.delegations = []; }
	Object.assign(boardState(), next);
	return true;
}
