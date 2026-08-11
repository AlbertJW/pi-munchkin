import { appendFile, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertVerifyGateAllowed, classifyBashCommand, normalizeVerificationCommand } from "../lib/command-policy.ts";
import { runReadonlyGate } from "../lib/gate-runtime.ts";
import { buildPlanGateReceipt, publishPlanGateReceipt, type PlanGateOutcome } from "../lib/plan-gate-receipt.ts";
import { planIntegrity, executionUnderway, normalizeTitle, preserveDecision, validateDeps, unmetDeps, reconcileItems as libReconcile, type ReconciledItem, type IncomingItem } from "../lib/plan-integrity.ts";
import { nextReplanStreak, parseTodoLine } from "../lib/plan-progress.ts";
import { processWriterMarker } from "../lib/process-writer.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";
import { agentDir } from "../lib/agent-dir.ts";
import { ACTIVE_TOOL_PROMPTS } from "../lib/active-tool-prompts.ts";
import { emitHarnessSignal, onHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { applyPlanDeltas, type PlanDelta } from "../lib/plan-delta.ts";
import { boundedDirectRequest, planMode, type PlanMode } from "../lib/plan-mode.ts";
import { planStorageMode, privatePlanStatePath } from "../lib/plan-state-storage.ts";

// plan-runner v3 — model-owned TODO list (Claude Code TodoWrite pattern).
// One tool (plan_write) rewrites the whole list each call: re-planning,
// add/remove/reorder, and status updates are all just "call it again".
// Execution happens in pi's natural agent loop — no budget engine, no
// tool-restriction window, no terminate:false re-injection.
//
// Per-item GATES (a "repeater"): set item.gate to a deterministic shell check;
// when the model marks that item done, plan_write runs the gate — exit 0 keeps
// it done, non-zero reverts it (→ in_progress, then blocked after GATE_MAX) and
// tells the model to fix and re-run. Opt-in: items without a gate are unaffected.

// Set in the extension factory so the module-scope tool can run shell gates.
let api: ExtensionAPI | undefined;
const GATE_TIMEOUT_MS = Math.max(1000, Number.parseInt(process.env.PLAN_GATE_TIMEOUT_MS || "60000", 10) || 60000);
const GATE_MAX = Math.max(1, Number.parseInt(process.env.PLAN_GATE_MAX || "3", 10) || 3);
// Plan-thrash threshold: consecutive plan_write calls (this process) that complete
// no item before we warn the model to execute instead of re-plan. Reset on new plan,
// /plan-go, and any call that newly marks an item done.
const REPLAN_MAX = Math.max(2, Number.parseInt(process.env.PLAN_REPLAN_MAX || "3", 10) || 3);
let replanStreak = 0;
// No resumeNotified flag: it was module-scoped, and pi caches the extension
// factory across session replacement, so "notify once" silently meant "once
// per PROCESS" — later /new, /fork or same-cwd /resume sessions never saw the
// interrupted-plan notice at all (triage #26). session_start fires exactly
// once per session, and the writer === PROC_MARK check self-suppresses the
// notice as soon as this process touches the plan, so no flag is needed.
//
// partialWorkNoted had the IDENTICAL lifetime bug and was left behind when
// resumeNotified was removed (a stale comment above it still described both
// flags as intentional one-per-process behaviour). It is per-SESSION state —
// "this session has been told about half-finished work once" — so it must
// reset on session_start, or session 2 after a /new or /fork is never warned
// that partial work may sit on disk.
let partialWorkNoted = false;
let lastSessionCwd: string | null = null;
let lastSessionNotify: ((message: string) => void) | null = null;
let resumeNoticeShown = false;

// RE-BIND to whatever plan this cwd actually has on disk. Clearing alone was a
// half-fix: a same-cwd /resume of a LIVE plan lost a run_id that had been
// correct, and receipts went unattributed until the next writeStateAndTodo. The
// truth is the state file, so derive from it rather than trusting or discarding
// the inherited global. Absent state leaves the key deleted; both readers treat
// that as "no active plan" rather than erroring. Called at session_start AND
// again on capsule/identity (adaptive storage resolves its path lazily, so the
// second call sees the PRIVATE plan the first one could not).
async function rebindActivePlan(cwd: string, notify: (message: string) => void): Promise<void> {
	const state = await readState(cwd);
	if (state) {
		(globalThis as Record<string, unknown>).__pi_active_plan_context = {
			run_id: state.run_id,
			item_id: currentItem(state)?.id,
			open_items: openItemCount(state),
			blocked_items: blockedItemCount(state),
		};
	}
	if (!state || state.writer === PROC_MARK || resumeNoticeShown) return;
	const open = state.items.filter((i) => i.status === "pending" || i.status === "in_progress" || i.status === "blocked");
	if (open.length === 0) return;
	const inProgress = state.items.filter((i) => i.status === "in_progress").length;
	resumeNoticeShown = true;
	planEvent("resume-found", state.run_id, { open: open.length, in_progress: inProgress });
	notify(
		`Interrupted plan from a previous session: "${state.request}" — ${open.length} open item(s)${inProgress ? `, ${inProgress} in_progress (may have partial work)` : ""}. /plan-status to inspect, /plan-go to resume, /plan <request> to replace.`,
	);
}
type ModelIdentity = { provider: string; id: string };
let activeModel: ModelIdentity = { provider: "unknown", id: "unknown" };

function rememberModel(ctx: { model?: { provider?: string; id?: string } }): ModelIdentity {
	if (ctx.model?.provider && ctx.model?.id) activeModel = { provider: ctx.model.provider, id: ctx.model.id };
	return activeModel;
}

function planEvent(kind: string, runId: string, detail: Record<string, unknown> = {}): void {
	record("plan-runner", kind, {
		run_id: runId,
		provider: activeModel.provider,
		model: activeModel.id,
		...detail,
	});
	if (!api) return;
	const runIdHash = signalRunId(runId);
	if (kind === "write" && typeof detail.items === "number" && typeof detail.open_items === "number") {
		emitHarnessSignal(api.events, { v: 1, type: "plan/write", runIdHash, items: detail.items, openItems: detail.open_items });
	} else if (kind === "go") {
		emitHarnessSignal(api.events, { v: 1, type: "plan/go", runIdHash });
	} else if (kind === "gate") {
		emitHarnessSignal(api.events, {
			v: 1, type: "plan/gate", runIdHash, pass: detail.pass === true,
			fails: typeof detail.fails === "number" ? detail.fails : 0,
		});
	}
}
// B yields an omitted open item after this many consecutive preserves (persistent
// omission = intent; e.g. a parent the model replaced with sub-items). R1 (done) never yields.
const PRESERVE_MAX = Math.max(2, Number.parseInt(process.env.PLAN_PRESERVE_MAX || "3", 10) || 3);
// Candidate (dark, A/B via real_gate.sh): force every scoped edit through a fresh
// subagent instead of leaving delegation advisory. Trades per-edit spawn overhead
// for full process isolation of each edit — measure, don't assume, the tradeoff.
const PLAN_SUBAGENT_ONLY = process.env.PLAN_SUBAGENT_ONLY === "1";
// Dark candidate c37: extends c25 from edits-only to EVERYTHING — during
// execution the main session is a thin orchestrator: every plan item is done
// via ONE spawn-mode subagent call (explorer/executor/verifier); the main
// window accumulates only clamped subagent results (runner-events.js caps each
// at 12000 chars). The model decides delegation; the harness only blocks+steers
// (c25 precedent — no engine dispatch).
// c31 (LIVE default-on since 2026-08-07; was dark candidate): a plan-level
// uncertainties[] field with a structural pause — a model that surfaces
// uncertainty must be stopped from guessing past it (deterministic gate, no
// LLM judgment call). npcsh loop_plan port. ADOPTED by judgment
// (Albert-approved; grounds in DARK_CANDIDATE_VERDICTS_2026-08-03.md
// addendum): benefit was not established by a powered trial, and its own
// round evidence says the field went unused when optional.
// PLAN_UNCERTAINTY=off is the kill switch.
const PLAN_UNCERTAINTY = process.env.PLAN_UNCERTAINTY !== "off";
// Dark candidate c32: verify commit SHAs the model writes into notes/summary
// actually exist (git cat-file -e) — catches confabulated provenance.
// c34 (LIVE default-on since 2026-08-07; was dark candidate): the legacy
// "5-10 ordered items" line is an unenforced numeric bound (plan_write's
// schema has no maxItems) — replace with non-numeric, need-sized guidance
// that keeps the same anti-padding / anti-fake-split intent. ADOPTED by
// judgment (Albert-approved); benefit was not established by a powered trial.
// PLAN_ITEM_GUIDANCE_V2=off restores the legacy wording.
const PLAN_ITEM_GUIDANCE_V2 = process.env.PLAN_ITEM_GUIDANCE_V2 !== "off";
// c36 (LIVE default-on since 2026-08-07; was dark candidate): everywhere
// delegation guidance recommends mode=fork for executor work, recommend
// mode=spawn + an explicitly SELF-CONTAINED task — each child starts with a
// small fresh context instead of a parent snapshot. ADOPTED by judgment
// (Albert-approved); benefit was not established by a powered trial.
// SPAWN_DELEGATION=off restores the fork wording (second read site:
// vendor/pi-subagent/types.ts, call-time).
const SPAWN_DELEGATION = process.env.SPAWN_DELEGATION !== "off";
// c38 (LIVE default-on since 2026-08-07; was dark candidate): every mechanism
// gated behind a plan_write call (c31's uncertainty pause included) has no
// surface to fire on when a model skips planning entirely — measured directly:
// 0/6 sessions called plan_write at all in the first live c31 round against
// sv-ambiguous-spec. Forces the FIRST plan_write call before any mutation;
// once state exists this never fires again, so re-planning/updating later is
// unaffected. ADOPTED by judgment (Albert-approved) WITH two mitigations for
// the measured gemma collapse (0/9, fabricated completion claims — the
// corpus's only p<0.05 harm): an in-code gemma model-family skip at the block
// site, and a block message that names the full plan_write -> plan_go path
// instead of "retry the mutation". Benefit on other models was not
// established by a powered trial. FORCE_PLAN_WRITE=off is the kill switch.
const FORCE_PLAN_WRITE = process.env.FORCE_PLAN_WRITE !== "off";
// Dark candidate c39: gives the model a TOOL (plan_go) to flip
// state.phase "planned" -> "executing" itself, mirroring goCommand's exact
// validation (no plan / no open items / c31 uncertainty hold) but routed
// through mutatePlan (not goCommand's racier bare readState+writeStateAndTodo).
// Exists because real_gate.sh's one-shot `pi -p` sessions never dispatch a
// literal "/"-prefixed slash command, so /plan-go — and therefore every
// phase==="executing"-gated candidate (c25, c37, any future one) — can never
// activate under measurement. This is the activation path, not a mechanism
// of its own; PLAN_TOOL_GO alone should be near behavior-neutral.
// (LIVE default-on since 2026-08-07; was dark candidate c39. ADOPTED by
// judgment, Albert-approved — and required for c38's rewritten block message
// to be honest. PLAN_TOOL_GO=off is the kill switch; gate rounds must keep
// plan_go in GATE_BASE_TOOLS per ADR-0001.)
const PLAN_TOOL_GO = process.env.PLAN_TOOL_GO !== "off";
// PR7 is dark: forced preserves the deployed whole-plan behavior. Adaptive adds
// stable-ID status deltas and an explicitly user-invoked bounded direct path.
const PLAN_MODE: PlanMode = planMode();
const ADAPTIVE_DIRECT_FLAG = "__pi_adaptive_direct_active";
function adaptiveDirectActive(): boolean {
	return (globalThis as Record<string, unknown>)[ADAPTIVE_DIRECT_FLAG] === true;
}
function setAdaptiveDirect(active: boolean): void {
	if (active) (globalThis as Record<string, unknown>)[ADAPTIVE_DIRECT_FLAG] = true;
	else delete (globalThis as Record<string, unknown>)[ADAPTIVE_DIRECT_FLAG];
}

type ItemStatus = "pending" | "in_progress" | "done" | "blocked";
type Phase = "planned" | "executing";
type Autonomy = "lean" | "yolo";

// Model-facing failure taxonomy (4 values) — same vocabulary as the subagent roles
// and APPEND_SYSTEM so the model only ever learns one set.
type FailureClass = "blocked_needs_input" | "blocked_other" | "user_action_required" | "unknown";

type PlanItem = {
	id: string;
	title: string;
	status: ItemStatus;
	note?: string;
	failure_class?: FailureClass;
	gate?: string; // read-only verify/check command that must exit 0 before status can be "done"
	gate_fails?: number; // consecutive gate failures (escalates to blocked at GATE_MAX)
	preserve_count?: number; // consecutive times B re-attached this omitted open item (yields at PRESERVE_MAX)
	depends_on?: string[]; // titles of items that must be done first (advisory ordering)
};

type PlanState = {
	schema_version: 3;
	run_id: string;
	request: string;
	summary: string;
	autonomy: Autonomy;
	phase: Phase;
	created_at: string;
	updated_at: string;
	items: PlanItem[];
	writer?: string; // process marker of the last writer (cross-session resume detection)
	uncertainties?: string[]; // c31: unresolved questions; execution is held while any remain
};

type TraceEvent = {
	run_id?: string;
	item_id?: string;
	model?: { provider: string; id: string };
	action_type: "command" | "tool" | "agent_end";
	tool_name?: string;
	action_id?: string;
	input_summary?: string;
	output_summary?: string;
	success: boolean;
	failure_class?: string;
	observed_state?: unknown;
	required_state?: unknown;
	action_fingerprint?: string;
	same_failure_count?: number;
	retry_allowed?: boolean;
	suggested_recovery?: string;
	final_status?: string | null;
};

// ---------- paths & small helpers (preserved from v2) ----------

function todoPath(cwd: string): string {
	return join(cwd, ".pi", "TODO.md");
}
function usesPrivatePlanStorage(cwd: string): boolean {
	return planStorageMode() === "capsule" && privatePlanStatePath(cwd) !== null;
}
function statePath(cwd: string): string {
	return privatePlanStatePath(cwd) ?? join(cwd, ".pi", "plan-state.json");
}
function tracePath(cwd: string): string {
	return join(cwd, ".pi", "traces", "plan-runner.jsonl");
}
function archiveDir(cwd: string): string {
	return join(cwd, ".pi", "todo-archive");
}
function isoNow(): string {
	return new Date().toISOString();
}
function timestamp(): string {
	return isoNow().replace(/[:.]/g, "-");
}
function actionId(): string {
	return randomUUID().slice(0, 8);
}
function itemId(): string {
	return `item-${randomUUID().slice(0, 8)}`;
}
function exists(path: string): Promise<boolean> {
	return stat(path).then(() => true, () => false);
}

async function archiveExistingTodo(cwd: string): Promise<string | undefined> {
	const path = todoPath(cwd);
	if (!(await exists(path))) return undefined;
	const dir = archiveDir(cwd);
	await mkdir(dir, { recursive: true });
	const archived = join(dir, `${timestamp()}-TODO.md`);
	await rename(path, archived);
	return archived;
}

function compactValue(value: unknown): unknown {
	if (typeof value === "string" && value.length > 500) return `${value.slice(0, 500)}…`;
	return value;
}

// ---------- trace + repeated-failure guard (preserved from v2) ----------

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	const entries = Object.entries(value as Record<string, unknown>)
		.filter(([, v]) => v !== undefined)
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
	return `{${entries.join(",")}}`;
}

