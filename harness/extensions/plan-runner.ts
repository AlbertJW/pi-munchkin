import { appendFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertVerifyGateAllowed, classifyBashCommand } from "../lib/command-policy.ts";
import { runReadonlyGate } from "../lib/gate-runtime.ts";
import { planIntegrity, executionUnderway, normalizeTitle, preserveDecision, shaCandidates, validateDeps, unmetDeps, reconcileItems as libReconcile, type ReconciledItem, type IncomingItem } from "../lib/plan-integrity.ts";
import { nextReplanStreak, parseTodoLine } from "../lib/plan-progress.ts";
import { processWriterMarker } from "../lib/process-writer.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

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
// One-shot resume flags (reset by /plan starting a fresh plan): the interrupted-
// plan notice fires at most once per process, as does the partial-work note on
// the first plan_write against a foreign-writer state (headless resumes that
// never run /plan-go).
let resumeNotified = false;
let partialWorkNoted = false;
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
}
// B yields an omitted open item after this many consecutive preserves (persistent
// omission = intent; e.g. a parent the model replaced with sub-items). R1 (done) never yields.
const PRESERVE_MAX = Math.max(2, Number.parseInt(process.env.PLAN_PRESERVE_MAX || "3", 10) || 3);
// Candidate (dark, A/B via real_gate.sh): force every scoped edit through a fresh
// subagent instead of leaving delegation advisory. Trades per-edit spawn overhead
// for full process isolation of each edit — measure, don't assume, the tradeoff.
const PLAN_SUBAGENT_ONLY = process.env.PLAN_SUBAGENT_ONLY === "1";
// Dark candidate c31: a plan-level uncertainties[] field with a structural
// pause — a model that surfaces uncertainty must be stopped from guessing
// past it (deterministic gate, no LLM judgment call). npcsh loop_plan port.
const PLAN_UNCERTAINTY = process.env.PLAN_UNCERTAINTY === "on";
// Dark candidate c32: verify commit SHAs the model writes into notes/summary
// actually exist (git cat-file -e) — catches confabulated provenance.
const PLAN_SHA_GUARD = process.env.PLAN_SHA_GUARD === "on";

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
function statePath(cwd: string): string {
	return join(cwd, ".pi", "plan-state.json");
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

async function tailLines(path: string, maxLines: number): Promise<string[]> {
	try {
		const raw = await readFile(path, "utf8");
		return raw.split("\n").filter((line) => line.trim().length > 0).slice(-maxLines);
	} catch {
		return [];
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

async function writeStateAndTodo(cwd: string, state: PlanState): Promise<void> {
	state.updated_at = isoNow();
	state.writer = PROC_MARK;
	const sp = statePath(cwd);
	await mkdir(dirname(sp), { recursive: true });
	await writeFile(sp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await writeFile(todoPath(cwd), renderTodo(state), "utf8");
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id,
		item_id: currentItem(state)?.id,
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
	return `Plan only. No edits, no shell writes, no other work.
${vague}
Risky REQ, or several viable approaches → in thinking only: draft a minimal-safe plan and a thorough plan, then merge — keep each item that buys real risk coverage, drop the rest. Emit only the merged plan. Clear simple REQ → skip the comparison, plan straight.
Break REQ into 5-10 ordered items. Small steps, no fake splits.
Prefer vertical slices — each item leaves something working/verifiable.
Each item names its done-check: an observable result, or a \`gate\` command that proves it complete. Vague boundary → it will drift.
Reply with ONLY the plan_write call — no prose plan. Set request (exact), summary (1 line), items (each status="pending").`;
}

function delegationBlock(subagentAvailable: boolean): string {
	if (!subagentAvailable) return "";
	if (PLAN_SUBAGENT_ONLY) {
		return `
Every edit routes through a subagent — this is enforced, not advisory:
- Heavy lookup (big file, wide search) → subagent(explorer, …). Don't pull big files in here.
- Non-trivial claim or change → subagent(verifier, …); accept only on VERDICT: confirmed.
- ANY edit, however small → subagent(executor, …, mode=fork). Direct edit/write/multiedit calls are blocked during execution.`;
	}
	return `
Delegate to keep this window clean (subagent returns only a compact result):
- Heavy lookup (big file, wide search) → subagent(explorer, …). Don't pull big files in here.
- Non-trivial claim or change → subagent(verifier, …); accept only on VERDICT: confirmed.
- Isolated, fully-scoped edit → subagent(executor, …, mode=fork). You own the plan; trivial edits yourself.`;
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
	const settingsFile = join(homedir(), ".pi", "agent", "settings.json");
	const modelsFile = join(homedir(), ".pi", "agent", "models.json");
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

		// A structurally broken dependency graph (unknown ref, self-dep, cycle) is a
		// plan-authoring error — reject before ANY state is written so the model
		// fixes and resends rather than persisting a graph no one can order.
		const depErrors = validateDeps(params.items);
		if (depErrors.length > 0) {
			const existing = await readState(ctx.cwd);
			planEvent("deps-rejected", existing?.run_id ?? `rejected-${aid}`, { errors: depErrors.length });
			return {
				content: [{ type: "text" as const, text:
					"plan_write rejected:\n- " + depErrors.join("\n- ") +
					"\nFix depends_on (reference exact titles of other items in THIS list) and resend the ENTIRE list." }],
				details: { tool_name: "plan_write", action_id: aid, success: false },
				isError: true,
				terminate: false,
			};
		}

		const { state, newlyBlocked, gateMsgs, integrity, newlyDone, prevCompleted, stalePrev, wasRewrite } = await mutatePlan(ctx.cwd, async (prev) => {
			const eventRunId = prev?.run_id ?? `plan-${timestamp()}`;
			const items = reconcileItems(prev?.items, params.items as any);
			const prevById = new Map((prev?.items ?? []).map((i) => [i.id, i]));
			const prevBlocked = new Set((prev?.items ?? []).filter((i) => i.status === "blocked").map((i) => i.id));

			// Repeater: run the gate on items newly transitioning to "done". Exit 0 keeps
			// done; non-zero reverts (→ in_progress, then blocked at GATE_MAX). Opt-in via
			// item.gate, so gateless items are unaffected.
			const gateMsgs: string[] = [];
			for (const it of items) {
				if (it.status !== "done" || !it.gate || !api) continue;
				if (prevById.get(it.id)?.status === "done") continue; // already passed
				const gateAllowed = assertVerifyGateAllowed(it.gate);
				if (!gateAllowed.ok) {
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
				const gateResult = await runReadonlyGate(api.exec.bind(api), ctx.cwd, it.gate, GATE_TIMEOUT_MS);
				const out = gateResult.output;
				if (gateResult.pass) {
					it.gate_fails = 0;
					// A green plan gate IS a passing verify. Share it (one-shot flag,
					// same-process globalThis idiom) so verify-gate doesn't nag the
					// wrap-up to verify again after the gate already ran green.
					(globalThis as Record<string, unknown>).__pi_gate_green = true;
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
							"✗ gate for \"{title}\" failed again ({fails}/{max}) — the same fix path is not working. Delegate the repair to subagent(executor, ..., mode=fork): brief it with the item, the gate command `{gate}`, and the failing output below, then mark the item done to re-run the gate.\nFailing output (tail): {tail}",
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
			return { state: next, result: { state: next, newlyBlocked, gateMsgs, integrity: { reattached, preservedOpen, yieldedOpen }, newlyDone, prevCompleted, stalePrev, wasRewrite: Boolean(prev) } };
		});

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
		let finalReport = "";
		if (newlyDone > 0 && !prevCompleted && derivedStatus(state) === "completed") {
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
		// c32: SHA-shaped tokens the model wrote into notes/summary must reference
		// commits that actually exist. Runs AFTER the state write (never blocks
		// persistence), fail-open on any git error, steer-only.
		let shaWarn = "";
		if (PLAN_SHA_GUARD && api) {
			const written = [params.summary ?? "", ...params.items.map((item) => item.note ?? "")].join("\n");
			const candidates = shaCandidates(written);
			if (candidates.length) {
				const missing: string[] = [];
				// A missing object and a missing REPOSITORY both exit 128 from
				// cat-file, so establish "this is a repo" first; outside a repo (or
				// with git absent) the guard fails open and never accuses.
				let inRepo = false;
				try {
					inRepo = (await api.exec("git", ["rev-parse", "--git-dir"], { cwd: ctx.cwd, timeout: 2000 })).code === 0;
				} catch { /* git absent — fail open */ }
				for (const sha of inRepo ? candidates : []) {
					try {
						const probe = await api.exec("git", ["cat-file", "-e", `${sha}^{commit}`], { cwd: ctx.cwd, timeout: 2000 });
						if (probe.code !== 0) missing.push(sha);
					} catch {
						// timeout — fail open, never punish
					}
				}
				planEvent("sha-guard", state.run_id, { checked: candidates.length, missing: missing.length });
				if (missing.length) {
					shaWarn = "\n" + steerText(
						"PLAN_SHA_GUARD_MSG",
						"⚠ {shas} do(es) not exist in this repository — never fabricate commit hashes. Run `git log --oneline -1` and record the REAL hash, or remove the reference.",
						{ shas: missing.join(", ") },
					);
				}
			}
		}
		const gateNote = gateMsgs.length ? `\n${gateMsgs.join("\n")}` : "";
		const body = `Plan updated (${state.items.length} items, status: ${derivedStatus(state)}).${cur ? `\nNext open: ${cur.title}` : "\nNo open items remain."}${warning}${askNow}${finalReport}${integrityWarn}${thrashWarn}${depWarn}${uncertaintyWarn}${resumeWarn}${shaWarn}${gateNote}`;
		return {
			content: [{ type: "text", text: body }],
			details: { tool_name: "plan_write", action_id: aid, success: true },
			terminate: false,
		};
	},
});

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
	resumeNotified = true; // a fresh plan supersedes any interrupted one — no resume notice
	partialWorkNoted = false; // ...but a later foreign-writer state may still warrant the note
	await mutatePlan(ctx.cwd, async () => {
		await archiveExistingTodo(ctx.cwd);
		const state = newState(request, "Planning pending. The model will call plan_write.", autonomy, []);
		if (yolo) state.phase = "executing"; // yolo plans + runs in one flow — no /plan-go to flip it; keep status honest
		return { state, result: state };
	});
	await appendTrace(ctx.cwd, { action_type: "command", tool_name: "plan", success: true, input_summary: request, output_summary: `autonomy=${autonomy}` });
	const subagentAvailable = pi.getActiveTools().includes("subagent");
	if (yolo) pi.appendEntry("plan_spine", {}); // yolo executes immediately — mark the node for /collapse
	setPlanning(!yolo); // arm the plan-mode mutation block for this agent run (yolo executes, so no block)
	pi.sendUserMessage(yolo ? planAndExecutePrompt(request, subagentAvailable) : planOnlyPrompt(request));
}

async function goCommand(args: string, ctx: { cwd: string; model?: { provider?: string; id?: string }; ui: { notify(m: string, l?: string): void } }, pi: ExtensionAPI) {
	rememberModel(ctx);
	setPlanning(false); // execution starts — disarm the plan-mode mutation block
	replanStreak = 0; // execution start — reset thrash counter so planning drafts don't carry in
	const state = await readState(ctx.cwd);
	if (!state || state.items.length === 0) {
		ctx.ui.notify("No plan to run. Start with /plan <request>.", "error");
		return;
	}
	const open = state.items.filter((i) => i.status === "pending" || i.status === "in_progress");
	if (open.length === 0) {
		ctx.ui.notify("Plan is complete — no open items. Start a new plan with /plan <request>.", "info");
		return;
	}
	// c31: deterministic hold — execution cannot start while the model's own
	// declared uncertainties remain. No LLM judgment; clear them via plan_write.
	if (PLAN_UNCERTAINTY && (state.uncertainties?.length ?? 0) > 0) {
		planEvent("uncertainty-hold", state.run_id, { count: state.uncertainties!.length, gate: "plan-go-block" });
		ctx.ui.notify(
			`Execution held — ${state.uncertainties!.length} unresolved uncertaint(y/ies):\n${state.uncertainties!.map((u) => `- ${u}`).join("\n")}\nAnswer them, have the model clear the field (plan_write uncertainties: []), then /plan-go again.`,
			"warning",
		);
		return;
	}

	// Optional mode switch: /plan-go yolo  or  /plan-go lean
	const mode = /(^|\s)yolo$/i.test(args) ? "yolo" : /(^|\s)lean$/i.test(args) ? "lean" : undefined;
	if (mode) state.autonomy = mode;

	const resuming = state.phase === "executing";
	// Capture BEFORE writeStateAndTodo stamps this process as the writer.
	const stale = staleInProgress(state);
	state.phase = "executing";
	await writeStateAndTodo(ctx.cwd, state);
	pi.appendEntry("plan_spine", { run_id: state.run_id }); // mark this node for /collapse
	await appendTrace(ctx.cwd, { run_id: state.run_id, action_type: "command", tool_name: "plan-go", success: true, output_summary: `${resuming ? "resume" : "execute"}${mode ? ` autonomy=${mode}` : ""}` });

	const subagentAvailable = pi.getActiveTools().includes("subagent");
	const resumeNote = stale.length
		? `\n\nRESUMED from a previous session. Previously in_progress item(s) may have PARTIAL WORK on disk: ${stale.map((i) => i.title).join("; ")}. Inspect current state (git status/diff, read the touched files) before continuing — do not trust it done and do not redo it blind.`
		: "";
	pi.sendUserMessage(executePrompt(state, subagentAvailable) + resumeNote);
}

async function statusCommand(ctx: { cwd: string; ui: { notify(m: string, l?: string): void } }) {
	const state = await readState(ctx.cwd);
	if (!state) {
		ctx.ui.notify("No .pi/plan-state.json or .pi/TODO.md found.", "info");
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
		rememberModel(ctx);
		if (resumeNotified) return;
		resumeNotified = true;
		const state = await readState(ctx.cwd);
		if (!state || state.writer === PROC_MARK) return;
		const open = state.items.filter((i) => i.status === "pending" || i.status === "in_progress" || i.status === "blocked");
		if (open.length === 0) return;
		const inProgress = state.items.filter((i) => i.status === "in_progress").length;
		planEvent("resume-found", state.run_id, { open: open.length, in_progress: inProgress });
		ctx.ui.notify(
			`Interrupted plan from a previous session: "${state.request}" — ${open.length} open item(s)${inProgress ? `, ${inProgress} in_progress (may have partial work)` : ""}. /plan-status to inspect, /plan-go to resume, /plan <request> to replace.`,
			"info",
		);
	});

	pi.registerTool(planWrite);

	// Pi's argument validator can reject a plan_write before execute() runs. Observe
	// that result without retaining the validator's raw message or malformed payload.
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
			const isMutation =
				PLAN_MUTATION_TOOLS.has(event.toolName) ||
				(event.toolName === "bash" && classifyBashCommand(String((event.input as Record<string, unknown> | undefined)?.command ?? "")).mutates);
			if (!isMutation) return;
			return {
				block: true,
				reason:
					"failure_class=plan_mode_violation. PLAN phase — no edits. Finish the plan (plan_write), end your turn. /plan-go starts execution.",
			};
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
							? "failure_class=plan_mode_violation. Direct mutation is disabled under PLAN_SUBAGENT_ONLY — use subagent(executor, ..., mode=fork) for this scoped edit instead."
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