function buildActionFingerprint(parts: {
	action_type: string;
	tool_name?: string;
	input_summary?: string;
	failure_class?: string;
	observed_state?: unknown;
	required_state?: unknown;
}): string {
	return createHash("sha256").update(stableStringify(parts)).digest("hex").slice(0, 16);
}

const TRACE_TAIL_MAX_BYTES = 64 * 1024;

export async function tailLines(path: string, maxLines: number): Promise<string[]> {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(path, "r");
		const info = await handle.stat();
		const length = Math.min(info.size, TRACE_TAIL_MAX_BYTES);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, info.size - length);
		let raw = buffer.toString("utf8");
		if (info.size > length) raw = raw.slice(Math.max(0, raw.indexOf("\n") + 1));
		return raw.split("\n").filter((line) => line.trim().length > 0).slice(-maxLines);
	} catch {
		return [];
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

async function countRecentSameFailures(path: string, fingerprint: string): Promise<number> {
	const lines = await tailLines(path, 200);
	let count = 0;
	for (const line of lines) {
		try {
			const event = JSON.parse(line);
			if (event.success === false && event.action_fingerprint === fingerprint) count += 1;
		} catch {
			// ignore malformed lines
		}
	}
	return count;
}

// Appends a trace event; returns same_failure_count so callers can warn the model.
async function appendTrace(cwd: string, event: TraceEvent): Promise<number | undefined> {
	const path = tracePath(cwd);
	await mkdir(dirname(path), { recursive: true });
	const failureClass = event.failure_class ?? (event.success ? "none" : "unknown");
	const fingerprint = event.success
		? undefined
		: (event.action_fingerprint ?? buildActionFingerprint({
			action_type: event.action_type,
			tool_name: event.tool_name,
			input_summary: event.input_summary,
			failure_class: failureClass,
			observed_state: event.observed_state,
			required_state: event.required_state,
		}));
	const sameFailureCount = fingerprint
		? (event.same_failure_count ?? (await countRecentSameFailures(path, fingerprint)) + 1)
		: undefined;
	const repeated = Boolean(sameFailureCount && sameFailureCount >= 2);
	const repeatedRecovery = "Same failed action repeated without changed observed_state or required_state; change strategy, inspect state, or mark blocked.";
	const withDefaults = {
		timestamp: isoNow(),
		model: event.model ?? activeModel,
		...event,
		failure_class: failureClass,
		action_fingerprint: fingerprint,
		same_failure_count: sameFailureCount,
		retry_allowed: repeated ? false : (event.retry_allowed ?? (!event.success ? false : undefined)),
		suggested_recovery: repeated ? (event.suggested_recovery ?? repeatedRecovery) : event.suggested_recovery,
	};
	const safeEvent = Object.fromEntries(Object.entries(withDefaults).map(([k, v]) => [k, compactValue(v)]));
	await appendFile(path, `${JSON.stringify(safeEvent)}\n`, "utf8");
	return sameFailureCount;
}

// ---------- state I/O ----------

function getSection(markdown: string, heading: string): string {
	const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const pattern = new RegExp(`^#\\s+${escaped}\\s*$([\\s\\S]*?)(?=^#\\s+|$(?![\\r\\n]))`, "m");
	const match = markdown.match(pattern);
	return match ? match[1].trim() : "";
}

function newState(request: string, summary: string, autonomy: Autonomy, items: PlanItem[], runId?: string): PlanState {
	const now = isoNow();
	return {
		schema_version: 3,
		run_id: runId ?? `plan-${timestamp()}`,
		request,
		summary,
		autonomy,
		phase: "planned",
		created_at: now,
		updated_at: now,
		items,
	};
}

// v2 (steps[]) → v3 (items[]) read shim so an in-flight plan survives the upgrade.
function migrateV2(raw: any): PlanState {
	const stepStatus = (s: string): ItemStatus => (s === "todo" ? "pending" : (s as ItemStatus));
	const items: PlanItem[] = Array.isArray(raw.steps)
		? raw.steps.map((s: any) => ({
			id: s.step_id ?? itemId(),
			title: String(s.title ?? "").trim(),
			status: stepStatus(s.status ?? "pending"),
			note: s.last_result,
		}))
		: [];
	const now = isoNow();
	return {
		schema_version: 3,
		run_id: raw.run_id ?? `plan-${timestamp()}`,
		request: raw.request ?? "Migrated plan",
		summary: raw.summary ?? "Migrated from schema v2.",
		autonomy: "lean",
		phase: raw.status === "planning_pending" ? "planned" : "executing",
		created_at: raw.created_at ?? now,
		updated_at: now,
		items,
	};
}

function hydrateFromTodo(markdown: string): PlanState {
	const request = getSection(markdown, "Active Request") || "Imported legacy TODO";
	const summary = getSection(markdown, "Plan Summary") || "Hydrated from .pi/TODO.md";
	const items: PlanItem[] = getSection(markdown, "Todo")
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map(parseTodoLine)
		.filter((p) => p.title)
		.map((p) => ({ id: itemId(), title: p.title, status: p.status as ItemStatus }));
	const state = newState(request, summary, "lean", items);
	state.phase = "executing";
	return state;
}

async function readState(cwd: string): Promise<PlanState | undefined> {
	const sp = statePath(cwd);
	if (await exists(sp)) {
		try {
			const raw = JSON.parse(await readFile(sp, "utf8"));
			if (raw && raw.schema_version === 3 && Array.isArray(raw.items)) return raw as PlanState;
			return migrateV2(raw);
		} catch {
			// fall through to TODO.md hydration
		}
	}
	const tp = todoPath(cwd);
	if (await exists(tp)) return hydrateFromTodo(await readFile(tp, "utf8"));
	return undefined;
}

function currentItem(state: PlanState): PlanItem | undefined {
	// Prefer the first pending item whose deps are all satisfied (nextReady
	// spirit); fall back to plain list order if none qualifies.
	return (
		state.items.find((i) => i.status === "in_progress") ??
		state.items.find((i) => i.status === "pending" && unmetDeps(i, state.items).length === 0) ??
		state.items.find((i) => i.status === "pending")
	);
}

function openItemCount(state: PlanState): number {
	return state.items.filter((item) => item.status !== "done").length;
}

function blockedItemCount(state: PlanState): number {
	return state.items.filter((item) => item.status === "blocked").length;
}

function derivedStatus(state: PlanState): string {
	if (state.items.length === 0) return "empty";
	if (state.items.every((i) => i.status === "done")) return "completed";
	if (state.items.some((i) => i.status === "blocked") && !state.items.some((i) => i.status === "pending" || i.status === "in_progress")) return "blocked";
	return state.phase === "planned" ? "planned (awaiting /plan-go)" : "executing";
}

const MARK: Record<ItemStatus, string> = { pending: " ", in_progress: "~", done: "x", blocked: "!" };

function renderTodo(state: PlanState): string {
	const line = (i: PlanItem) => {
		const tail = i.note ? ` — ${i.note.split("\n")[0]}` : "";
		const fc = i.status === "blocked" && i.failure_class ? ` [${i.failure_class}]` : "";
		const deps = i.depends_on?.length && i.status !== "done" ? ` (after: ${i.depends_on.join("; ")})` : "";
		return `- [${MARK[i.status]}] ${i.title}${deps}${tail}${fc}`;
	};
	return [
		"# Active Request",
		state.request,
		"",
		"# Status",
		derivedStatus(state),
		"",
		"# Plan Summary",
		state.summary,
		"",
		"# Todo",
		state.items.map(line).join("\n") || "(none)",
		"",
		"# Meta",
		`Autonomy: ${state.autonomy}`,
		`Phase: ${state.phase}`,
		`Updated: ${isoNow()}`,
		`Run ID: ${state.run_id}`,
		"",
	].join("\n");
}

// Process marker for cross-session resume detection: a state file whose writer
// isn't THIS process was left by a previous (crashed/aborted) session, so its
// in_progress items may hold partial work on disk. Pre-upgrade files have no
// writer field, which correctly reads as "another process".
const PROC_MARK = processWriterMarker();

function staleInProgress(state: PlanState): PlanItem[] {
	return state.writer === PROC_MARK ? [] : state.items.filter((i) => i.status === "in_progress");
}

// write-then-rename: rename(2) is atomic within a filesystem, so a concurrent
// READER can never observe a half-written file. (Crash durability is a weaker
// claim and deliberately not made: there is no fsync of the temp handle or of
// the directory, so a power loss can still lose the write entirely — it just
// cannot leave a torn file behind.) A TORN plan-state.json
// is unrecoverable (the plan is the session's spine), and a torn TODO.md misleads
// the human. Order matters too and is deliberate: state (authoritative, read by
// the model) lands BEFORE TODO.md (a rendered derivative). A crash between the two
// therefore leaves the model correct and only the human view stale — never the
// reverse. (QA finding, 2026-07-30.)
async function atomicWrite(path: string, contents: string): Promise<void> {
	const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
	await writeFile(tmp, contents, "utf8");
	try {
		await rename(tmp, path);
	} catch (error) {
		// Nothing sweeps .pi/ — a failed rename would otherwise leave the temp file
		// beside plan-state.json forever, once per failure.
		await unlink(tmp).catch(() => {});
		throw error;
	}
}

async function writeStateAndTodo(cwd: string, state: PlanState): Promise<void> {
	state.updated_at = isoNow();
	state.writer = PROC_MARK;
	const sp = statePath(cwd);
	await mkdir(dirname(sp), { recursive: true });
	await atomicWrite(sp, `${JSON.stringify(state, null, 2)}\n`);
	if (!usesPrivatePlanStorage(cwd)) await atomicWrite(todoPath(cwd), renderTodo(state));
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id,
		item_id: currentItem(state)?.id,
		open_items: openItemCount(state),
		blocked_items: blockedItemCount(state),
	};
}

async function mutatePlan<T>(cwd: string, fn: (state: PlanState | undefined) => Promise<{ state?: PlanState; result: T }>): Promise<T> {
	const path = statePath(cwd);
	await mkdir(dirname(path), { recursive: true });
	return withFileMutationQueue(path, async () => {
		const current = await readState(cwd);
		const out = await fn(current);
		if (out.state) await writeStateAndTodo(cwd, out.state);
		return out.result;
	});
}

// Preserve ids + gate/gate_fails across rewrites (normalized-title identity).
// Pure logic lives in lib/plan-integrity.ts (unit-testable without the SDK);
// this thin wrapper injects the id factory and narrows the shared types.
function reconcileItems(prev: PlanItem[] | undefined, incoming: Array<{ title: string; status: ItemStatus; note?: string; failure_class?: FailureClass; gate?: string }>): PlanItem[] {
	return libReconcile(prev as ReconciledItem[] | undefined, incoming as IncomingItem[], itemId) as PlanItem[];
}

// ---------- plan-mode enforcement ----------

// In-memory "planning in flight" flag, shared with other extensions (same pi
// process) via globalThis. Deliberately NOT read from .pi/plan-state.json —
// that file persists across sessions, so a stale phase:"planned" would block
// normal work forever. Set on /plan, cleared on /plan-go, yolo, or agent_end:
// it covers exactly the agent run the /plan command starts.
// Pi 0.83 IGNORES a returned isError: "Returning a value never sets the error
// flag regardless of what properties you include in the return object" — only a
// THROWN error marks a tool result failed (docs/extensions.md:1959,2866). Every
// semantic rejection below used to `return { isError: true }`, so rejections were
// invisible to the write-rejected observer and to the gate's tool_errors metric
// (ab-machinery/metrics.py:134 reads isError off the toolResult message that
// agent-loop.js:541 populates) — i.e. plan-heavy candidate arms under-counted
// their own failures. Throw so a rejection reads as one.
// NOT fixed by this, despite the obvious guess: loop-breaker still cannot see
// plan-tool rejections. Its outcome detector filters on OUTCOME_TOOLS
// (loop-breaker.ts:174,335 — bash/edit/write/multiedit) before ever reading
// isError, and plan_write is in PROGRESS_TOOLS (:64), whose hasProgress check
// (:400-404) is computed from tool NAMES on the assistant message, never from
// results — so a thrown plan_write still calls resetEpisode(). Plan-thrash by
// repeated rejection is therefore NOT covered by the anti-loop escalation. The instructive text becomes the
// error message the model sees; the specific telemetry event is always recorded
// BEFORE the throw, so nothing is lost. (Albert's 2026-07-30 QA session.)
function rejectPlanTool(text: string): never {
	throw new Error(text);
}

const PLAN_FLAG = "__pi_plan_phase_active";
function setPlanning(on: boolean): void {
	(globalThis as Record<string, unknown>)[PLAN_FLAG] = on;
}
function isPlanning(): boolean {
	return (globalThis as Record<string, unknown>)[PLAN_FLAG] === true;
}

const PLAN_MUTATION_TOOLS = new Set(["edit", "write", "multiedit"]);

// ---------- prompts ----------

function planBlock(autonomy: Autonomy): string {
	const vague = autonomy === "yolo"
		? `REQ vague → take the most defensible reading, note assumptions in summary, plan.`
		: `REQ vague/ambiguous → unfold it: ask ONE question — the one whose answer narrows the work most. End your turn, wait.
Answer in → clear? plan. Still vague → next ONE question. Hard cap 3 total; at the cap, plan and put open assumptions in summary.`;
	return `Plan only — only file changes are blocked. Investigate first: read/grep/find/ls and read-only bash all work while planning. Sizing the work beats guessing at it.
${vague}
Risky REQ, or several viable approaches → in thinking only: draft a minimal-safe plan and a thorough plan, then merge — keep each item that buys real risk coverage, drop the rest. Emit only the merged plan. Clear simple REQ → skip the comparison, plan straight.
${PLAN_ITEM_GUIDANCE_V2 ? "Decompose REQ into ordered steps sized to the real work — no padding, no fake splits." : "Break REQ into 5-10 ordered items. Small steps, no fake splits."}
Prefer vertical slices — each item leaves something working/verifiable.
Each item names its done-check: an observable result, or a \`gate\` command that proves it complete. Vague boundary → it will drift.
Reply with ONLY the plan_write call — no prose plan. Set request (exact), summary (1 line), items (each status="pending").`;
}

// c36 (dark): flag off → these resolve to the legacy strings / empty string, so
// flag-off output stays byte-identical by construction.
const EXECUTOR_CALL = SPAWN_DELEGATION ? "subagent(executor, …, mode=spawn)" : "subagent(executor, …, mode=fork)";
const SPAWN_NOTE = SPAWN_DELEGATION ? " Task SELF-CONTAINED — the child sees ONLY the task text." : "";

function delegationBlock(subagentAvailable: boolean): string {
	if (!subagentAvailable) return "";
	if (PLAN_SUBAGENT_ONLY) {
		return `
Every edit routes through a subagent — this is enforced, not advisory:
- Heavy lookup (big file, wide search) → subagent(explorer, …). Don't pull big files in here.
- Non-trivial claim or change → subagent(verifier, …); accept only on VERDICT: confirmed.
- ANY edit, however small → ${EXECUTOR_CALL}.${SPAWN_NOTE} Direct edit/write/multiedit calls are blocked during execution.`;
	}
	return `
Delegate to keep this window clean (subagent returns only a compact result):
- Heavy lookup (big file, wide search) → subagent(explorer, …). Don't pull big files in here.
- Non-trivial claim or change → subagent(verifier, …); accept only on VERDICT: confirmed.
- Isolated, fully-scoped edit → ${EXECUTOR_CALL}.${SPAWN_NOTE} You own the plan; trivial edits yourself.`;
}

export function policyBlock(autonomy: Autonomy, subagentAvailable: boolean): string {
	if (autonomy === "yolo") {
		return `YOLO:
- Run to completion without routine progress check-ins.
- Blocked item → re-plan (plan_write rewrites the list), continue.
- Continue autonomously through ordinary reversible work.
- Still ask before deletion, destructive Git, deployment, migration, restart/kill, secrets or permissions, and irreversible external effects.
- Repeat failure → change strategy, retry; quit only if truly stuck.${delegationBlock(subagentAvailable)}`;
	}
	return `LEAN:
- Do a chunk, report, pause for check-in.
- Blocked item → mark blocked via plan_write, stop, report. Don't push past.
- Ask before deletion, destructive Git, deployment, migration, restart/kill, secrets or permissions, and irreversible external effects.
- Same action failed twice (see plan_write warning) → stop, mark blocked, change strategy.${delegationBlock(subagentAvailable)}`;
}

function executionDisciplineBlock(): string {
	// (c37 thin-orchestrator mode retired 2026-08-03 — 0-for-2 with adverse
	// effort on both models; DARK_CANDIDATE_VERDICTS_2026-08-03.md. The ternaries
	// that switched these two lines under PLAN_DELEGATE_ALL went with it.)
	return `Execution discipline:
- Big files: size-check first. Sample for shape/schema only. CSV/JSONL/logs/generated reports → query whole file with rg/awk/jq/Python, return only relevant rows/counts. Don't infer global state from head/tail. (Prefer subagent(explorer).)
- Subagents: explorer/verifier read-only, return distilled results — keep this window clean. Main loop owns the plan + final verify.
- No-ops: unneeded item → mark done, note "skipped/no-op" + evidence, or re-plan away with a note.
- Completion claims: before final summary, derive changed-file evidence from tools (git status/diff, else filesystem). No claim a file changed without tool evidence.`;
}

function executeBlock(autonomy: Autonomy, subagentAvailable: boolean): string {
	return `Work the list. Mark item in_progress before starting, done or blocked after.
Re-plan anytime: plan_write to add/remove/reorder/restatus.
plan_write does NOT end your turn — keep working.
Gate risky segments: set an item's gate to a read-only verify/check command (e.g. \`just verify\`, the test/typecheck cmd). plan_write runs it when you mark the item done — fail → reverted (not done), fix + re-run. Mutating/destructive gates are rejected.
${policyBlock(autonomy, subagentAvailable)}
${executionDisciplineBlock()}
End with a short summary:
Status: <one line>
Done: <bullets or "none">
Blocked: <bullets or "none">
Verify: <tool-derived changed-file evidence + checks, or "none">
Next: <one action or "none">`;
}

function planOnlyPrompt(request: string): string {
	return `MODE: PLAN
REQ:
${request}

${planBlock("lean")}
Then STOP — end your turn. Wait for /plan-go. Edits before /plan-go are blocked.`;
}

function planAndExecutePrompt(request: string, subagentAvailable: boolean): string {
	return `MODE: PLAN+RUN (yolo)
REQ:
${request}

${planBlock("yolo")}
Then immediately start executing.
${executeBlock("yolo", subagentAvailable)}`;
}

function executePrompt(state: PlanState, subagentAvailable: boolean): string {
	const open = state.items
		.filter((i) => i.status === "pending" || i.status === "in_progress")
		.map((i) => `- ${i.title}`)
		.join("\n") || "(no open items)";
	return `MODE: RUN
REQ: ${state.request}
OPEN ITEMS:
${open}

${executeBlock(state.autonomy, subagentAvailable)}`;
}

// ---------- runtime status (preserved) ----------

async function runtimeStatusText(ctx: { model?: { provider?: string; id?: string } }): Promise<string> {
	const settingsFile = join(agentDir(), "settings.json");
	const modelsFile = join(agentDir(), "models.json");
	const settings = (await exists(settingsFile)) ? JSON.parse(await readFile(settingsFile, "utf8")) : {};
	const models = (await exists(modelsFile)) ? JSON.parse(await readFile(modelsFile, "utf8")) : {};
	const configuredProvider = settings.defaultProvider ?? "unknown";
	const configuredModel = settings.defaultModel ?? "unknown";
	const selected = rememberModel(ctx);
	const providerCfg = models.providers?.[selected.provider] ?? models.providers?.[configuredProvider];
	return [
		`Active provider: ${selected.provider}`,
		`Active model: ${selected.id}`,
		`Configured default provider: ${configuredProvider}`,
		`Configured default model: ${configuredModel}`,
		`Base URL: ${providerCfg?.baseUrl ?? "not configured for selected provider"}`,
		`API: ${providerCfg?.api ?? "unknown"}`,
		`Default thinking: ${settings.defaultThinkingLevel ?? "unknown"}`,
		`Compaction: ${settings.compaction?.enabled ? "enabled" : "disabled"}`,
		`Keep recent tokens: ${settings.compaction?.keepRecentTokens ?? "unknown"}`,
	].join("\n");
}

function formatTraceLine(line: string): string {
	try {
		const e = JSON.parse(line);
		const time = String(e.timestamp ?? "").replace(/^\d{4}-/, "").replace(/\.\d{3}Z$/, "Z");
		const status = e.success === false ? "FAIL" : "OK";
		const tool = e.tool_name ?? e.action_type ?? "event";
		const item = e.item_id ? ` ${e.item_id}` : "";
		const summary = e.output_summary ?? e.failure_class ?? "";
		return `${time} ${status} ${tool}${item} — ${summary}`.trim();
	} catch {
		return line;
	}
}

// ---------- tool ----------

const itemSchema = Type.Object({
	title: Type.String(),
	status: Type.Union([
		Type.Literal("pending"),
		Type.Literal("in_progress"),
		Type.Literal("done"),
		Type.Literal("blocked"),
	]),
	note: Type.Optional(Type.String()),
	failure_class: Type.Optional(Type.Union([
		Type.Literal("blocked_needs_input"),
		Type.Literal("blocked_other"),
		Type.Literal("user_action_required"),
		Type.Literal("unknown"),
	])),
	gate: Type.Optional(Type.String({ description: "Read-only verify/check command (e.g. 'just verify', the test/typecheck cmd). Mutating/destructive gates are rejected. Must exit 0 to accept this item done; a red gate reverts it so you fix + re-run." })),
	depends_on: Type.Optional(Type.Array(Type.String(), { description: "Titles of other items in this list that must be done first (advisory ordering)." })),
});

const planWrite = defineTool({
	name: "plan_write",
	label: "Write Plan",
	description: "Create or update the plan TODO list. Pass the ENTIRE ordered list each call; it replaces the stored list. Plan, re-plan (add/remove/reorder), restatus items. Does not end your turn.",
	promptSnippet: "Write/update the whole plan TODO list",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Use plan_write for the complete initial plan and explicit replans. Pass the entire ordered list, keep at most one item in_progress, and preserve unresolved items until they are genuinely done or blocked.",
		"For low-risk work use the plan's yolo autonomy; keep risky, uncertain, destructive, or user-review-sensitive work in lean mode until explicitly continued.",
	] : undefined,
	parameters: Type.Object({
		items: Type.Array(itemSchema, { minItems: 1 }),
		request: Type.Optional(Type.String()),
		summary: Type.Optional(Type.String()),
		// Only part of the model-visible schema when the c31 candidate is armed —
		// dark sessions must see a byte-identical tool schema.
		...(PLAN_UNCERTAINTY ? {
			uncertainties: Type.Optional(Type.Array(Type.String(), { description: "Unresolved questions blocking confident execution. Execution will NOT start while any remain. Ask the user, then clear with []." })),
		} : {}),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		const aid = actionId();
		rememberModel(ctx);
		publishPlanGateReceipt(null);

		// A structurally broken dependency graph (unknown ref, self-dep, cycle) is a
		// plan-authoring error — reject before ANY state is written so the model
		// fixes and resends rather than persisting a graph no one can order.
		const depErrors = validateDeps(params.items);
		if (depErrors.length > 0) {
			const existing = await readState(ctx.cwd);
			planEvent("deps-rejected", existing?.run_id ?? `rejected-${aid}`, { errors: depErrors.length });
			rejectPlanTool(
				"plan_write rejected:\n- " + depErrors.join("\n- ") +
				"\nFix depends_on (reference exact titles of other items in THIS list) and resend the ENTIRE list.");
		}

		const { state, newlyBlocked, gateMsgs, gateOutcomes, integrity, newlyDone, prevCompleted, stalePrev, wasRewrite } = await mutatePlan(ctx.cwd, async (prev) => {
			const eventRunId = prev?.run_id ?? `plan-${timestamp()}`;
			const items = reconcileItems(prev?.items, params.items as any);
			const prevById = new Map((prev?.items ?? []).map((i) => [i.id, i]));
			const prevBlocked = new Set((prev?.items ?? []).filter((i) => i.status === "blocked").map((i) => i.id));

			// Repeater: run the gate on items newly transitioning to "done". Exit 0 keeps
			// done; non-zero reverts (→ in_progress, then blocked at GATE_MAX). Opt-in via
			// item.gate, so gateless items are unaffected.
			const gateMsgs: string[] = [];
			const gateOutcomes: PlanGateOutcome[] = [];
			const gateCache = new Map<string, { pass: boolean; output: string }>();
			for (const it of items) {
				if (it.status !== "done" || !it.gate || !api) continue;
				if (prevById.get(it.id)?.status === "done") continue; // already passed
				const gateAllowed = assertVerifyGateAllowed(it.gate);
				if (!gateAllowed.ok) {
					gateOutcomes.push({ command: it.gate, pass: false, rejected: true });
					it.gate_fails = prevById.get(it.id)?.gate_fails ?? 0;
					if (classifyBashCommand(it.gate).destructive) {
						it.status = "blocked";
						it.failure_class = "user_action_required";
						it.note = gateAllowed.reason;
					} else {
						it.status = "in_progress";
						it.note = gateAllowed.reason;
					}
					it.gate = undefined; it.gate_fails = 0; // drop a rejected gate so it cannot re-trap the item
					gateMsgs.push(`gate for "${it.title}" dropped (not a verify/test command): ${gateAllowed.reason}. Use just verify / npm test / npx tsx --test, or pass gate:"" to clear.`);
					continue;
				}
				const normalizedGate = normalizeVerificationCommand(it.gate);
				let gateResult = gateCache.get(normalizedGate);
				if (!gateResult) {
					gateResult = await runReadonlyGate(api.exec.bind(api), ctx.cwd, it.gate, GATE_TIMEOUT_MS);
					gateCache.set(normalizedGate, gateResult);
				}
				gateOutcomes.push({ command: normalizedGate, pass: gateResult.pass });
				const out = gateResult.output;
				if (gateResult.pass) {
					it.gate_fails = 0;
					const priorFails = prevById.get(it.id)?.gate_fails ?? 0;
					planEvent("gate", eventRunId, { pass: true, recovered: priorFails > 0, prior_fails: priorFails });
					continue;
				}
				const fails = (prevById.get(it.id)?.gate_fails ?? 0) + 1;
				// Retry ladder: rung 1 = locality protocol (bounded single-span repair
				// against the failing output), rung 2 = dumb-zone escape (delegate to a
				// fresh subagent, or at least a fresh approach), rung 3 = blocked. The
				// same fix path retried verbatim in the same context rarely converges.
				const rung = fails >= GATE_MAX ? 3 : fails === 1 ? 1 : 2;
				planEvent("gate", eventRunId, { pass: false, fails, rung, terminal: rung === 3 });
				const tail = out.split("\n").slice(-4).join(" / ").slice(0, 300);
				const longTail = out.slice(-500);
				it.gate_fails = fails;
				if (rung === 3) {
					it.status = "blocked";
					it.failure_class = "blocked_other";
					it.note = `gate failed ${fails}×: ${tail}`;
					gateMsgs.push(`✗ gate for "${it.title}" failed ${fails}× → blocked: ${tail}`);
				} else if (rung === 1) {
					it.status = "in_progress";
					it.note = `gate failed (${fails}/${GATE_MAX}): ${tail}`;
					gateMsgs.push(steerText(
						"PLAN_GATE_LADDER1_MSG",
						"✗ gate for \"{title}\" failed ({fails}/{max}). Follow this protocol EXACTLY: 1. LOCALIZE — from the failing output below, identify the ONE file and smallest span responsible. 2. REPAIR — make ONE bounded edit to that span. 3. VERIFY — mark the item done again; the gate re-runs `{gate}`. Do not restructure anything else.\nFailing output (tail): {tail}",
						{ title: it.title, fails, max: GATE_MAX, gate: it.gate, tail: longTail },
					));
				} else {
					it.status = "in_progress";
					it.note = `gate failed (${fails}/${GATE_MAX}): ${tail}`;
					const subagentOk = api.getActiveTools().includes("subagent");
					gateMsgs.push(subagentOk
						? steerText(
							"PLAN_GATE_LADDER2_MSG",
							SPAWN_DELEGATION
								? "✗ gate for \"{title}\" failed again ({fails}/{max}) — the same fix path is not working. Delegate the repair to subagent(executor, ..., mode=spawn) with a SELF-CONTAINED task — the item, the gate command `{gate}`, and the failing output below; the child sees nothing else. Then mark the item done to re-run the gate.\nFailing output (tail): {tail}"
								: "✗ gate for \"{title}\" failed again ({fails}/{max}) — the same fix path is not working. Delegate the repair to subagent(executor, ..., mode=fork): brief it with the item, the gate command `{gate}`, and the failing output below, then mark the item done to re-run the gate.\nFailing output (tail): {tail}",
							{ title: it.title, fails, max: GATE_MAX, gate: it.gate, tail: longTail },
						)
						: steerText(
							"PLAN_GATE_LADDER2_SOLO_MSG",
							"✗ gate for \"{title}\" failed again ({fails}/{max}) — the same fix path is not working. Step back, re-read the failing output below fresh, and take a DIFFERENT approach than your previous attempts, then mark the item done to re-run the gate.\nFailing output (tail): {tail}",
							{ title: it.title, fails, max: GATE_MAX, gate: it.gate, tail: longTail },
						));
				}
			}

			// Plan-integrity guard: a whole-list rewrite must not silently drop work.
			// Normal calls re-emit the ENTIRE list, so this only fires when the model
			// fails to reproduce it — the silent-loss failure mode.
			const { reattached, droppedOpen } = planIntegrity(prev?.items ?? [], items);
			if (reattached.length) items.push(...reattached); // always preserve completed work; never un-record a done step
			// Omission-safe execution: once execution has begun, an omitted OPEN item is
			// almost certainly a reproduction failure, not a deliberate prune — preserve it.
			// But yield after PRESERVE_MAX consecutive preserves: persistent omission =
			// intent (e.g. a parent the model replaced with sub-items), else B deadlocks.
			let preservedOpen: PlanItem[] = [];
			let yieldedOpen: PlanItem[] = [];
			if (executionUnderway(prev?.items ?? [])) {
				const decision = preserveDecision(droppedOpen, PRESERVE_MAX);
				preservedOpen = decision.preserve;
				yieldedOpen = decision.yielded;
				if (preservedOpen.length) items.push(...preservedOpen);
			}
			// ponytail: title-keyed identity, so a renamed open item re-attaches as a near-dupe (mitigated by normalizeTitle); id-addressed items = real fix, out of scope.

			// Plan-thrash signal: items completed THIS call (done now, not done before).
			// Computed after the reattach so preserved already-done items don't count.
			const newlyDone = items.filter((i) => i.status === "done" && prevById.get(i.id)?.status !== "done").length;

			// c31: same omission-safety rule as summary — omitted preserves, [] clears.
			const incomingUncertainties = (params as { uncertainties?: string[] }).uncertainties;
			const next: PlanState = prev
				? { ...prev, request: params.request ?? prev.request, summary: params.summary ?? prev.summary, items, phase: prev.phase === "planned" ? "planned" : "executing", updated_at: isoNow() }
				: newState(params.request ?? "", params.summary ?? "", "lean", items, eventRunId);
			if (PLAN_UNCERTAINTY) {
				const resolved = (incomingUncertainties ?? prev?.uncertainties ?? []).map((u) => String(u).slice(0, 300)).slice(0, 8);
				if (resolved.length) next.uncertainties = resolved;
				else delete next.uncertainties;
			}
			const newlyBlocked = items.filter((i) => i.status === "blocked" && !prevBlocked.has(i.id));
			const prevCompleted = prev ? derivedStatus(prev) === "completed" : false;
			// Captured BEFORE this write stamps us as the writer — a foreign-writer
			// state with in_progress items is a headless resume (no /plan-go ran).
			const stalePrev = prev ? staleInProgress(prev) : [];
			return { state: next, result: { state: next, newlyBlocked, gateMsgs, gateOutcomes, integrity: { reattached, preservedOpen, yieldedOpen }, newlyDone, prevCompleted, stalePrev, wasRewrite: Boolean(prev) } };
		});
		publishPlanGateReceipt(buildPlanGateReceipt(state.run_id, gateOutcomes));

		// Trace each newly blocked item through the repeated-failure guard.
		let warning = "";
		for (const item of newlyBlocked) {
			const count = await appendTrace(ctx.cwd, {
				run_id: state.run_id,
				item_id: item.id,
				action_type: "tool",
				tool_name: "plan_write",
				action_id: aid,
				success: false,
				failure_class: item.failure_class ?? "unknown",
				observed_state: item.note,
				output_summary: `Blocked: ${item.title}`,
				final_status: derivedStatus(state),
			});
			if (count && count >= 2 && state.autonomy === "lean") {
				warning = `\n⚠ "${item.title}" failed ${count}× with the same signature. Change strategy, inspect state, or leave it blocked and stop — do not retry identically.`;
			}
		}
		// An item blocked ON THE USER is invisible unless they run /plan-status — the
		// question must be VOICED, not filed (user report 2026-07-17: "I don't see the
		// question if I don't type plan-status").
		const blockedOnUser = newlyBlocked.filter(
			(i) => i.failure_class === "blocked_needs_input" || i.failure_class === "user_action_required",
		);
		let askNow = "";
		if (blockedOnUser.length > 0) {
			askNow = "\n" + steerText(
				"PLAN_ASK_MSG",
				'⚠ "{title}" is blocked on the user, and the user does NOT see plan notes. In your reply RIGHT NOW, ask the user the exact question (or name the exact action you need from them) in plain text, then stop and wait.',
				{ title: blockedOnUser[0].title },
			);
		}
		// c31: outstanding uncertainties demand the question be VOICED now, and
		// hold execution (the /plan-go gate below enforces the hold). askNow takes
		// precedence — both steers say "ask the user", one per result is enough.
		let uncertaintyWarn = "";
		if (PLAN_UNCERTAINTY && (state.uncertainties?.length ?? 0) > 0 && !askNow) {
			const list = (state.uncertainties ?? []).map((u) => `- ${u}`).join("\n");
			uncertaintyWarn = "\n" + steerText(
				"PLAN_UNCERTAINTY_MSG",
				"⚠ {count} unresolved uncertaint(y/ies) — execution will NOT start while any remain. In your reply RIGHT NOW, ask the user these EXACT questions in plain text, then stop and wait. Clear them with uncertainties: [] once answered:\n{list}",
				{ count: state.uncertainties!.length, list },
			);
			planEvent("uncertainty-hold", state.run_id, { count: state.uncertainties!.length, gate: "write-steer" });
		}
		// Plan-integrity guard: a rewrite that omitted work — completed items are always
		// re-attached; open items are re-attached once execution is underway (omission ≠
		// deletion; restatus to drop). Surfaced + traced so it's observable and trips the
		// repeated-failure guard. failure_class is trace-only — the model's taxonomy is untouched.
		const integrityIssue = integrity.reattached.length > 0 || integrity.preservedOpen.length > 0 || integrity.yieldedOpen.length > 0;
		let integrityWarn = "";
		if (integrityIssue) {
			// Per-case wording: the done case can't be "dropped by restatus" (it's already
			// done), so telling the model to mark it done/blocked is nonsense → split them.
			// Yield = B gave up after PRESERVE_MAX preserves (persistent omission = intent).
			const segs: string[] = [];
			if (integrity.reattached.length) segs.push(`re-listed ${integrity.reattached.length} completed item(s) you dropped — always keep done items in the list`);
			if (integrity.preservedOpen.length) segs.push(`kept ${integrity.preservedOpen.length} open item(s) you omitted (${integrity.preservedOpen.map((i) => i.title).join("; ").slice(0, 160)}) — to drop one, mark it done/blocked, don't leave it out`);
			if (integrity.yieldedOpen.length) segs.push(`released ${integrity.yieldedOpen.length} open item(s) you've omitted ${PRESERVE_MAX}× — treating as intentional removal`);
			integrityWarn = `\n⚠ plan integrity: ${segs.join("; ")}. Re-emit the ENTIRE list each call.`;
			planEvent("integrity", state.run_id, {
				reattached: integrity.reattached.length,
				preserved: integrity.preservedOpen.length,
				yielded: integrity.yieldedOpen.length,
			});
			await appendTrace(ctx.cwd, {
				run_id: state.run_id,
				action_type: "tool",
				tool_name: "plan_write",
				action_id: aid,
				success: false,
				failure_class: "plan_integrity",
				observed_state: { reattached: integrity.reattached.map((i) => i.title), preserved_open: integrity.preservedOpen.map((i) => i.title), yielded: integrity.yieldedOpen.map((i) => i.title), items: state.items.length },
				output_summary: `Rewrite omitted work — reattached ${integrity.reattached.length} done, kept ${integrity.preservedOpen.length} open, released ${integrity.yieldedOpen.length}`,
				final_status: derivedStatus(state),
			});
		}
		// Plan-thrash guard: repeated plan_write that completes nothing. loop-breaker
		// counts plan_write as progress, so this is the only thing that surfaces re-plan
		// churn. Warn (+ trace) only while an open item remains to execute — and NEVER
		// during /plan drafting: there, iterating plan_write with zero completions is
		// the CONTRACT, and "execute now" is unactionable (plan mode blocks mutations).
		const cur = currentItem(state);
		let replanWarn = false;
		if (!isPlanning()) {
			const r = nextReplanStreak(replanStreak, newlyDone, REPLAN_MAX);
			replanStreak = r.streak;
			replanWarn = r.warn;
		}
		// Don't fire "stop re-planning, execute now" in the same call that just told
		// the model to stop and wait for the user — the two steers directly contradict.
		// Never pair "execute now" with "stop and ask the user" in one result.
		const thrashFired = replanWarn && !!cur && !askNow && !uncertaintyWarn;
		if (thrashFired) planEvent("thrash-warn", state.run_id, { streak: replanStreak });
		let thrashWarn = "";
		if (thrashFired) {
			thrashWarn = `\n⚠ re-planned ${replanStreak}× with no item completed — stop re-planning; execute "${cur!.title}" now, or mark it blocked.`;
			await appendTrace(ctx.cwd, {
				run_id: state.run_id,
				action_type: "tool",
				tool_name: "plan_write",
				action_id: aid,
				success: false,
				failure_class: "plan_thrash",
				observed_state: { open_item: cur!.title }, // stable across repeats → same_failure_count climbs
				output_summary: `Re-planned ${replanStreak}× with no completion`,
				final_status: derivedStatus(state),
			});
		}
		if (newlyBlocked.length === 0 && !integrityIssue && !thrashFired) {
			await appendTrace(ctx.cwd, {
				run_id: state.run_id,
				action_type: "tool",
				tool_name: "plan_write",
				action_id: aid,
				success: true,
				output_summary: `Wrote ${state.items.length} items`,
				final_status: derivedStatus(state),
			});
		}

		// On the TRANSITION to completed: the model's analyses/findings are scattered
		// between tool calls across the run — demand one self-contained final report
		// (user report 2026-07-17: results left interspersed with tool calls).
		// ...but NOT when this same call released an unfinished item. yieldedOpen is
		// dropped from `items` above, so derivedStatus reads "completed" over the
		// SHRUNKEN list and the steer would open with "All items are done." while an
		// item was just handed back unfinished. The other mutually-exclusive steers
		// are de-conflicted explicitly (lines 886, 942); this one was not.
		let finalReport = "";
		if (newlyDone > 0 && !prevCompleted && integrity.yieldedOpen.length === 0 && derivedStatus(state) === "completed") {
			finalReport = "\n" + steerText(
				"PLAN_FINAL_REPORT_MSG",
				"All items are done. In your reply NOW, restate the complete results of this plan — every finding, analysis, and deliverable in full, as one self-contained report. The user does not re-read earlier messages or tool output; anything not in this reply is lost.",
				{},
			);
		}
		// Advisory dependency warn: working an item whose deps aren't done yet.
		// Ordering is advisory — no status reversion, just a nudge.
		const depWarns = state.items
			.filter((i) => i.status === "in_progress" && unmetDeps(i, state.items).length > 0)
			.map((i) => `\n⚠ "${i.title}" depends on unfinished: ${unmetDeps(i, state.items).join("; ")} — ordering is advisory; finish those first or restatus them.`);
		const depWarn = depWarns.join("");
		const declaredDeps = state.items.reduce((sum, item) => sum + (item.depends_on?.length ?? 0), 0);
		const unmetDependencyCount = state.items
			.filter((item) => item.status === "in_progress")
			.reduce((sum, item) => sum + unmetDeps(item, state.items).length, 0);
		planEvent("write", state.run_id, {
			items: state.items.length,
			open_items: state.items.filter((item) => item.status === "pending" || item.status === "in_progress").length,
			newly_done: newlyDone,
			rewrite: wasRewrite,
			declared_dependencies: declaredDeps,
			unmet_dependencies: unmetDependencyCount,
			dependency_compliant: unmetDependencyCount === 0,
			context_tokens: ctx.getContextUsage?.()?.tokens ?? null,
		});
		// One-shot partial-work note for headless resumes: first plan_write of this
		// process against a state another process left with in_progress items.
		let resumeWarn = "";
		if (stalePrev.length > 0 && !partialWorkNoted) {
			partialWorkNoted = true;
			resumeWarn = `\n⚠ Resumed from a previous session. Previously in_progress item(s) may have PARTIAL WORK on disk: ${stalePrev.map((i) => i.title).join("; ")}. Inspect current state (git status/diff, read the touched files) before continuing — do not trust it done and do not redo it blind.`;
		}
		const gateNote = gateMsgs.length ? `\n${gateMsgs.join("\n")}` : "";
		const body = `Plan updated (${state.items.length} items, status: ${derivedStatus(state)}).${cur ? `\nNext open: ${cur.title}` : "\nNo open items remain."}${warning}${askNow}${finalReport}${integrityWarn}${thrashWarn}${depWarn}${uncertaintyWarn}${resumeWarn}${gateNote}`;
		return {
			content: [{ type: "text", text: body }],
			details: { tool_name: "plan_write", action_id: aid, success: true },
			terminate: false,
		};
	},
});

// ---------- go transition (shared by /plan-go and the plan_go tool) ----------

type GoOutcome =
	| { ok: true; state: PlanState; resuming: boolean; stale: PlanItem[] }
	| { ok: false; reason: "no-plan" }
	| { ok: false; reason: "no-open-items"; runId: string }
	| { ok: false; reason: "uncertainty-hold"; state: PlanState };

// One queued validator for BOTH activation paths. The slash command and the
// tool used to be parallel implementations that drifted twice (the command ran
// its guards on a pre-queue snapshot, and disarmed the plan-mode block BEFORE
// its guards, so a bailed /plan-go still disarmed it). All three guards run
// INSIDE mutatePlan against the post-queue `prev`, so a /plan-go typed during
// an in-flight plan_write validates the state that write produced — including
// uncertainties it may have just added. Reject arms omit `state`, so nothing
// is persisted on a bail. `resuming`/`stale` are computed off `prev` BEFORE
// writeStateAndTodo stamps this process as writer.
// setPlanning(false)/replanStreak=0 fire ONLY on the ok arm: a bailed or held
// go must not disarm the block or reset the thrash streak. agent_end's own
// setPlanning(false) remains the deadlock-safety net for an armed flag.
// Telemetry, trace, plan_spine and prompt delivery stay in the CALLERS — they
// differ in gate discriminator, trace shape and delivery channel by design.
async function goTransition(cwd: string, mode?: Autonomy): Promise<GoOutcome> {
	const outcome = await mutatePlan<GoOutcome>(cwd, async (prev): Promise<{ state?: PlanState; result: GoOutcome }> => {
		if (!prev || prev.items.length === 0) {
			return { result: { ok: false, reason: "no-plan" } };
		}
		const open = prev.items.filter((i) => i.status === "pending" || i.status === "in_progress");
		if (open.length === 0) {
			return { result: { ok: false, reason: "no-open-items", runId: prev.run_id } };
		}
		// c31: deterministic hold — execution cannot start while the model's own
		// declared uncertainties remain. No LLM judgment; clear them via plan_write.
		if (PLAN_UNCERTAINTY && (prev.uncertainties?.length ?? 0) > 0) {
			return { result: { ok: false, reason: "uncertainty-hold", state: prev } };
		}
		const resuming = prev.phase === "executing";
		const stale = staleInProgress(prev); // pre-write state — writer not yet re-stamped
		const next: PlanState = { ...prev, phase: "executing" };
		if (mode) next.autonomy = mode;
		return { state: next, result: { ok: true, state: next, resuming, stale } };
	});
	if (outcome.ok) {
		setPlanning(false); // execution genuinely starts — NOW disarm
		replanStreak = 0;
	}
	return outcome;
}

// "PARTIAL WORK" resume note — byte-identical in both callers; hoisted.
function resumeNoteFor(stale: PlanItem[]): string {
	return stale.length
		? `\n\nRESUMED from a previous session. Previously in_progress item(s) may have PARTIAL WORK on disk: ${stale.map((i) => i.title).join("; ")}. Inspect current state (git status/diff, read the touched files) before continuing — do not trust it done and do not redo it blind.`
		: "";
}

// ---------- commands ----------

async function startPlanCommand(args: string, ctx: { cwd: string; model?: { provider?: string; id?: string }; ui: { notify(m: string, l?: string): void } }, pi: ExtensionAPI) {
	rememberModel(ctx);
	const yolo = /(^|\s)yolo$/i.test(args);
	const request = args.replace(/(^|\s)yolo$/i, "").trim();
	if (!request) {
		ctx.ui.notify("Usage: /plan <request> [yolo]", "error");
		return;
	}
	const autonomy: Autonomy = yolo ? "yolo" : "lean";
	replanStreak = 0; // fresh plan — reset thrash counter
	partialWorkNoted = false; // a later foreign-writer state may still warrant the partial-work note
	await mutatePlan(ctx.cwd, async () => {
		if (!usesPrivatePlanStorage(ctx.cwd)) await archiveExistingTodo(ctx.cwd);
		const state = newState(request, "Planning pending. The model will call plan_write.", autonomy, []);
		if (yolo) state.phase = "executing"; // yolo plans + runs in one flow — no /plan-go to flip it; keep status honest
		return { state, result: state };
	});
	await appendTrace(ctx.cwd, { action_type: "command", tool_name: "plan", success: true, input_summary: request, output_summary: `autonomy=${autonomy}` });
	const subagentAvailable = pi.getActiveTools().includes("subagent");
	if (yolo) pi.appendEntry("plan_spine", {}); // yolo executes immediately — mark the node for /collapse
	setPlanning(!yolo); // arm the plan-mode mutation block for this agent run (yolo executes, so no block)
	// deliverAs steer: while idle prompt() ignores it and runs a normal turn;
	// while STREAMING, omitting it makes pi throw and swallow the message into
	// emitError — the plan state would be committed but the driving prompt lost
	// (triage #0: /plan typed mid-stream). Steer is safe in both states.
	pi.sendUserMessage(yolo ? planAndExecutePrompt(request, subagentAvailable) : planOnlyPrompt(request), { deliverAs: "steer" });
}

async function goCommand(args: string, ctx: { cwd: string; model?: { provider?: string; id?: string }; ui: { notify(m: string, l?: string): void } }, pi: ExtensionAPI) {
	rememberModel(ctx);
	// Optional mode switch: /plan-go yolo  or  /plan-go lean
	const mode = /(^|\s)yolo$/i.test(args) ? "yolo" : /(^|\s)lean$/i.test(args) ? "lean" : undefined;

	// Guards, queueing, and the disarm-only-on-ok rule all live in goTransition
	// (shared with the plan_go tool). This function only maps the outcome onto
	// the command's channels: ui.notify for failures, sendUserMessage for the
	// execute prompt, a "command"-shaped trace row.
	const outcome = await goTransition(ctx.cwd, mode);
	if (!outcome.ok) {
		if (outcome.reason === "no-plan") {
			planEvent("go-blocked", `no-plan-${actionId()}`, { reason: "no-plan", activation: "command" });
			ctx.ui.notify("No plan to run. Start with /plan <request>.", "error");
			return;
		}
		if (outcome.reason === "no-open-items") {
			planEvent("go-blocked", outcome.runId, { reason: "no-open-items", activation: "command" });
			ctx.ui.notify("Plan is complete — no open items. Start a new plan with /plan <request>.", "info");
			return;
		}
		const held = outcome.state;
		planEvent("uncertainty-hold", held.run_id, { count: held.uncertainties!.length, gate: "plan-go-block" });
		ctx.ui.notify(
			`Execution held — ${held.uncertainties!.length} unresolved uncertaint(y/ies):\n${held.uncertainties!.map((u) => `- ${u}`).join("\n")}\nAnswer them, have the model clear the field (plan_write uncertainties: []), then /plan-go again.`,
			"warning",
		);
		return;
	}

	const { state: next, resuming, stale } = outcome;
	pi.appendEntry("plan_spine", { run_id: next.run_id }); // mark this node for /collapse
	await appendTrace(ctx.cwd, { run_id: next.run_id, action_type: "command", tool_name: "plan-go", success: true, output_summary: `${resuming ? "resume" : "execute"}${mode ? ` autonomy=${mode}` : ""}` });
	planEvent("go", next.run_id, { resumed: resuming, stale: stale.length, activation: "command" });

	const subagentAvailable = pi.getActiveTools().includes("subagent");
	// deliverAs steer for the same reason as startPlanCommand's send: a /plan-go
	// typed mid-stream otherwise commits phase=executing, plan_spine and the trace
	// row, then LOSES the execute prompt (pi swallows the missing-streamingBehavior
	// throw into emitError; plan-runner never learns).
	pi.sendUserMessage(executePrompt(next, subagentAvailable) + resumeNoteFor(stale), { deliverAs: "steer" });
}

async function statusCommand(ctx: { cwd: string; ui: { notify(m: string, l?: string): void } }) {
	const state = await readState(ctx.cwd);
	if (!state) {
		ctx.ui.notify("No private run-capsule plan or legacy .pi/plan-state.json/TODO.md found.", "info");
		return;
	}
	ctx.ui.notify(renderTodo(state), "info");
}

async function traceCommand(args: string, ctx: { cwd: string; ui: { notify(m: string, l?: string): void } }) {
	const parsed = Number.parseInt(args.trim(), 10);
	const count = Number.isNaN(parsed) ? 10 : Math.min(50, Math.max(1, parsed));
	const path = tracePath(ctx.cwd);
	if (!(await exists(path))) {
		ctx.ui.notify("No plan trace found.", "info");
		return;
	}
	const lines = await tailLines(path, count);
	ctx.ui.notify(lines.map(formatTraceLine).join("\n"), "info");
}

// ---------- registration ----------

export default function (pi: ExtensionAPI) {
	api = pi; // let the module-scope plan_write tool run shell gates via pi.exec

	// Crash/abort resume: a plan-state file left by ANOTHER process with open
	// items is an interrupted plan — surface it once so the user can inspect,
	// resume, or replace instead of never learning it exists.
	pi.on("session_start", async (_event, ctx) => {
		setAdaptiveDirect(false);
		// FIRST, ahead of both early returns below: this key is written by
		// writeStateAndTodo and deleted nowhere, while pi's loader returns the CACHED
		// factory across session replacement, so a /new, /fork or same-cwd /resume
		// inherited the previous plan's run_id. Both readers (context-surface.ts and
		// blackboard.ts) stamp it onto receipts, and telemetry.ts lets detail.run_id WIN
		// the envelope join key — so the new session's receipts filed under the dead
		// plan's run_id. (No gate impact: one `pi -p` session per process.)
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		partialWorkNoted = false; // per-session, not per-process — see the declaration comment
		rememberModel(ctx);
		resumeNoticeShown = false;
		lastSessionNotify = (message) => ctx.ui.notify(message, "info");
		lastSessionCwd = ctx.cwd;
		await rebindActivePlan(ctx.cwd, lastSessionNotify);
	});

	// Adaptive storage races extension order: run-capsule publishes the private
	// storage identity AFTER this extension's session_start ran, so the rebind
	// above could only see the project-local fallback. Re-run it exactly once
	// per identity announcement so an interrupted PRIVATE plan is found too.
	onHarnessSignal(pi.events, (signal) => {
		if (signal.type !== "capsule/identity" || planStorageMode() !== "capsule" || !lastSessionCwd) return;
		void rebindActivePlan(lastSessionCwd, lastSessionNotify ?? (() => {}));
	});

	pi.registerTool(planWrite);

	// PR7 dark candidate: routine progress uses stable IDs rather than replaying
	// the entire plan. Creation, replan, membership, ordering, dependencies, and
	// gates remain owned by plan_write; this tool can only mutate status metadata.
	if (PLAN_MODE === "adaptive") {
		pi.registerTool(
			defineTool({
				name: "plan_update",
				label: "Update Plan Status",
				description: "Update existing plan items by stable item_id only. This cannot add, remove, rename, reorder, or change dependencies; use plan_write for creation and explicit replans.",
				promptSnippet: "plan_update(deltas): apply stable-ID status changes without replaying the whole plan.",
				parameters: Type.Object({
					deltas: Type.Array(Type.Object({
						item_id: Type.String({ minLength: 1, maxLength: 96 }),
						status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked")]),
						note: Type.Optional(Type.String({ maxLength: 300 })),
						failure_class: Type.Optional(Type.Union([
							Type.Literal("blocked_needs_input"), Type.Literal("blocked_other"),
							Type.Literal("user_action_required"), Type.Literal("unknown"),
						])),
					}), { minItems: 1, maxItems: 16 }),
				}),
				async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
					const aid = actionId();
					rememberModel(ctx);
					const deltas = params.deltas as PlanDelta[];
					const outcome = await mutatePlan(ctx.cwd, async (prev) => {
						if (!prev) rejectPlanTool("plan_update rejected: no plan exists; call plan_write to create the plan first.");
						const applied = applyPlanDeltas(prev.items, deltas);
						if (!applied.ok) rejectPlanTool(`plan_update rejected: ${applied.errors.join("; ")}`);
						const next = { ...prev, items: applied.items as typeof prev.items };
						const gateOutcomes: PlanGateOutcome[] = [];
						for (const item of next.items) {
							const before = prev.items.find((candidate) => candidate.id === item.id);
							if (item.status !== "done" || before?.status === "done" || !item.gate || !api) continue;
							const allowed = assertVerifyGateAllowed(item.gate);
							if (!allowed.ok) {
								gateOutcomes.push({ command: item.gate, pass: false, rejected: true });
								item.status = "in_progress";
								item.note = allowed.reason.slice(0, 300);
								continue;
							}
							const result = await runReadonlyGate(api.exec.bind(api), ctx.cwd, item.gate, GATE_TIMEOUT_MS);
							gateOutcomes.push({ command: normalizeVerificationCommand(item.gate), pass: result.pass });
							if (!result.pass) {
								item.status = "in_progress";
								item.note = `gate failed: ${result.output.split("\n").slice(-1)[0]?.slice(0, 260) ?? "unknown"}`;
							}
						}
						return { state: next, result: { state: next, applied, gateOutcomes } };
					});
					publishPlanGateReceipt(buildPlanGateReceipt(outcome.state.run_id, outcome.gateOutcomes));
					const openItems = outcome.state.items.filter((item) => item.status !== "done").length;
					planEvent("delta", outcome.state.run_id, { changed: outcome.applied.changed, idempotent: outcome.applied.idempotent, open_items: openItems });
					return {
						content: [{ type: "text" as const, text: `Plan status updated: ${outcome.applied.changed} changed, ${outcome.applied.idempotent} already current, ${openItems} open item(s).` }],
						details: { tool_name: "plan_update", action_id: aid, success: true },
						terminate: false,
					};
				},
			}),
		);
	}

	// c39 PLAN_TOOL_GO: model-callable twin of /plan-go — see the env-flag
	// comment above. Registration itself is the dark-candidate gate (scoped to
	// just this one call — plan_write + the commands + hooks below register
	// unconditionally, so a whole-function guard would silently drop those too).
	if (PLAN_TOOL_GO) {
		pi.registerTool(
			defineTool({
				name: "plan_go",
				label: "Start Plan Execution",
				description:
					"Begin executing the current plan — the same transition the /plan-go command performs " +
					"(phase: \"planned\" -> \"executing\"). Requires a saved plan (call plan_write first) with " +
					"at least one open (pending/in_progress) item" +
					(PLAN_UNCERTAINTY ? "; execution is held while any plan_write uncertainties remain unresolved" : "") +
					". Call this once planning is done and you're ready to do the work. Safe to call again to resume.",
				promptSnippet: "plan_go(): begin executing the current plan (planned -> executing).",
				promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
					"After plan_write has produced a complete executable plan with no unresolved uncertainties, call plan_go once to begin or resume execution.",
				] : undefined,
				parameters: Type.Object({}),
				async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
					const aid = actionId();
					rememberModel(ctx);

					// Guards + queueing + disarm-on-ok live in goTransition (shared
					// with /plan-go). This body only maps the outcome onto the tool's
					// channels: planEvent + throw for failures, tool-result content
					// for the execute prompt, a "tool"-shaped trace row.
					const outcome = await goTransition(ctx.cwd);

					if (!outcome.ok) {
						if (outcome.reason === "no-plan") {
							planEvent("go-blocked", `no-plan-${aid}`, { reason: "no-plan", activation: "tool" });
							rejectPlanTool("plan_go: no plan to run. Call plan_write first to create one, then call plan_go.");
						}
						if (outcome.reason === "no-open-items") {
							planEvent("go-blocked", outcome.runId, { reason: "no-open-items", activation: "tool" });
							rejectPlanTool("plan_go: plan is complete — no open items. Nothing to execute; call plan_write to add more work first.");
						}
						const state = outcome.state;
						planEvent("uncertainty-hold", state.run_id, { count: state.uncertainties!.length, gate: "plan-go-tool" });
						rejectPlanTool(
							`plan_go: execution held — ${state.uncertainties!.length} unresolved uncertaint(y/ies):\n` +
							`${state.uncertainties!.map((u) => `- ${u}`).join("\n")}\n` +
							"Ask the user these exact questions, then clear them via plan_write (uncertainties: []) and call plan_go again.");
					}

					const { state, resuming, stale } = outcome;
					pi.appendEntry("plan_spine", { run_id: state.run_id });
					await appendTrace(ctx.cwd, {
						run_id: state.run_id,
						action_type: "tool",
						tool_name: "plan_go",
						action_id: aid,
						success: true,
						output_summary: resuming ? "resume" : "execute",
						final_status: derivedStatus(state),
					});
					planEvent("go", state.run_id, { resumed: resuming, stale: stale.length, activation: "tool" });

					const subagentAvailable = pi.getActiveTools().includes("subagent");
					return {
						content: [{ type: "text" as const, text: `plan_go: execution started (run_id=${state.run_id}).\n\n${executePrompt(state, subagentAvailable)}${resumeNoteFor(stale)}` }],
						details: { tool_name: "plan_go", action_id: aid, success: true },
						terminate: false,
					};
				},
			}),
		);
	}

	// Fires for exactly ONE rejection path: execute() throwing via rejectPlanTool.
	// It does NOT — and cannot — see argument-validator rejections, despite what an
	// earlier version of this comment claimed: pi emits no tool_result at all for a
	// call that fails validation, is blocked, or names an unknown tool (agent-loop
	// routes those to an "immediate" preparation whose only events are
	// tool_execution_start/end). That is why this observer, written for the
	// validator case, recorded nothing until rejections started throwing on
	// 2026-07-30. Observed without retaining the raw message or malformed payload.
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "plan_write" || !event.isError) return;
		rememberModel(ctx);
		const state = await readState(ctx.cwd);
		planEvent("write-rejected", state?.run_id ?? `rejected-${actionId()}`, {
			reason_class: "schema_or_execution",
			context_tokens: ctx.getContextUsage?.()?.tokens ?? null,
		});
	});

	pi.registerCommand("plan", {
		description: "Plan a request. Lean: plan then stop for /plan-go. Add 'yolo' to plan+run without routine pauses.",
		handler: async (args, ctx) => {
			await startPlanCommand(args, ctx, pi);
		},
	});
	if (PLAN_MODE === "adaptive") {
		pi.registerCommand("plan-direct", {
			description: "Adaptive dark candidate: run one explicitly bounded, low-risk objective without plan ceremony.",
			handler: async (args, ctx) => {
				const request = boundedDirectRequest(args);
				if (!request) {
					planEvent("direct", `direct-${actionId()}`, { request_bytes: Buffer.byteLength(args, "utf8"), accepted: false, reason: "empty-or-risky" });
					ctx.ui.notify("Adaptive direct mode refused: provide one short, low-risk objective (no destructive, deployment, or secret operations).", "error");
					return;
				}
				setAdaptiveDirect(true);
				planEvent("direct", `direct-${actionId()}`, { request_bytes: Buffer.byteLength(request, "utf8"), accepted: true, reason: "explicit-bounded" });
				pi.sendUserMessage(
					`Adaptive direct mode for one bounded objective: ${request}\n\nWork directly with the available tools. Keep the change narrow; after any source mutation run the recognized project gate (or mark the objective blocked if no safe verification exists). Do not expand scope, re-plan, or perform destructive/deployment/secret operations.`,
					{ deliverAs: "steer" },
				);
			},
		});
	}
	pi.registerCommand("plan-go", {
		description: "Run or resume the plan. Add 'yolo' to finish without routine pauses, 'lean' to pause per step.",
		handler: async (args, ctx) => {
			await goCommand(args, ctx, pi);
		},
	});
	pi.registerCommand("plan-status", {
		description: "Show the current plan.",
		handler: async (_args, ctx) => {
			return statusCommand(ctx);
		},
	});
	if (PLAN_MODE === "adaptive") {
		pi.registerCommand("plan-export", {
			description: "Explicitly export the private run-capsule plan as the human-readable .pi/TODO.md view.",
			handler: async (_args, ctx) => {
				const state = await readState(ctx.cwd);
				if (!state) { ctx.ui.notify("No plan to export.", "info"); return; }
				await mkdir(dirname(todoPath(ctx.cwd)), { recursive: true });
				await atomicWrite(todoPath(ctx.cwd), renderTodo(state));
				ctx.ui.notify("Plan exported for human review.", "info");
			},
		});
	}
	pi.registerCommand("plan-trace", {
		description: "Show recent plan trace entries.",
		handler: async (args, ctx) => {
			return traceCommand(args, ctx);
		},
	});
	pi.registerCommand("runtime-status", {
		description: "Show provider/model runtime status.",
		handler: async (_args, ctx) => ctx.ui.notify(await runtimeStatusText(ctx), "info"),
	});

	// Reactive context prune: rewind the window to the plan node (stamped at
	// execution start), collapsing the work since into a branch summary. The plan
	// itself lives in plan-state.json (external), so it survives the jump.
	pi.registerCommand("collapse", {
		description: "Rewind window to the plan node, summarise the work since (prune execution noise, keep the plan).",
		handler: async (args, ctx) => {
			const spine = [...ctx.sessionManager.getEntries()].reverse().find((e) => e.type === "custom" && e.customType === "plan_spine");
			if (!spine) {
				ctx.ui.notify("No plan node found — run /plan then /plan-go first, or use /compact.", "warning");
				return;
			}
			await ctx.navigateTree(spine.id, {
				summarize: true,
				label: "collapsed to plan",
				customInstructions:
					args.trim() ||
					"Summarise the work since the plan started: done steps + key results/decisions, current state, what remains. Tight, factual; drop tool noise.",
			});
		},
	});

	// Structural plan-mode stop: while the /plan-started run is in flight, block
	// real mutations. The prompt's "no edits" is now enforced, not just stated.
	// Read-only bash stays allowed — planning needs investigation.
	pi.on("tool_call", async (event, ctx) => {
		if (isPlanning()) {
			const bashMutates = event.toolName === "bash"
				&& classifyBashCommand(String((event.input as Record<string, unknown> | undefined)?.command ?? "")).mutates;
			const isMutation = PLAN_MUTATION_TOOLS.has(event.toolName) || bashMutates;
			if (!isMutation) return;
			// A bash block here is usually NOT an attempted edit.
			// command-policy deliberately favours false positives ("anything not
			// positively recognised as inspection is a mutation risk"), so read-only
			// recon — `find -exec grep`, a status script, an unknown task runner — trips
			// it. The legacy message says "no edits", which misdiagnoses that model and
			// names no alternative; observed live 2026-07-27, five blocked attempts in a
			// row before the model abandoned a plan it could not size without counting.
			const kind = bashMutates && !PLAN_MUTATION_TOOLS.has(event.toolName) ? "inspect" : "edit";
			planEvent("plan-mode-block", `plan-mode-${actionId()}`, { toolName: event.toolName, block_kind: kind });
			if (kind === "inspect") {
				return {
					block: true,
					reason: steerText("PLAN_INSPECT_BLOCK",
						"failure_class=plan_mode_violation. PLAN phase blocks file CHANGES, not investigation — but this bash command is not recognised as read-only (a script file, or an unknown binary, whose contents cannot be checked). Use the read/grep/find/ls tools, or a plain read-only command. To change files: plan_write, end your turn, /plan-go executes.",
						{ tool: event.toolName }),
				};
			}
			return {
				block: true,
				reason:
					"failure_class=plan_mode_violation. PLAN phase — no edits. Finish the plan (plan_write), end your turn. /plan-go starts execution.",
			};
		}
		// c38 FORCE_PLAN_WRITE: checked before c37/c25 — those key off
		// state?.phase === "executing", which can't be true before the first
		// plan_write anyway, so ordering doesn't change their behavior; this
		// just gives the earliest, most specific reason when no plan exists yet.
		if (FORCE_PLAN_WRITE && !adaptiveDirectActive()) {
			// Gemma model-family skip — a deployment scope guard, not an A/B knob
			// (same class as loop-breaker's LB_LOCAL_ONLY: decides WHERE this runs,
			// deliberately absent from schema.json thresholds). Grounds: measured
			// 0/9 on gemma-4-e2b with fabricated "tests passed" claims over red
			// gates (CANDIDATE_PRUNING_2026-07.md) — the corpus's only p<0.05 harm.
			// Standing verdict: never arm on that family. Read ctx.model directly:
			// activeModel can still be {unknown} on a session's first tool call.
			const model = rememberModel(ctx ?? {});
			if (/gemma/i.test(model.id)) {
				planEvent("force-plan-write-skip", `gemma-${actionId()}`, { model_class: "gemma" });
			} else {
				const isMutation =
					PLAN_MUTATION_TOOLS.has(event.toolName) ||
					(event.toolName === "bash" && classifyBashCommand(String((event.input as Record<string, unknown> | undefined)?.command ?? "")).mutates);
				// Fail open when plan_write isn't in the session's active tool set —
				// blocking with no escape hatch is a deadlock, proven live: a --tools
				// list without plan_write left the model retry-looping the block for
				// 15 minutes ("plan_write is not in my available tools list") before
				// giving up. Same check pattern as subagentAvailable in c25/c37.
				if (isMutation && pi.getActiveTools().includes("plan_write")) {
					const state = await readState(ctx.cwd);
					if (!state) {
						planEvent("force-plan-write-block", `no-plan-${actionId()}`, { toolName: event.toolName });
						// The message names the FULL path. The gemma collapse's root
						// cause was this message ending "Then retry this call" — the
						// model wrote one plan, never activated it, and fabricated
						// completion. plan_go is default-on in the same adoption, so
						// naming it is honest.
						return {
							block: true,
							reason:
								"failure_class=plan_mode_violation. No plan exists yet. First call plan_write with at least a one-item plan, then call plan_go to start executing, then retry this call.",
						};
					}
				}
			}
		}
		// PLAN_SUBAGENT_ONLY candidate: during execution (not planning), force every
		// scoped edit through a fresh subagent instead of leaving delegation advisory
		// — full process isolation for each scoped edit.
		// Covers bash mutations too (sed -i, cat >, ...), not just edit/write/multiedit
		// — a mutating bash call is exactly as much a direct edit as those tools.
		if (PLAN_SUBAGENT_ONLY) {
			const isMutation =
				PLAN_MUTATION_TOOLS.has(event.toolName) ||
				(event.toolName === "bash" && classifyBashCommand(String((event.input as Record<string, unknown> | undefined)?.command ?? "")).mutates);
			if (isMutation) {
				const state = await readState(ctx.cwd);
				if (state?.phase === "executing") {
					rememberModel(ctx);
					planEvent("subagent-only-block", state.run_id, { toolName: event.toolName });
					// Only point at subagent(executor, ...) when it's genuinely available —
					// real_gate.sh's tool list must include it whenever this threshold is
					// on, but don't assume that wiring is correct; check, don't promise.
					const subagentAvailable = pi.getActiveTools().includes("subagent");
					return {
						block: true,
						reason: subagentAvailable
							? (SPAWN_DELEGATION
								? "failure_class=plan_mode_violation. Direct mutation is disabled under PLAN_SUBAGENT_ONLY — use subagent(executor, ..., mode=spawn) with a self-contained task (the child sees only the task text) for this scoped edit instead."
								: "failure_class=plan_mode_violation. Direct mutation is disabled under PLAN_SUBAGENT_ONLY — use subagent(executor, ..., mode=fork) for this scoped edit instead.")
							: "failure_class=plan_mode_violation. Direct mutation is disabled under PLAN_SUBAGENT_ONLY, and no subagent tool is available in this session — mark the item blocked and stop rather than retry.",
					};
				}
			}
		}
	});

	// Observability only: if the agent goes idle with open items, record it.
	// No prompt re-injection (that was the fragile part of v2).
	pi.on("agent_end", async (_event, ctx) => {
		rememberModel(ctx);
		setAdaptiveDirect(false);
		setPlanning(false); // planning run ended (well-behaved or not) — disarm
		const cwd = ctx.cwd;
		const state = await readState(cwd);
		// Backstop for a silently-parked question: if the run ends blocked ON THE USER,
		// surface it in the UI even when the model failed to voice it (any phase).
		const waiting = state?.items.find(
			(i) => i.status === "blocked" &&
				(i.failure_class === "blocked_needs_input" || i.failure_class === "user_action_required"),
		);
		if (waiting) {
			ctx.ui.notify(`plan is waiting on you — ${waiting.title}${waiting.note ? `: ${waiting.note}` : ""}`.slice(0, 200), "warning");
		}
		// c31 backstop: the run ended with declared-but-unresolved uncertainties —
		// the user must always see the parked questions, voiced or not.
		if (PLAN_UNCERTAINTY && state && (state.uncertainties?.length ?? 0) > 0) {
			planEvent("uncertainty-hold", state.run_id, { count: state.uncertainties!.length, gate: "agent-end" });
			ctx.ui.notify(
				`plan has ${state.uncertainties!.length} unresolved uncertaint(y/ies):\n${state.uncertainties!.map((u) => `- ${u}`).join("\n").slice(0, 400)}`,
				"warning",
			);
		}
		if (!state || state.phase !== "executing") return;
		const open = state.items.some((i) => i.status === "pending" || i.status === "in_progress");
		if (!open) return;
		await appendTrace(cwd, {
			run_id: state.run_id,
			action_type: "agent_end",
			success: false,
			failure_class: "unknown",
			observed_state: { open_items: state.items.filter((i) => i.status === "pending" || i.status === "in_progress").length },
			output_summary: "Agent ended with open TODO items",
			final_status: "ended_without_completion",
		});
	});
}
