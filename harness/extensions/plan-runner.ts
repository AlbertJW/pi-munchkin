import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import { chmod, mkdir, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ACTIVE_TOOL_PROMPTS } from "../lib/active-tool-prompts.ts";
import { BRANCH_REPORT_ENV, PLAN_CONTEXT_ENV, RESEARCH_COVERAGE_KEY, RESEARCH_RESERVED_BUDGET_KEY, RESEARCH_SCOUT_DISPATCHED_KEY, branchEvidenceYieldError, readPlanContext, validateBranchReport, validResearchCoverageObservation, writeBranchReport, type BranchReportV1, type PlanContextV1, type ResearchCoverageObservation } from "../lib/branch-report.ts";
import { classifyBashCommand } from "../lib/command-policy.ts";
import { emitHarnessSignal, onHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { PLAN_SURFACE_TOOLS } from "../lib/capability-surface.ts";
import {
	PLAN_DEFER_FIELD_MAX_BYTES, PLAN_MAX_DELTAS, PLAN_MAX_ITEMS, PLAN_NOTE_MAX_BYTES,
	PLAN_STATE_MAX_BYTES, PLAN_TITLE_MAX_BYTES,
} from "../lib/plan-limits.ts";
import { applyPlanDeltas, type PlanDelta } from "../lib/plan-delta.ts";
import {
	DEEP_RESEARCH_MAX_CHILDREN, DEEP_RESEARCH_MAX_DEPTH, DEEP_RESEARCH_MAX_ROOTS,
	addBudget, budgetWithin, childrenOf, descendantCount, depthOf, expandGraph, graphItemId, graphTerminal, ownerRef, settleErrors, validateGraph,
	type BranchChildInput, type GraphPlanItem, type GraphPlanState, type PlanStatus, type ResearchBranchLease, type ResearchBudget,
} from "../lib/plan-graph.ts";
import { planStorageMode, privatePlanProjectionPath, privatePlanStatePath, privatePlanTracePath } from "../lib/plan-state-storage.ts";
import { processWriterMarker } from "../lib/process-writer.ts";
import { storedUrl } from "../lib/research-ledger.ts";
import { initialToolSurface } from "../lib/session-bootstrap.ts";
import { record } from "../lib/telemetry.ts";
import { CORE_NAMES, profileFromEnvironment } from "./tool-activation.ts";
import {
	acceptGoal, blockGoal, cancelGoal, createGoal, goalAmbientSummary, goalsEnabled, inspectGoal, mutateGoal, pauseGoal, readCurrentGoal,
	readExecutableGoal, readGoals, resumeGoal, settleGoal, updateGoal, GOAL_MAX_CRITERIA, GOAL_MODEL_TEXT_MAX_BYTES, goalScope, renderGoalRecoveryBrief,
	type CriterionStatus, type DeferredGoalItem, type GoalInspectSection, type GoalState,
} from "../lib/goal-state.ts";

// One bounded ordered checklist. plan_write owns structure; plan_update owns
// status. Project verification is deliberately outside this module.

const MAX_ITEMS = PLAN_MAX_ITEMS;
const MAX_TITLE_BYTES = PLAN_TITLE_MAX_BYTES;
// 300 caused live churn: models packing per-item substeps (the tool guidance's own
// advice) hit the cap and rewrote repeatedly (Albert, 2026-08-25). 900 with the
// state cap raised in step: 24 full items at 900-byte notes ≈ 27.7 KiB.
const MAX_NOTE_BYTES = PLAN_NOTE_MAX_BYTES;
const MAX_PLAN_BYTES = PLAN_STATE_MAX_BYTES;
const MAX_DELTAS = PLAN_MAX_DELTAS;  // matches MAX_ITEMS: a full-plan status resend must not die in the schema validator (audit B5)

// Byte-aware truncation for migration paths: .slice() counts CHARACTERS, so a
// multibyte note could survive the slice, exceed the byte budget, fail
// validateGraph, and silently vanish the whole plan (audit 2026-08-25).
export function truncateBytes(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	// Drop whole CODE POINTS, not code units. `.slice(0, -1)` removes one UTF-16 unit,
	// so trimming a string ending in a non-BMP character strips the low surrogate and
	// leaves the high one — at which point the byte budget is satisfied and the loop
	// stops. That lone surrogate survives JSON.stringify into plan-state.json but
	// becomes U+FFFD when the Markdown projection is written as UTF-8, so the
	// authoritative file and its projection disagree byte-for-byte. Measured:
	// truncateBytes("界".repeat(39) + "😀", 120) ended on 0xD83D.
	let out = value;
	while (out.length > 0 && Buffer.byteLength(out, "utf8") > maxBytes) {
		const last = out.charCodeAt(out.length - 1);
		const lowSurrogate = last >= 0xDC00 && last <= 0xDFFF;
		out = out.slice(0, lowSurrogate ? -2 : -1);
	}
	const tail = out.charCodeAt(out.length - 1);
	if (tail >= 0xD800 && tail <= 0xDBFF) out = out.slice(0, -1);
	return out;
}
export const FORCE_PLAN_WRITE_DEFAULT: "on" | "off" = "off";
const FORCE_PLAN_WRITE = (process.env.FORCE_PLAN_WRITE ?? FORCE_PLAN_WRITE_DEFAULT) !== "off";
const PLAN_TOOL_GO = process.env.PLAN_TOOL_GO === "on";
export const PLAN_GRAPH_DEFAULT: "on" | "off" = "off";
export const DEEP_RESEARCH_PLANNING_DEFAULT: "on" | "off" = "off";
const PLAN_GRAPH = (process.env.PLAN_GRAPH ?? PLAN_GRAPH_DEFAULT) === "on";
const DEEP_RESEARCH_PLANNING = PLAN_GRAPH && (process.env.DEEP_RESEARCH_PLANNING ?? DEEP_RESEARCH_PLANNING_DEFAULT) === "on";
const DEEP_RESEARCH_DISCOVERY_BUDGET = { searches: 3, reads: 5 } as const;
// Child identity is runner-owned. Fail closed for any non-parent marker rather
// than letting malformed/injected depth metadata silently regain write access
// to the parent-owned goal ledger.
const IS_SUBAGENT_PROCESS = process.env.PI_SUBAGENT_DEPTH !== undefined && process.env.PI_SUBAGENT_DEPTH !== "0";
const GOALS_ENABLED = goalsEnabled();
const TRACE_TAIL_MAX_BYTES = 64 * 1024;
const PROC_MARK = processWriterMarker();
const INVALID_COVERAGE_RETRY_LIMIT = 1;
const invalidCoverageAttempts = new Map<string, number>();

type ItemStatus = PlanStatus;
type Phase = "planned" | "executing";
type Autonomy = "lean" | "yolo";

type PlanItem = GraphPlanItem;

type PlanState = {
	schema_version: 4 | 5;
	run_id: string;
	request: string;
	summary: string;
	autonomy: Autonomy;
	phase: Phase;
	created_at: string;
	updated_at: string;
	items: PlanItem[];
	profile?: GraphPlanState["profile"];
	settled_at?: string;
	writer?: string;
};

type ModelIdentity = { provider: string; id: string };
let activeModel: ModelIdentity = { provider: "unknown", id: "unknown" };
let api: ExtensionAPI | undefined;
let lastSessionCwd: string | null = null;
// Captured at session_start so the LATE capsule-identity rebind — the only point at
// which plan state is readable under the shipped defaults — can still reach the user.
let lastNotify: ((message: string) => void) | null = null;
let reboundAnnounced = false;
let pendingRebind: Promise<void> | null = null;
let pendingBranchMerge: Promise<void> | null = null;
let awaitingReview = false;
let planningSurfaceBefore: string[] | null = null;
let planningSurfaceApplied: string[] | null = null;
let delegatedBranchProcess = false;
const DELEGATED_BRANCH_PROCESS_GLOBAL = "__pi_delegated_branch_process_v1";

const PLAN_FLAG = "__pi_plan_phase_active";
const EXPLICIT_FLAG = "__pi_tool_selection_explicit";
const RESEARCH_ROOT_CONTEXTS_KEY = "__pi_research_root_contexts_v1";
const SAFE_PLAN_TOOLS = new Set([
	"read", "grep", "find", "ls", "search_spans", "read_span", "recall", "plan_write", "capability",
]);
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit"]);

function rememberModel(ctx: { model?: { provider?: string; id?: string } }): void {
	if (ctx.model?.provider && ctx.model?.id) activeModel = { provider: ctx.model.provider, id: ctx.model.id };
}

function isoNow(): string { return new Date().toISOString(); }
function timestamp(): string { return isoNow().replace(/[:.]/g, "-"); }
function actionId(): string { return randomUUID().slice(0, 8); }
function itemId(): string { return graphItemId(); }
function exists(path: string): Promise<boolean> { return stat(path).then(() => true, () => false); }
function utf8Bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }

function cleanText(value: unknown): string {
	return String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
		.trim();
}

function planEvent(kind: string, runId: string, detail: Record<string, unknown> = {}): void {
	record("plan-runner", kind, { run_id: runId, provider: activeModel.provider, model: activeModel.id, ...detail });
	if (!api) return;
	if (kind === "write" && typeof detail.items === "number" && typeof detail.open_items === "number") {
		emitHarnessSignal(api.events, { v: 1, type: "plan/write", runIdHash: signalRunId(runId), items: detail.items, openItems: detail.open_items });
	}
	if (kind === "go") emitHarnessSignal(api.events, { v: 1, type: "plan/go", runIdHash: signalRunId(runId) });
}

function goalEvent(kind: string, goal: GoalState | undefined, detail: Record<string, unknown> = {}): void {
	if (!goal) return;
	const payload = {
		goal_id_hash: createHash("sha256").update(goal.goal_id).digest("hex"), status: goal.status,
		open_criteria: goal.criteria.filter((criterion) => criterion.status === "open").length,
		...detail,
	};
	// Keep each event name statically visible to the catalog tripwire; dynamic
	// event names otherwise make a real emitter look like an orphan.
	switch (kind) {
		case "proposed": record("goal-runner", "proposed", payload); break;
		case "started": record("goal-runner", "started", payload); break;
		case "accepted": record("goal-runner", "accepted", payload); break;
		case "updated": record("goal-runner", "updated", payload); break;
		case "settled": record("goal-runner", "settled", payload); break;
		case "resumed": record("goal-runner", "resumed", payload); break;
		case "paused": record("goal-runner", "paused", payload); break;
		case "blocked": record("goal-runner", "blocked", payload); break;
		case "cancelled": record("goal-runner", "cancelled", payload); break;
	}
}

function publishGoal(goal: GoalState | undefined): void {
	const shared = globalThis as Record<string, unknown>;
	if (goal) shared.__pi_active_goal_context = goalAmbientSummary(goal);
	else delete shared.__pi_active_goal_context;
}

function emitGoalState(pi: ExtensionAPI, goal: GoalState | undefined): void {
	emitHarnessSignal(pi.events, { v: 1, type: "goal/state", status: goal?.status ?? "none" });
}

function goalExecutionPrompt(goal: GoalState): string {
	return [
		"MODE: GOAL",
		"Pursue this persistent user-owned goal across turns until it is complete, explicitly accepted at 80/20, paused, blocked, or cancelled.",
		"Use goal_update to record criterion evidence and residual risk. Use goal_settle only when its evidence requirements are satisfied.",
		renderGoalRecoveryBrief(goal),
	].join("\n\n");
}

async function startGoalTurn(pi: ExtensionAPI, ctx: any, goal: GoalState, action: "goal" | "goal-accept" | "goal-resume"): Promise<void> {
	emitGoalState(pi, goal);
	pi.sendMessage({
		customType: "pi-munchkin:goal-command",
		content: goalExecutionPrompt(goal),
		display: true,
		details: { action, goal_id_hash: createHash("sha256").update(goal.goal_id).digest("hex") },
	}, { triggerTurn: true });
	if (typeof ctx.waitForIdle === "function") await ctx.waitForIdle();
}

function rejectChildGoalMutation(): void {
	if (IS_SUBAGENT_PROCESS) throw new Error("persistent goal mutation is parent-owned; child processes may report findings but cannot write the goal ledger");
}

function rejectChildPlanMutation(): void {
	if (IS_SUBAGENT_PROCESS) throw new Error("persistent plan mutation is parent-owned; child processes may publish only their delegated branch report");
}

async function rebindActiveGoal(cwd: string): Promise<GoalState | undefined> {
	const goal = await readCurrentGoal(cwd);
	publishGoal(goal);
	return goal;
}

function renderGoal(goal: GoalState | undefined, all: GoalState[] = []): string {
	if (!goal) return all.length ? `No active goal. Stored goals: ${all.map((entry) => `${entry.goal_id}=${entry.status}`).join(", ")}` : "No persistent goal found.";
	const criteria = goal.criteria.map((criterion) => `${criterion.id} [${criterion.status}]${criterion.required ? " required" : " optional"} ${criterion.text}`).join("\n");
	return [
		`Goal ${goal.goal_id} [${goal.status}]`, `Scope: ${goal.scope}`, `Objective: ${goal.objective}`,
		`Criteria (${goal.criteria.filter((criterion) => criterion.status === "met").length}/${goal.criteria.length} met):`, criteria || "(none)",
		`Evidence: ${goal.evidence.length}`, `Deferred: ${goal.deferred.length}`, `Confidence: ${goal.confidence ?? "unknown"}`,
		goal.delivered_value ? `Delivered: ${goal.delivered_value}` : "Delivered: not settled",
	].join("\n");
}

function todoPath(cwd: string): string { return join(cwd, ".pi", "TODO.md"); }
function reviewExportPath(cwd: string): string { return join(cwd, ".pi", "plan-review.json"); }
function statePath(cwd: string): string | null {
	return planStorageMode() === "project" ? join(cwd, ".pi", "plan-state.json") : privatePlanStatePath(cwd);
}
function tracePath(cwd: string): string | null {
	return planStorageMode() === "project" ? join(cwd, ".pi", "traces", "plan-runner.jsonl") : privatePlanTracePath(cwd);
}
function usesPrivateStorage(cwd: string): boolean {
	return planStorageMode() === "capsule" && privatePlanStatePath(cwd) !== null;
}

type PlanFileLock = { path: string; lockId: string };
const PLAN_LOCK_TIMEOUT_MS = 10_000;
const PLAN_LOCK_RETRY_MS = 25;
const PLAN_LOCK_STALE_MS = 60_000;

async function lockOwnerAlive(pid: number): Promise<boolean> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function stalePlanLock(path: string): Promise<boolean> {
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; created_at?: unknown };
		if (typeof raw.pid === "number") return !(await lockOwnerAlive(raw.pid));
		if (typeof raw.created_at === "string" && Number.isFinite(Date.parse(raw.created_at))) return Date.now() - Date.parse(raw.created_at) > PLAN_LOCK_STALE_MS;
	} catch { /* malformed locks are only recoverable after the bounded age */ }
	try {
		const info = await stat(path);
		return Date.now() - info.mtimeMs > PLAN_LOCK_STALE_MS;
	} catch { return false; }
}

async function acquirePlanFileLock(path: string): Promise<PlanFileLock> {
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + PLAN_LOCK_TIMEOUT_MS;
	while (Date.now() <= deadline) {
		const lockId = randomUUID();
		try {
			const handle = await open(lockPath, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify({ pid: process.pid, lock_id: lockId, created_at: isoNow() })}\n`, "utf8");
				await handle.chmod(0o600);
				await handle.sync();
			} finally { await handle.close(); }
			return { path: lockPath, lockId };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await stalePlanLock(lockPath)) { await unlink(lockPath).catch(() => undefined); continue; }
			await new Promise((resolve) => setTimeout(resolve, PLAN_LOCK_RETRY_MS));
		}
	}
	throw new Error("plan state is busy in another parent process; retry after it exits");
}

async function releasePlanFileLock(lock: PlanFileLock): Promise<void> {
	try {
		const raw = JSON.parse(await readFile(lock.path, "utf8")) as { lock_id?: unknown };
		if (raw.lock_id !== lock.lockId) return;
	} catch { return; }
	await unlink(lock.path).catch(() => undefined);
}

async function withPlanFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	const lock = await acquirePlanFileLock(path);
	try { return await fn(); }
	finally { await releasePlanFileLock(lock); }
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try { await handle.sync(); }
	finally { await handle.close(); }
}

async function atomicWrite(path: string, contents: string, privateFile: boolean): Promise<void> {
	const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
	let published = false;
	try {
		const handle = await open(tmp, "wx", privateFile ? 0o600 : 0o644);
		try {
			await handle.writeFile(contents, "utf8");
			if (privateFile) await handle.chmod(0o600);
			await handle.sync();
		} finally { await handle.close(); }
		await rename(tmp, path);
		if (privateFile) await chmod(path, 0o600);
		await syncDirectory(dirname(path));
		published = true;
	} finally {
		if (!published) await unlink(tmp).catch(() => undefined);
	}
}

function migrateState(raw: any): PlanState | undefined {
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return undefined;
	// Only v4 and v5 have defined migration semantics. Treating a future or
	// forged version as legacy would strip graph fields and silently downgrade
	// research state into ordinary work before settlement validation runs.
	if (raw.schema_version !== 4 && raw.schema_version !== 5) return undefined;
	// A persisted graph that exceeds the structural limit is corrupt, not a
	// large plan to be helpfully shortened. Slicing before validation used to
	// drop the tail on reload, allowing a later mutation or settlement to act on
	// a different graph than the one that was written (and potentially hide
	// unresolved work). Fail closed for both legacy and v5 state; callers can
	// inspect or remove the damaged private state explicitly.
	if (raw.items.length > MAX_ITEMS) return undefined;
	if (raw.schema_version === 5 && !PLAN_GRAPH) return undefined;
	if (raw.schema_version === 5) {
		// v5 state is already the graph format. Do not quietly discard a malformed
		// profile or downgrade research nodes to ordinary work during reload: that
		// would remove the profile's evidence and settlement gates.
		if (raw.profile !== undefined && raw.profile?.name !== "deep-research") return undefined;
		if (raw.profile === undefined && raw.items.some((item: any) => item && (
			item.kind === "research_branch" || item.kind === "research_leaf" ||
			item.owner_ref !== undefined || item.coverage !== undefined || item.source_leads !== undefined ||
			item.evidence_gaps !== undefined || item.lease !== undefined || item.dispatch_epoch !== undefined
		))) return undefined;
	}
	const items: PlanItem[] = raw.items.slice(0, MAX_ITEMS).map((item: any) => ({
		id: typeof item.id === "string" && /^[A-Za-z0-9._:-]{1,96}$/.test(item.id) ? item.id : itemId(),
		title: truncateBytes(cleanText(item.title), MAX_TITLE_BYTES),
		note: item.note ? truncateBytes(cleanText(item.note), MAX_NOTE_BYTES) : undefined,
		status: ["pending", "in_progress", "done", "blocked", "deferred"].includes(item.status) ? item.status : "pending",
		...(PLAN_GRAPH && raw.schema_version !== 5 ? { kind: "work" as const } : {}),
		...(raw.schema_version === 5 && typeof item.parent_id === "string" ? { parent_id: item.parent_id } : {}),
		...(raw.schema_version === 5 && ["work", "research_branch", "research_leaf"].includes(item.kind) ? { kind: item.kind } : {}),
		...(raw.schema_version === 5 && typeof item.owner_ref === "string" ? { owner_ref: item.owner_ref } : {}),
		...(raw.schema_version === 5 && item.budget ? { budget: item.budget } : {}),
		...(raw.schema_version === 5 && Array.isArray(item.evidence_gaps) ? { evidence_gaps: item.evidence_gaps.map(cleanText).filter(Boolean).slice(0, 8) } : {}),
		...(raw.schema_version === 5 && Array.isArray(item.source_leads) ? { source_leads: item.source_leads.filter((value: unknown) => typeof value === "string").slice(0, 10) } : {}),
		...(raw.schema_version === 5 && item.coverage ? { coverage: item.coverage } : {}),
		...(raw.schema_version === 5 && item.defer ? { defer: item.defer } : {}),
		...(raw.schema_version === 5 && item.lease ? { lease: item.lease } : {}),
		...(raw.schema_version === 5 && item.dispatch_epoch !== undefined ? { dispatch_epoch: item.dispatch_epoch } : {}),
	}));
	const now = isoNow();
	const state: PlanState = {
		schema_version: PLAN_GRAPH ? 5 : 4,
		run_id: typeof raw.run_id === "string" ? raw.run_id : `plan-${timestamp()}`,
		request: cleanText(raw.request || "Migrated plan").slice(0, 1000),
		summary: cleanText(raw.summary || "Migrated bounded plan.").slice(0, 300),
		autonomy: raw.autonomy === "yolo" ? "yolo" : "lean",
		phase: raw.phase === "executing" ? "executing" : "planned",
		created_at: typeof raw.created_at === "string" ? raw.created_at : now,
		updated_at: now,
		items,
		...(raw.schema_version === 5 && PLAN_GRAPH && raw.profile?.name === "deep-research" ? { profile: raw.profile } : {}),
		...(raw.schema_version === 5 && PLAN_GRAPH && typeof raw.settled_at === "string" ? { settled_at: raw.settled_at } : {}),
		writer: typeof raw.writer === "string" ? raw.writer : undefined,
	};
	if (state.schema_version === 5 && !(state.phase === "planned" && state.items.length === 0) && validateGraph(state as GraphPlanState).length) return undefined;
	return state;
}

async function readState(cwd: string): Promise<PlanState | undefined> {
	const path = statePath(cwd);
	if (!path || !(await exists(path))) return undefined;
	try { return migrateState(JSON.parse(await readFile(path, "utf8"))); }
	catch { return undefined; }
}

/**
 * Return the durable retry generation for one parent-owned research root.
 * A generation changes only when an explicit plan_update reopens a terminal
 * branch, giving the subagent runtime a safe, persisted signal with which to
 * forget an earlier in-process dispatch identity.
 */
export async function researchBranchDispatchEpoch(cwd: string, context: PlanContextV1): Promise<number | null> {
	if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id)) return null;
	const state = await readState(cwd);
	if (!state || state.schema_version !== 5 || state.run_id !== context.run_id || state.profile?.name !== "deep-research") return null;
	const item = state.items.find((candidate) => candidate.id === context.parent_item_id);
	if (!item || item.parent_id !== undefined || item.kind !== "research_branch" || item.owner_ref !== context.owner_ref) return null;
	return item.dispatch_epoch ?? 0;
}

function currentItem(state: PlanState): PlanItem | undefined {
	return state.items.find((item) => item.status === "in_progress") ?? state.items.find((item) => item.status === "pending");
}
function openItemCount(state: PlanState): number { return state.items.filter((item) => !graphTerminal(item)).length; }
function blockedItemCount(state: PlanState): number { return state.items.filter((item) => item.status === "blocked").length; }
function derivedStatus(state: PlanState): string {
	if (state.items.length === 0) return "empty";
	if (state.settled_at) return "completed";
	const requiresSettlement = state.schema_version === 5 && Boolean(state.profile || state.items.some((item) => item.parent_id));
	if (!requiresSettlement && state.items.every((item) => item.status === "done")) return "completed";
	if (state.items.every((item) => graphTerminal(item)) && state.items.some((item) => item.status === "blocked")) return "blocked";
	if (requiresSettlement && state.items.every((item) => graphTerminal(item))) return "ready for settlement";
	return state.phase === "planned" ? "planned (awaiting /plan-go)" : "executing";
}

function renderItems(state: PlanState, selectedId?: string, includeDescendants = false): string {
	const selected = selectedId ? state.items.find((item) => item.id === selectedId) : undefined;
	const subtree = new Set<string>();
	if (selected) {
		const queue = [selected.id];
		while (queue.length) {
			const id = queue.shift()!;
			if (subtree.has(id)) continue;
			subtree.add(id);
			for (const child of childrenOf(state.items, id)) queue.push(child.id);
		}
	}
	const visible = selected ? state.items.filter((item) => subtree.has(item.id)) : includeDescendants ? state.items : state.items.filter((item) => !item.parent_id);
	const selectedDepth = selected && state.schema_version === 5 ? (depthOf(state.items, selected.id) ?? 0) : 0;
	return visible.flatMap((item) => {
		const itemDepth = state.schema_version === 5 ? (depthOf(state.items, item.id) ?? 0) : 0;
		const indent = "  ".repeat(selected || includeDescendants ? Math.max(0, itemDepth - selectedDepth) : 0);
		const descendants = state.schema_version === 5 ? descendantCount(state.items, item.id) : 0;
		const gaps = item.evidence_gaps?.filter((gap) => !gap.startsWith("source:")).length ?? 0;
		const budget = item.budget ? ` budget=${item.budget.used.searches}/${item.budget.allocated.searches}s ${item.budget.used.reads}/${item.budget.allocated.reads}r` : "";
		const lease = item.lease ? " dispatch=in-flight" : "";
		const coverage = item.coverage ? ` coverage=${item.coverage.complete ? "complete" : "incomplete"}:${item.coverage.strategy}` : "";
		const graph = descendants || gaps || lease ? ` descendants=${descendants} gaps=${gaps}${budget}${lease}${coverage}` : `${budget}${coverage}`;
		const first = `${indent}${item.id}  [${item.status.replace("_", " ")}] ${item.title}`;
		if (!item.note) return [`${first}${graph}`];
		return [`${first}${graph}`, ...item.note.split("\n").filter(Boolean).map((line) => `${indent}  - ${line.replace(/^[-*]\s*/, "")}`)];
	}).join("\n");
}

function renderTodo(state: PlanState, selectedId?: string, includeDescendants = false): string {
	const lines = renderItems(state, selectedId, includeDescendants);
	return [
		"# Active Request", state.request, "", "# Status", derivedStatus(state), "",
		"# Plan Summary", state.summary || "(none)", "", selectedId ? `# Subtree ${selectedId}` : "# Todo", lines || "(none)", "",
		"# Meta", `Phase: ${state.phase}`, `Updated: ${state.updated_at}`, `Run ID: ${state.run_id}`, "",
	].join("\n");
}

function validateStateSize(state: PlanState): void {
	if (state.schema_version === 5 && !(state.phase === "planned" && state.items.length === 0)) {
		const errors = validateGraph(state as GraphPlanState);
		if (errors.length) rejectPlanTool(`plan graph rejected: ${errors.join("; ")}`);
	}
	const bytes = utf8Bytes(`${JSON.stringify(state)}\n`);
	if (bytes > MAX_PLAN_BYTES) rejectPlanTool(`plan rejected: authoritative state would be ${bytes} bytes; maximum is ${MAX_PLAN_BYTES}`);
}

function publishResearchRootContexts(state: PlanState | undefined): void {
	const shared = globalThis as Record<string, unknown>;
	if (!state?.profile || state.settled_at || state.profile.name !== "deep-research") {
		delete shared[RESEARCH_ROOT_CONTEXTS_KEY];
		return;
	}
	// The subagent extension cannot safely infer graph membership from a model-
	// supplied plan_context. Publish only the still-open root branches minted by
	// this parent plan; the child-side validator uses this bounded identity set to
	// reject forged or stale roots before starting a process.
	shared[RESEARCH_ROOT_CONTEXTS_KEY] = state.items
		.filter((item) => !item.parent_id && !graphTerminal(item) && item.kind === "research_branch" && typeof item.owner_ref === "string")
		.map((item) => `${state.run_id}:${item.id}:${item.owner_ref}`);
}

async function writeStateUnlocked(cwd: string, state: PlanState): Promise<void> {
	state.updated_at = isoNow();
	state.writer = PROC_MARK;
	validateStateSize(state);
	const path = statePath(cwd);
	if (!path) throw new Error("private plan storage is not ready; retry after session startup");
	const privateFile = usesPrivateStorage(cwd);
	await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : undefined });
	if (privateFile) await chmod(dirname(path), 0o700);
	await atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`, privateFile);
	if (privateFile) {
		const projection = privatePlanProjectionPath(cwd);
		if (!projection) throw new Error("private plan projection is not ready");
		await atomicWrite(projection, renderTodo(state), true);
	}
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id, item_id: currentItem(state)?.id, open_items: openItemCount(state), blocked_items: blockedItemCount(state),
		graph: state.schema_version === 5, profile: state.profile?.name, settled: Boolean(state.settled_at),
	};
	publishResearchRootContexts(state);
}

async function writeState(cwd: string, state: PlanState): Promise<void> {
	const path = statePath(cwd);
	if (!path) throw new Error("private plan storage is not ready; retry after session startup");
	await withPlanFileLock(path, () => writeStateUnlocked(cwd, state));
}

async function mutatePlan<T>(cwd: string, fn: (state: PlanState | undefined) => Promise<{ state?: PlanState; result: T }>): Promise<T> {
	const path = statePath(cwd);
	if (!path) throw new Error("private plan storage is not ready; retry after session startup");
	const privateFile = planStorageMode() === "capsule";
	await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : undefined });
	if (privateFile) await chmod(dirname(path), 0o700);
	return withFileMutationQueue(path, () => withPlanFileLock(path, async () => {
		const out = await fn(await readState(cwd));
		if (out.state) await writeStateUnlocked(cwd, out.state);
		return out.result;
	}));
}

export type ResearchBranchLeaseResult =
	| { ok: true; lease_id: string }
	| { ok: false; reason: "no-plan" | "wrong-plan" | "unknown-branch" | "terminal-branch" | "already-leased" | "stale-context" | "budget-exhausted" | "invalid-context" };

function sameBudget(a: ResearchBudget, b: ResearchBudget): boolean {
	return a.searches === b.searches && a.reads === b.reads;
}

/**
 * Refresh the budget in a model-visible depth-one context from the authoritative
 * graph. A context returned when a branch was first created contains the full
 * allocation; after an explicit retry only the unspent remainder is executable.
 * Returning a fresh value here prevents stale model output from multiplying the
 * global discovery envelope across retry generations.
 */
export async function researchBranchDispatchContext(cwd: string, context: PlanContextV1): Promise<PlanContextV1 | null> {
	if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id)) return null;
	const state = await readState(cwd);
	if (!state || state.schema_version !== 5 || state.run_id !== context.run_id || state.profile?.name !== "deep-research" || state.settled_at) return null;
	const item = state.items.find((candidate) => candidate.id === context.parent_item_id);
	if (!item || item.parent_id !== undefined || item.kind !== "research_branch" || item.owner_ref !== context.owner_ref || graphTerminal(item) || !item.budget) return null;
	const remaining = {
		searches: Math.max(0, item.budget.allocated.searches - item.budget.used.searches),
		reads: Math.max(0, item.budget.allocated.reads - item.budget.used.reads),
	};
	const next = { ...context, budget: remaining, dispatch_epoch: item.dispatch_epoch ?? 0 };
	// A context is reusable as a branch identity, but a lease is single-use. Do
	// not let a model replay a context carrying an old credential into a new
	// dispatch generation.
	delete next.lease_id;
	return next;
}

/**
 * Acquire the parent-owned durable lease immediately before starting a root
 * research child. The graph file is the authority, so a new parent process
 * cannot forget an in-flight branch just because its module globals were reset.
 */
export async function acquireResearchBranchLease(cwd: string, context: PlanContextV1): Promise<ResearchBranchLeaseResult> {
	if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id)) return { ok: false, reason: "invalid-context" };
	return mutatePlan<ResearchBranchLeaseResult>(cwd, async (previous) => {
		if (!previous) return { result: { ok: false, reason: "no-plan" } };
		if (previous.schema_version !== 5 || previous.run_id !== context.run_id || previous.profile?.name !== "deep-research" || previous.settled_at) {
			return { result: { ok: false, reason: "wrong-plan" } };
		}
		const parent = previous.items.find((item) => item.id === context.parent_item_id);
		if (!parent || parent.parent_id !== undefined || parent.kind !== "research_branch" || parent.owner_ref !== context.owner_ref) {
			return { result: { ok: false, reason: "unknown-branch" } };
		}
		if (graphTerminal(parent)) return { result: { ok: false, reason: "terminal-branch" } };
		if (parent.lease) return { result: { ok: false, reason: "already-leased" } };
		if (!parent.budget) return { result: { ok: false, reason: "wrong-plan" } };
		if (context.dispatch_epoch !== undefined && context.dispatch_epoch !== (parent.dispatch_epoch ?? 0)) {
			return { result: { ok: false, reason: "stale-context" } };
		}
		const remaining = {
			searches: Math.max(0, parent.budget.allocated.searches - parent.budget.used.searches),
			reads: Math.max(0, parent.budget.allocated.reads - parent.budget.used.reads),
		};
		if (!sameBudget(context.budget, remaining)) return { result: { ok: false, reason: "stale-context" } };
		if (remaining.searches === 0 && remaining.reads === 0) return { result: { ok: false, reason: "budget-exhausted" } };
		const lease: ResearchBranchLease = { lease_id: randomUUID(), issued_at: isoNow(), owner_ref: context.owner_ref };
		const state: PlanState = { ...previous, items: previous.items.map((item) => item.id === parent.id ? { ...item, lease } : item) };
		return { state, result: { ok: true, lease_id: lease.lease_id } };
	});
}

/** Release only the exact lease acquired for this branch. Used when a multi-arm
 * dispatch cannot acquire all of its leases before any child is launched. */
export async function releaseResearchBranchLease(cwd: string, context: PlanContextV1, leaseId: string): Promise<boolean> {
	if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id)) return false;
	return mutatePlan<boolean>(cwd, async (previous) => {
		if (!previous || previous.schema_version !== 5 || previous.run_id !== context.run_id) return { result: false };
		const parent = previous.items.find((item) => item.id === context.parent_item_id);
		if (!parent?.lease || parent.owner_ref !== context.owner_ref || parent.lease.lease_id !== leaseId) return { result: false };
		const items = previous.items.map((item) => {
			if (item.id !== parent.id) return item;
			const next = { ...item };
			delete next.lease;
			return next;
		});
		return { state: { ...previous, items }, result: true };
	});
}

function rejectPlanTool(text: string): never { throw new Error(text); }

function coverageNeedsFailureReason(value: unknown): boolean {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const coverage = value as Record<string, unknown>;
	return coverage.complete === false && coverage.truncated !== true && coverage.budget_exhausted !== true && coverage.failed !== true;
}

function explainCoverageInvariant(report: BranchReportV1, terminal = false): string | null {
	const terminalStatuses = new Set(["done", "blocked", "deferred"]);
	if (terminal && !report.coverage) return "top-level coverage receipt";
	if (coverageNeedsFailureReason(report.coverage)) return "top-level coverage";
	for (const child of report.children) {
		if (terminal && terminalStatuses.has(child.status) && !child.coverage) return `terminal child ${child.item_id} coverage receipt`;
		if (coverageNeedsFailureReason(child.coverage)) return `child ${child.item_id} coverage`;
	}
	return null;
}

function validateIncoming(items: Array<{ item_id?: string; title: string; note?: string }>): void {
	if (items.length < 1 || items.length > MAX_ITEMS) rejectPlanTool(`plan_write rejected: provide 1-${MAX_ITEMS} top-level items`);
	const ids = new Set<string>();
	for (const [index, item] of items.entries()) {
		const title = cleanText(item.title);
		const note = item.note === undefined ? undefined : cleanText(item.note);
		if (!title) rejectPlanTool(`plan_write rejected: item ${index + 1} has an empty title`);
		if (utf8Bytes(title) > MAX_TITLE_BYTES) rejectPlanTool(`plan_write rejected: item ${index + 1} title exceeds ${MAX_TITLE_BYTES} UTF-8 bytes`);
		if (note !== undefined && utf8Bytes(note) > MAX_NOTE_BYTES) rejectPlanTool(`plan_write rejected: item ${index + 1} note exceeds ${MAX_NOTE_BYTES} UTF-8 bytes`);
		if (item.item_id !== undefined) {
			if (!/^[A-Za-z0-9._:-]{1,96}$/.test(item.item_id)) rejectPlanTool(`plan_write rejected: item ${index + 1} has an invalid item_id`);
			if (ids.has(item.item_id)) rejectPlanTool(`plan_write rejected: duplicate item_id ${item.item_id}`);
			ids.add(item.item_id);
		}
	}
}

function structuralItems(previous: PlanState | undefined, incoming: Array<{ item_id?: string; title: string; note?: string }>): PlanItem[] {
	validateIncoming(incoming);
	const byId = new Map((previous?.items ?? []).map((item) => [item.id, item]));
	const retained = new Set<string>();
	const next = incoming.map((item) => {
		const prior = item.item_id ? byId.get(item.item_id) : undefined;
		if (item.item_id && !prior) rejectPlanTool(`plan_write rejected: unknown item_id ${item.item_id}. Valid ids: ${[...byId.keys()].join(", ") || "(none)"}`);
		if (prior) retained.add(prior.id);
		return {
			id: prior?.id ?? itemId(), title: cleanText(item.title),
			note: item.note === undefined ? prior?.note : (cleanText(item.note) || undefined),
			status: prior?.status ?? "pending",
		} satisfies PlanItem;
	});
	// Unresolved work may not silently disappear from an EXECUTING plan. During
	// pre-go review (phase "planned") a structural rewrite that drops items is
	// legitimate revision — and the old unconditional rule was a trap there: the
	// rejection named plan_update, which planning mode blocks (audit A4, 2026-08-25).
	const omitted = previous?.phase === "executing" ? previous.items.filter((item) =>
		(item.status === "pending" || item.status === "in_progress") && !retained.has(item.id)) : [];
	if (omitted.length) rejectPlanTool(`plan_write rejected: unresolved item_id(s) omitted: ${omitted.map((item) => item.id).join(", ")}. Mark them done or blocked with plan_update first, or retain them (with their item_id) in the revised items.`);
	return next;
}

function isPlanning(): boolean { return (globalThis as Record<string, unknown>)[PLAN_FLAG] === true; }
function setPlanning(value: boolean): void {
	if (value) (globalThis as Record<string, unknown>)[PLAN_FLAG] = true;
	else delete (globalThis as Record<string, unknown>)[PLAN_FLAG];
}

function enterPlanningSurface(pi: ExtensionAPI): boolean {
	const active = pi.getActiveTools();
	const all = pi.getAllTools().map((tool) => tool.name);
	const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
	const next = explicit ? active.filter((name) => SAFE_PLAN_TOOLS.has(name)) : all.filter((name) => SAFE_PLAN_TOOLS.has(name));
	if (!next.includes("plan_write")) return false;
	planningSurfaceBefore = [...active];
	planningSurfaceApplied = [...next];
	pi.setActiveTools(next);
	return true;
}

function leavePlanningSurface(pi: ExtensionAPI, keepPlanTools: boolean): void {
	const active = pi.getActiveTools();
	if (!planningSurfaceApplied || !planningSurfaceBefore) {
		// Post-restart: the in-memory bookkeeping is gone, so the diff-based restore
		// below has nothing to work with — a reload during /plan used to leave the
		// session read-only forever (audit A6, 2026-08-25). Restore the execution
		// surface from the immutable startup baseline, filtered through the core
		// profile so deferred specialists stay deferred.
		const baseline = initialToolSurface();
		if (baseline?.complete) {
			const registered = new Set(pi.getAllTools().map((tool) => tool.name));
			const coreProfile = profileFromEnvironment() === "core";
			const restored = new Set(active);
			for (const name of baseline.active) {
				if (!registered.has(name)) continue;
				if (coreProfile && !CORE_NAMES.has(name)) continue;
				restored.add(name);
			}
			if (keepPlanTools) for (const name of ["plan_write", "plan_update"]) if (registered.has(name)) restored.add(name);
			pi.setActiveTools([...restored]);
		}
		planningSurfaceBefore = null;
		planningSurfaceApplied = null;
		return;
	}
	if (planningSurfaceApplied && planningSurfaceBefore) {
		const applied = new Set(planningSurfaceApplied);
		const current = new Set(active);
		const manuallyRemoved = new Set(planningSurfaceApplied.filter((name) => !current.has(name)));
		const activatedDuringPlan = active.filter((name) => !applied.has(name));
		const restored = planningSurfaceBefore.filter((name) => !manuallyRemoved.has(name));
		for (const name of activatedDuringPlan) if (!restored.includes(name)) restored.push(name);
		if (keepPlanTools) {
			for (const name of ["plan_write", "plan_update"]) {
				if (!manuallyRemoved.has(name) && pi.getAllTools().some((tool) => tool.name === name) && !restored.includes(name)) restored.push(name);
			}
		}
		pi.setActiveTools(restored);
	}
	planningSurfaceBefore = null;
	planningSurfaceApplied = null;
}

function planPrompt(request: string): string {
	return `MODE: PLAN\nREQUEST:\n${request}\n\nInvestigate with the read-only tools. Then call plan_write once. Use 1-${MAX_ITEMS} short top-level items. Put compact substeps in note, not extra items. Stop after plan_write. The user reviews the plan and starts execution; do not act until then.`;
}

function executionPrompt(state: PlanState): string {
	const open = state.items.filter((item) => item.status === "pending" || item.status === "in_progress")
		.map((item) => `${item.id} [${item.status}] ${item.title}${item.note ? `\n  ${item.note.replace(/\n/g, "\n  ")}` : ""}`)
		.join("\n");
	return `MODE: RUN\nREQUEST: ${state.request}\nOPEN ITEMS:\n${open || "(none)"}\n\nUse plan_update for status or notes; do not replay the full plan for routine progress. Keep at most one item in_progress. Verify the project once after the latest source mutation before final handoff.`;
}

const planWrite = defineTool({
	name: "plan_write", label: "Write Plan Structure",
	description: `Create or structurally revise a bounded ordered plan of at most ${MAX_ITEMS} top-level items. Status belongs to plan_update.`,
	promptSnippet: "plan_write: create or structurally revise the bounded plan",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Use short top-level items. Put compact substeps in note instead of multiplying items.",
		"Retain item_id when revising an existing item; use plan_update for status changes.",
	] : undefined,
	parameters: Type.Object({
		summary: Type.Optional(Type.String({ maxLength: PLAN_DEFER_FIELD_MAX_BYTES })),
		items: Type.Array(Type.Object({
			item_id: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
			title: Type.String({ minLength: 1, maxLength: PLAN_TITLE_MAX_BYTES }), note: Type.Optional(Type.String({ maxLength: PLAN_NOTE_MAX_BYTES })),
		}), { minItems: 1, maxItems: MAX_ITEMS }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		rejectChildPlanMutation();
		rememberModel(ctx);
		const result = await mutatePlan(ctx.cwd, async (previous) => {
			// No headless reject: pi only dispatches ACTIVE tools, and outside /plan the
			// tool is active only via capability(enable, "planning") — the sanctioned
			// model route (skills structure multi-item work this way). The old
			// unconditional reject named /plan, a command the model cannot type, and
			// made the capability family a dead end (audit A3, 2026-08-25).
			if (previous?.settled_at) rejectPlanTool("plan_write rejected: settled plans are immutable");
			if (previous?.profile || previous?.items.some((item) => item.parent_id)) rejectPlanTool("plan_write cannot rewrite a plan graph; use plan_expand and plan_update");
			const items = structuralItems(previous, params.items);
			if (PLAN_GRAPH && (!previous || previous.schema_version === 5)) for (const item of items) item.kind ??= "work";
			const now = isoNow();
			const state: PlanState = previous ? {
				...previous, summary: params.summary === undefined ? previous.summary : cleanText(params.summary), items,
			} : {
				schema_version: PLAN_GRAPH ? 5 : 4, run_id: `plan-${timestamp()}`, request: "Headless plan", summary: cleanText(params.summary),
				autonomy: "lean", phase: isPlanning() ? "planned" : "executing", created_at: now, updated_at: now, items,
			};
			validateStateSize(state);
			return { state, result: state };
		});
		planEvent("write", result.run_id, { items: result.items.length, open_items: openItemCount(result), rewrite: true });
		const listing = result.items.map((item) => `${item.id} ${item.title}`).join("\n");
		return { content: [{ type: "text" as const, text: `Plan saved (${result.items.length}/${MAX_ITEMS} items).\n${listing}\n${isPlanning() ? "Stop now. The user reviews the plan and starts execution." : "Use plan_update for progress."}` }], details: { tool_name: "plan_write", success: true } };
	},
});

const PlanUpdateStatusSchema = PLAN_GRAPH
	? Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked"), Type.Literal("deferred")])
	: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked")]);

const planUpdate = defineTool({
	name: "plan_update", label: "Update Plan Progress",
	description: "Update status or note for existing plan item IDs. Cannot change structure.",
	promptSnippet: "plan_update: apply small stable-ID status/note deltas",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Send only changed item IDs. Do not replay the full plan for routine progress.",
		"Keep at most one item in_progress; a blocked item needs a short reason in note.",
	] : undefined,
	parameters: Type.Object({ deltas: Type.Array(Type.Object({
		item_id: Type.String({ minLength: 1, maxLength: 96 }),
		status: Type.Optional(PlanUpdateStatusSchema),
		note: Type.Optional(Type.String({ maxLength: PLAN_NOTE_MAX_BYTES })),
		...(PLAN_GRAPH ? { defer: Type.Optional(Type.Object({
			value: Type.String({ minLength: 1, maxLength: 200 }),
			risk: Type.String({ minLength: 1, maxLength: 200 }),
			rationale: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }),
		})) } : {}),
	}), { minItems: 1, maxItems: MAX_DELTAS }) }),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		rejectChildPlanMutation();
		rememberModel(ctx);
		const outcome = await mutatePlan(ctx.cwd, async (previous) => {
			// Not "/plan": that is a slash command only a HUMAN can type, so naming it
			// here left the model with no legal next move and it retried until the
			// outcome ladder escalated. plan_write is callable headlessly (audit A3), so
			// it is the remedy that actually exists for the caller being spoken to.
			if (!previous) rejectPlanTool("plan_update rejected: no plan exists yet. Call plan_write first to create one, then plan_update for status changes.");
			if (previous.settled_at) rejectPlanTool("plan_update rejected: settled plans are immutable");
			const applied = applyPlanDeltas(previous.items, params.deltas as PlanDelta[]);
			if (!applied.ok) rejectPlanTool(`plan_update rejected: ${applied.errors.join("; ")}`);
			// A user-authorized terminal transition is also an explicit cancellation of
			// any in-flight delegated work for that item. Clear its durable lease so the
			// child result becomes a harmless late arrival instead of making cancellation
			// impossible or leaving a permanently leased branch.
			const state = { ...previous, items: (applied.items as PlanItem[]).map((item) => {
				const prior = previous.items.find((candidate) => candidate.id === item.id);
				const reopened = Boolean(previous.profile?.name === "deep-research" && prior && item.kind === "research_branch" && graphTerminal(prior) && !graphTerminal(item));
				if (reopened) {
					const nextEpoch = (prior!.dispatch_epoch ?? 0) + 1;
					if (nextEpoch > 1_000_000) rejectPlanTool(`plan_update rejected: dispatch retry limit reached for ${item.id}`);
					// A reopened research branch must earn a fresh terminal report. Keep
					// cumulative budget usage for conservation, but discard the prior
					// attempt's coverage, delegated source leads, gaps, and deferral so
					// a manual status flip cannot settle the head on stale evidence.
					const next = { ...item, dispatch_epoch: nextEpoch };
					delete next.coverage;
					delete next.source_leads;
					delete next.evidence_gaps;
					delete next.defer;
					return next;
				}
				if (!item.lease || !graphTerminal(item)) return item;
				const next = { ...item };
				delete next.lease;
				return next;
			}) };
			validateStateSize(state);
			return { state, result: { state, changed: applied.changed, idempotent: applied.idempotent } };
		});
		planEvent("delta", outcome.state.run_id, { changed: outcome.changed, idempotent: outcome.idempotent, open_items: openItemCount(outcome.state) });
		return { content: [{ type: "text" as const, text: `Plan updated: ${outcome.changed} changed, ${outcome.idempotent} already current, ${openItemCount(outcome.state)} open.` }], details: { tool_name: "plan_update", success: true } };
	},
});

const GoalCriterionSchema = Type.Object({
	id: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
	text: Type.String({ minLength: 1, maxLength: GOAL_MODEL_TEXT_MAX_BYTES }),
	required: Type.Optional(Type.Boolean()),
});

const goalPropose = defineTool({
	name: "goal_propose", label: "Propose Goal", description: "Propose a persistent project/worktree goal for user acceptance. Proposal is advisory and does not activate execution.",
	promptSnippet: "goal_propose: suggest a persistent goal; the user must accept it before activation",
	parameters: Type.Object({
		objective: Type.String({ minLength: 1, maxLength: GOAL_MODEL_TEXT_MAX_BYTES }),
		constraints: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 16 })),
		criteria: Type.Optional(Type.Array(GoalCriterionSchema, { minItems: 1, maxItems: GOAL_MAX_CRITERIA })),
		note: Type.Optional(Type.String({ maxLength: 500 })),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildGoalMutation();
		const result = await mutateGoal(ctx.cwd, async (previous) => {
			if (previous && !["complete", "cancelled"].includes(previous.status)) throw new Error("goal_propose rejected: an active or pending goal already exists");
			const goal = createGoal({ cwd: ctx.cwd, objective: params.objective, constraints: params.constraints, criteria: params.criteria, scope: goalScope(), status: "proposed", proposal: { source: "skill", note: params.note ?? "Skill-proposed goal." } });
			return { goal, result: goal };
		});
		publishGoal(result);
		emitGoalState(api!, result);
		goalEvent("proposed", result);
		return { content: [{ type: "text" as const, text: `Goal proposed (${result.goal_id}). It is not active yet; ask the user to accept it with /goal-accept.` }], details: { tool_name: "goal_propose", success: true, status: result.status } };
	},
});

const goalUpdate = defineTool({
	name: "goal_update", label: "Update Goal", description: "Record evidence and criterion progress against the active persistent goal.",
	promptSnippet: "goal_update: record criterion evidence and residual risk without settling the goal",
	parameters: Type.Object({
		criteria: Type.Optional(Type.Array(Type.Object({ id: Type.String({ minLength: 1, maxLength: 64 }), status: Type.Union([Type.Literal("open"), Type.Literal("met"), Type.Literal("deferred")]), evidence: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 16 })) }), { maxItems: GOAL_MAX_CRITERIA })),
		progress_evidence: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 16 })),
		residual_risks: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 16 })),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildGoalMutation();
		const result = await mutateGoal(ctx.cwd, async (previous) => {
			if (!previous) throw new Error("goal_update rejected: no active goal");
			const goal = updateGoal(previous, { criteria: params.criteria as Array<{ id: string; status: CriterionStatus; evidence?: string[] }> | undefined, progressEvidence: params.progress_evidence, residualRisks: params.residual_risks });
			return { goal, result: goal };
		});
		publishGoal(result);
		emitGoalState(api!, result);
		goalEvent("updated", result);
		return { content: [{ type: "text" as const, text: `Goal updated (${result.criteria.filter((criterion) => criterion.status === "met").length}/${result.criteria.length} criteria met).` }], details: { tool_name: "goal_update", success: true } };
	},
});

const goalSettle = defineTool({
	name: "goal_settle", label: "Settle Goal", description: "Settle a persistent goal as complete or evidence-backed 80/20 accepted. Required criteria and safety obligations cannot be waived.",
	promptSnippet: "goal_settle: close a goal with evidence, delivered value, confidence, risks, and deferrals",
	parameters: Type.Object({
		outcome: Type.Union([Type.Literal("complete"), Type.Literal("accepted_80_20")]),
		delivered_value: Type.String({ minLength: 1, maxLength: GOAL_MODEL_TEXT_MAX_BYTES }),
		confidence: Type.Number({ minimum: 0, maximum: 1 }),
		residual_risks: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 16 }),
		deferred: Type.Optional(Type.Array(Type.Object({ value: Type.String({ minLength: 1, maxLength: 500 }), risk: Type.String({ minLength: 1, maxLength: 500 }), rationale: Type.String({ minLength: 1, maxLength: GOAL_MODEL_TEXT_MAX_BYTES }) }), { maxItems: 16 })),
		evidence: Type.Array(Type.String({ maxLength: 500 }), { minItems: 1, maxItems: 16 }),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildGoalMutation();
		const result = await mutateGoal(ctx.cwd, async (previous) => {
			if (!previous) throw new Error("goal_settle rejected: no active goal");
			const goal = settleGoal(previous, { outcome: params.outcome, deliveredValue: params.delivered_value, confidence: params.confidence, residualRisks: params.residual_risks, deferred: params.deferred as DeferredGoalItem[] | undefined, evidence: params.evidence });
			return { goal, result: goal };
		});
		publishGoal(result);
		emitGoalState(api!, result);
		goalEvent("settled", result, { outcome: result.status, deferred: result.deferred.length });
		return { content: [{ type: "text" as const, text: `Goal ${result.status}. Planner execution may stop; the goal remains resumable with /goal-resume unless it is complete.` }], details: { tool_name: "goal_settle", success: true, outcome: result.status } };
	},
});

const goalBlock = defineTool({
	name: "goal_block", label: "Block Goal", description: "Stop an active goal honestly when a bounded external condition prevents progress. Only the user can resume it.",
	promptSnippet: "goal_block: record the reason, evidence, and exact unblock condition; do not continue execution",
	parameters: Type.Object({
		reason: Type.String({ minLength: 1, maxLength: 500 }),
		evidence: Type.Array(Type.String({ maxLength: 500 }), { minItems: 1, maxItems: 16 }),
		unblock_condition: Type.String({ minLength: 1, maxLength: 500 }),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildGoalMutation();
		const result = await mutateGoal(ctx.cwd, async (previous) => {
			if (!previous || previous.status !== "active") throw new Error("goal_block rejected: no active goal exists");
			const goal = blockGoal(previous, { reason: params.reason, evidence: params.evidence, unblockCondition: params.unblock_condition });
			return { goal, result: goal };
		});
		publishGoal(result);
		emitGoalState(api!, result);
		goalEvent("blocked", result);
		return { content: [{ type: "text" as const, text: `Goal blocked (${result.goal_id}). Only the user may resume it with /goal-resume.` }], details: { tool_name: "goal_block", success: true } };
	},
});

const goalInspect = defineTool({
	name: "goal_inspect", label: "Inspect Goal", description: "Read one bounded page of the active goal contract without mutating it.",
	promptSnippet: "goal_inspect: retrieve omitted active-goal criteria, constraints, evidence, risks, or deferrals with stable cursors",
	parameters: Type.Object({
		section: Type.Optional(Type.Union([Type.Literal("all"), Type.Literal("criteria"), Type.Literal("constraints"), Type.Literal("evidence"), Type.Literal("risks"), Type.Literal("deferred")])),
		cursor: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		const goal = await readExecutableGoal(ctx.cwd);
		if (!goal) throw new Error("goal_inspect rejected: no active goal");
		const page = inspectGoal(goal, (params.section ?? "all") as GoalInspectSection, params.cursor);
		return { content: [{ type: "text" as const, text: JSON.stringify(page) }], details: { tool_name: "goal_inspect", success: true, has_more: page.next_cursor !== null } };
	},
});

const BudgetSchema = Type.Object({
	searches: Type.Integer({ minimum: 0, maximum: 100 }),
	reads: Type.Integer({ minimum: 0, maximum: 100 }),
});

const CoverageSchema = Type.Object({
	strategy: Type.Union([Type.Literal("direct"), Type.Literal("structural"), Type.Literal("hybrid")]),
	scope: Type.Union([Type.Literal("bounded"), Type.Literal("exhaustive")]),
	returned_count: Type.Integer({ minimum: 0, maximum: 100_000 }),
	total_count: Type.Optional(Type.Integer({ minimum: 0, maximum: 100_000 })),
	truncated: Type.Boolean(), budget_exhausted: Type.Boolean(), failed: Type.Boolean(), complete: Type.Boolean(),
});

function activateGraphTools(): void {
	if (!api || !PLAN_GRAPH) return;
	const active = api.getActiveTools();
	for (const name of ["plan_write", "plan_update", "plan_expand", "plan_settle"]) {
		if (api.getAllTools().some((tool) => tool.name === name) && !active.includes(name)) active.push(name);
	}
	api.setActiveTools(active);
}

const researchPlanStart = defineTool({
	name: "research_plan_start", label: "Start Deep Research Plan",
	description: "Start a headless, executing deep-research plan graph for a complex research request. Straightforward fact lookups should not use this tool.",
	promptSnippet: "research_plan_start: create up to three evidence branches under one global discovery budget",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Use only for contested, comparative, multi-part, or delegated research. Allocate at most 3 searches and 5 reads across all branches.",
		"Copy the returned plan_context exactly into the matching research-planner subagent call.",
	] : undefined,
	parameters: Type.Object({
		request: Type.String({ minLength: 1, maxLength: 1_000 }),
		summary: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }),
		branches: Type.Array(Type.Object({
			title: Type.String({ minLength: 1, maxLength: PLAN_TITLE_MAX_BYTES }),
			note: Type.Optional(Type.String({ maxLength: PLAN_NOTE_MAX_BYTES })),
			budget: BudgetSchema,
		}), { minItems: 1, maxItems: DEEP_RESEARCH_MAX_ROOTS }),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildPlanMutation();
		rememberModel(ctx);
		lastSessionCwd = ctx.cwd;
		if (process.env.RESEARCH_LEDGER !== "on") rejectPlanTool("research_plan_start is unavailable: this session cannot parent-verify delegated sources. Research directly and cite inline instead.");
		const state = await mutatePlan(ctx.cwd, async (previous) => {
			const unsettledGraph = previous && !previous.settled_at && Boolean(previous.profile || previous.items.some((item) => item.parent_id));
			if (previous && !previous.settled_at && (openItemCount(previous) > 0 || unsettledGraph)) rejectPlanTool("an active or unsettled graph plan already exists");
			const requestedBudget = params.branches.reduce((total, branch) => ({
				searches: total.searches + branch.budget.searches,
				reads: total.reads + branch.budget.reads,
			}), { searches: 0, reads: 0 });
			if (requestedBudget.searches > DEEP_RESEARCH_DISCOVERY_BUDGET.searches || requestedBudget.reads > DEEP_RESEARCH_DISCOVERY_BUDGET.reads) {
				rejectPlanTool(`research_plan_start rejected: root allocations must fit the global discovery envelope (at most ${DEEP_RESEARCH_DISCOVERY_BUDGET.searches} searches and ${DEEP_RESEARCH_DISCOVERY_BUDGET.reads} reads total; requested ${requestedBudget.searches} searches and ${requestedBudget.reads} reads)`);
			}
			const now = isoNow();
			const runId = `research-plan-${timestamp()}`;
			const items: PlanItem[] = params.branches.map((branch) => {
				const id = itemId();
				return {
					id, title: cleanText(branch.title), note: cleanText(branch.note) || undefined,
					status: "pending", kind: "research_branch", owner_ref: ownerRef(runId, id),
					budget: { allocated: branch.budget as ResearchBudget, used: { searches: 0, reads: 0 } },
					dispatch_epoch: 0,
				};
			});
			const next: PlanState = {
				schema_version: 5, run_id: runId, request: cleanText(params.request), summary: cleanText(params.summary),
				autonomy: "lean", phase: "executing", created_at: now, updated_at: now, items,
				profile: { name: "deep-research", max_depth: 2, max_children: 2, discovery_budget: DEEP_RESEARCH_DISCOVERY_BUDGET, validation_reads: 5 },
			};
			validateStateSize(next);
			return { state: next, result: next };
		});
		(globalThis as Record<string, unknown>).__pi_plan_validation_urls = [];
		delete (globalThis as Record<string, unknown>)[RESEARCH_COVERAGE_KEY];
		activateGraphTools();
		// Starting the graph is also the parent skill's request to execute it. In
		// the core profile research and delegation are deferred independently from
		// the planning family, so exposing only the graph tools would leave the
		// parent with a plan it cannot search or delegate. Route both requests
		// through the existing capability activation boundary; it still respects
		// explicit tool selections and the one-attempt/manual-disable latch.
		if (api) {
			emitHarnessSignal(api.events, { v: 1, type: "capability/need", capability: "web_read", reason: "deep-research" });
			emitHarnessSignal(api.events, { v: 1, type: "capability/need", capability: "subagent", reason: "deep-research" });
		}
		planEvent("research-start", state.run_id, { items: state.items.length, open_items: openItemCount(state) });
		const contexts = state.items.map((item) => ({
			v: 1, profile: "deep-research", run_id: state.run_id, parent_item_id: item.id, owner_ref: item.owner_ref,
			depth: 1, budget: item.budget!.allocated, dispatch_epoch: item.dispatch_epoch ?? 0,
			limits: { max_depth: DEEP_RESEARCH_MAX_DEPTH, max_children: DEEP_RESEARCH_MAX_CHILDREN },
		}));
		return { content: [{ type: "text" as const, text: `Deep-research plan started (${state.items.length} branches). Pass the matching plan_context unchanged to each research-planner subagent.\n${JSON.stringify(contexts)}` }], details: { tool_name: "research_plan_start", success: true, contexts } };
	},
});

const planExpand = defineTool({
	name: "plan_expand", label: "Expand Plan Branch",
	description: "Attach bounded child nodes to one existing plan node without rewriting the rest of the graph.",
	promptSnippet: "plan_expand: add bounded children beneath a stable parent item ID",
	parameters: Type.Object({
		parent_item_id: Type.String({ minLength: 1, maxLength: 96 }),
		children: Type.Array(Type.Object({
			item_id: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
			title: Type.String({ minLength: 1, maxLength: PLAN_TITLE_MAX_BYTES }), note: Type.Optional(Type.String({ maxLength: PLAN_NOTE_MAX_BYTES })),
			budget: Type.Optional(BudgetSchema),
		}), { minItems: 1, maxItems: 8 }),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildPlanMutation();
		const state = await mutatePlan(ctx.cwd, async (previous) => {
			if (!previous || previous.schema_version !== 5) rejectPlanTool("plan_expand requires an active graph plan");
			if (previous.settled_at) rejectPlanTool("plan_expand rejected: settled plans are immutable");
			const next = expandGraph(previous as GraphPlanState, params.parent_item_id, params.children as BranchChildInput[]);
			return { state: next, result: next };
		});
		planEvent("expand", state.run_id, { parent_item_id: params.parent_item_id, children: params.children.length, open_items: openItemCount(state) });
		return { content: [{ type: "text" as const, text: `Plan branch expanded: ${params.parent_item_id} now has ${childrenOf(state.items, params.parent_item_id).length} child node(s).` }], details: { tool_name: "plan_expand", success: true } };
	},
});

const planSettle = defineTool({
	name: "plan_settle", label: "Settle Plan",
	description: "Request terminal settlement after required nodes and parent-owned evidence verification are complete.",
	promptSnippet: "plan_settle: close a verified graph plan; the head agent alone may call this",
	parameters: Type.Object({ summary: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }) }),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildPlanMutation();
		const state = await mutatePlan(ctx.cwd, async (previous) => {
			if (!previous || previous.schema_version !== 5) rejectPlanTool("plan_settle requires an active graph plan");
			if (previous.settled_at) rejectPlanTool("plan_settle rejected: plan is already settled and immutable");
			const verifiedRaw = (globalThis as Record<string, unknown>).__pi_plan_validation_urls;
			const verified = new Set(Array.isArray(verifiedRaw) ? verifiedRaw.filter((value): value is string => typeof value === "string") : []);
			const errors = settleErrors(previous as GraphPlanState, verified);
			if (errors.length) rejectPlanTool(`plan_settle rejected: ${errors.join("; ")}`);
			const next = { ...previous, summary: cleanText(params.summary), settled_at: isoNow() };
			return { state: next, result: next };
		});
		const active = api?.getActiveTools() ?? [];
		api?.setActiveTools(active.filter((name) => !["plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start"].includes(name)));
		planEvent("settled", state.run_id, { items: state.items.length, deferred: state.items.filter((item) => item.status === "deferred").length });
		return { content: [{ type: "text" as const, text: "Plan settled. Planner guidance and task-scoped plan tools are no longer active." }], details: { tool_name: "plan_settle", success: true } };
	},
});

const branchPlan = defineTool({
	name: "branch_plan", label: "Write Research Branch Report",
	description: "Create or update the bounded branch report supplied by the parent plan. This never writes the parent plan.",
	promptSnippet: "branch_plan: record a bounded child plan/report inside the delegated branch",
	parameters: Type.Object({
		status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked"), Type.Literal("deferred")]),
		note: Type.String({ minLength: 1, maxLength: 500 }), consumed: BudgetSchema,
		children: Type.Array(Type.Object({
			item_id: Type.String({ minLength: 1, maxLength: 96 }), title: Type.String({ minLength: 1, maxLength: PLAN_TITLE_MAX_BYTES }),
			note: Type.Optional(Type.String({ maxLength: PLAN_NOTE_MAX_BYTES })),
			status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked"), Type.Literal("deferred")]),
			budget: Type.Object({ allocated: BudgetSchema, used: BudgetSchema }),
			evidence_gaps: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }), { maxItems: 8 })),
			coverage: Type.Optional(CoverageSchema),
			defer: Type.Optional(Type.Object({ value: Type.String({ minLength: 1, maxLength: 200 }), risk: Type.String({ minLength: 1, maxLength: 200 }), rationale: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }) })),
		}), { maxItems: DEEP_RESEARCH_MAX_CHILDREN }),
		source_leads: Type.Array(Type.Object({ url: Type.String({ minLength: 1, maxLength: 1_999 }), claim: Type.String({ minLength: 1, maxLength: 500 }), quote: Type.String({ minLength: 1, maxLength: 800 }) }), { maxItems: 10 }),
		evidence_gaps: Type.Array(Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }), { maxItems: 8 }),
		coverage: Type.Optional(CoverageSchema),
		defer: Type.Optional(Type.Object({ value: Type.String({ minLength: 1, maxLength: 200 }), risk: Type.String({ minLength: 1, maxLength: 200 }), rationale: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }) })),
	}),
	async execute(_id, params) {
		const context = await readPlanContext(process.env[PLAN_CONTEXT_ENV]);
		const reportPath = process.env[BRANCH_REPORT_ENV];
		if (!context || !reportPath) rejectPlanTool("branch_plan rejected: no valid parent plan context");
		const report: BranchReportV1 = { v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, ...params } as BranchReportV1;
		const terminal = ["done", "blocked", "deferred"].includes(report.status);
		const invalidCoverage = explainCoverageInvariant(report, terminal);
		const attemptKey = `${context.run_id}:${context.owner_ref}`;
		if (invalidCoverage) {
			const attempt = (invalidCoverageAttempts.get(attemptKey) ?? 0) + 1;
			invalidCoverageAttempts.set(attemptKey, attempt);
			if (attempt <= INVALID_COVERAGE_RETRY_LIMIT) {
				const guidance = invalidCoverage.endsWith("coverage receipt")
					? `${invalidCoverage} is required for every terminal branch and child; include strategy, scope, returned_count, truncated, budget_exhausted, failed, and complete`
					: `${invalidCoverage} is incomplete but has no failure reason; set truncated, budget_exhausted, or failed=true (and keep complete=false), or use complete=true for clean bounded coverage`;
				rejectPlanTool(`branch_plan rejected: ${guidance}`);
			}

			// A second malformed report is a branch-local protocol failure. Fail closed
			// with a valid terminal report so an unhelpful model cannot keep the parent
			// graph open indefinitely. No child claims, sources, or usage are accepted.
			const blockedReport: BranchReportV1 = {
				v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "blocked",
				note: `Blocked after repeated invalid ${invalidCoverage} reports; no evidence accepted.`,
				// The report protocol itself is no longer trustworthy after the
				// corrective retry. Conservatively consume this attempt's entire
				// allocated remainder so an explicit reopen cannot regain an envelope
				// whose actual tool usage we could not validate.
				consumed: context.budget, children: [], source_leads: [],
				evidence_gaps: ["invalid coverage report rejected after one corrective retry"],
				coverage: { strategy: "direct", scope: "bounded", returned_count: 0, truncated: false, budget_exhausted: false, failed: true, complete: false },
			};
			await writeBranchReport(reportPath, blockedReport, context);
			invalidCoverageAttempts.delete(attemptKey);
			const shared = globalThis as Record<string, unknown>;
			shared[RESEARCH_RESERVED_BUDGET_KEY] = { searches: 0, reads: 0 };
			return {
				content: [{ type: "text" as const, text: "Branch blocked after repeated invalid coverage reports. Stop this branch and return the blocked result; do not call more tools." }],
				details: { tool_name: "branch_plan", success: true, terminal: true, failure_class: "invalid_coverage", contexts: [] },
				terminate: true,
			};
		}
		invalidCoverageAttempts.delete(attemptKey);
		const shared = globalThis as Record<string, unknown>;
		const own = shared.__pi_research_state as { searches?: unknown; reads?: unknown } | undefined;
		const ownUsage = { searches: typeof own?.searches === "number" ? own.searches : 0, reads: typeof own?.reads === "number" ? own.reads : 0 };
		const ownCoverage = validResearchCoverageObservation(shared[RESEARCH_COVERAGE_KEY])
			? shared[RESEARCH_COVERAGE_KEY] as ResearchCoverageObservation
			: undefined;
		// A terminal branch may declare a model-level evidence gap, but it may
		// never call retrieval complete when an actual web tool returned a
		// truncated, failed, or budget-exhausted receipt. The receipt is kept
		// process-local and contains no sensitive request or source data.
		if (report.status === "done" && report.coverage?.complete && ownCoverage?.incomplete) {
			rejectPlanTool("branch_plan rejected: top-level coverage claims complete despite an incomplete retrieval receipt");
		}
		// A direct branch must also prove that retrieval happened at all. An absent
		// receipt is not the same as a clean receipt: otherwise a child could invent
		// source leads and mark a zero-call branch complete. Split branches may have
		// zero local calls because their terminal coverage is supplied by scouts.
		if (report.status === "done" && report.coverage?.complete && report.children.length === 0 && (!ownCoverage || ownCoverage.calls < 1)) {
			rejectPlanTool("branch_plan rejected: top-level coverage claims complete coverage without an actual retrieval receipt");
		}
		const dispatchRecord = shared[RESEARCH_SCOUT_DISPATCHED_KEY] as { key?: unknown; ids?: unknown } | undefined;
		const dispatchKey = `${context.run_id}:${context.parent_item_id}:${context.owner_ref}`;
		const dispatchedScoutIds = dispatchRecord?.key === dispatchKey && Array.isArray(dispatchRecord.ids)
			? dispatchRecord.ids.filter((value): value is string => typeof value === "string") : [];
		// Once a scout has been handed to the subagent runner, later branch reports
		// must retain its leaf. Otherwise a planner could replace an in-flight leaf,
		// discard its receipt, and spend the same global envelope again on a fresh
		// leaf while the original work is still consuming tools.
		for (const dispatchedId of dispatchedScoutIds) {
			if (!report.children.some((child) => child.item_id === dispatchedId)) {
				rejectPlanTool(`branch_plan rejected: retain dispatched scout leaf ${dispatchedId} in later branch reports`);
			}
		}
		const receipts = Array.isArray(shared.__pi_research_scout_receipts) ? shared.__pi_research_scout_receipts as Array<{ owner_ref?: unknown; searches?: unknown; reads?: unknown; coverage?: unknown }> : [];
		const receiptByOwner = new Map(receipts.filter((receipt) => typeof receipt.owner_ref === "string").map((receipt) => [receipt.owner_ref as string, receipt]));
		let observedSearches = ownUsage.searches;
		let observedReads = ownUsage.reads;
		let reservedSearches = 0;
		let reservedReads = 0;
		for (const child of report.children) {
			reservedSearches += child.budget.allocated.searches;
			reservedReads += child.budget.allocated.reads;
			const receipt = receiptByOwner.get(ownerRef(context.run_id, child.item_id));
			if (!receipt) {
				if (terminal) rejectPlanTool(`branch_plan rejected: missing scout receipt for ${child.item_id}`);
				if (child.budget.used.searches !== 0 || child.budget.used.reads !== 0) rejectPlanTool(`branch_plan rejected: unobserved scout usage for ${child.item_id}`);
				continue;
			}
			const searches = typeof receipt.searches === "number" ? receipt.searches : 0;
			const reads = typeof receipt.reads === "number" ? receipt.reads : 0;
			if (child.budget.used.searches !== searches || child.budget.used.reads !== reads) rejectPlanTool(`branch_plan rejected: scout budget receipt mismatch for ${child.item_id}`);
			const scoutCoverage = validResearchCoverageObservation(receipt.coverage) ? receipt.coverage : undefined;
			if (child.status === "done" && child.coverage?.complete && scoutCoverage?.incomplete) {
				rejectPlanTool(`branch_plan rejected: child ${child.item_id} claims complete coverage despite an incomplete scout retrieval receipt`);
			}
			if (child.status === "done" && child.coverage?.complete && (!scoutCoverage || scoutCoverage.calls < 1)) {
				rejectPlanTool(`branch_plan rejected: child ${child.item_id} claims complete coverage without an actual retrieval receipt`);
			}
			observedSearches += searches; observedReads += reads;
		}
		if (report.consumed.searches !== observedSearches || report.consumed.reads !== observedReads) rejectPlanTool("branch_plan rejected: branch consumption does not match observed research calls");
		const evidenceYieldError = branchEvidenceYieldError(report);
		if (evidenceYieldError) rejectPlanTool(`branch_plan rejected: ${evidenceYieldError}; use blocked or deferred with an explicit evidence gap when no usable source was found`);
		const terminalHasOpenChild = terminal && report.children.some((child) => !["done", "blocked", "deferred"].includes(child.status));
		if (!validateBranchReport(report, context, terminal)) {
			if (terminalHasOpenChild) {
				rejectPlanTool("branch_plan rejected: terminal branch must resolve every child before completion");
			}
			rejectPlanTool(`branch_plan rejected: ${terminal ? "terminal report is invalid or incomplete" : "branch report is invalid or over-budget"}`);
		}
		if (ownUsage.searches + reservedSearches > context.budget.searches || ownUsage.reads + reservedReads > context.budget.reads) {
			rejectPlanTool("branch_plan rejected: child allocations exceed the branch remainder after local research");
		}
		await writeBranchReport(reportPath, report, context, terminal);
		shared[RESEARCH_RESERVED_BUDGET_KEY] = { searches: reservedSearches, reads: reservedReads };
		const contexts = report.children.map((child) => ({
			v: 1 as const, profile: "deep-research" as const, run_id: context.run_id, parent_item_id: child.item_id,
			owner_ref: ownerRef(context.run_id, child.item_id), depth: 2 as const, budget: child.budget.allocated,
			limits: { max_depth: 2 as const, max_children: 0 as const },
		}));
		const contextText = contexts.length > 0 ? ` Scout plan_context (copy exactly): ${JSON.stringify(contexts)}` : "";
		return {
			content: [{ type: "text" as const, text: `Branch report saved (${report.children.length}/${context.limits.max_children} children, ${report.consumed.searches}/${context.budget.searches} searches, ${report.consumed.reads}/${context.budget.reads} reads).${contextText}` }],
			details: { tool_name: "branch_plan", success: true, terminal, failure_class: "none", contexts },
			...(terminal ? { terminate: true } : {}),
		};
	},
});

type GoOutcome = { ok: true; state: PlanState; stale: PlanItem[] } | { ok: false; reason: "no-plan" | "no-open-items" };
async function goTransition(cwd: string): Promise<GoOutcome> {
	return mutatePlan<GoOutcome>(cwd, async (previous) => {
		if (!previous) return { result: { ok: false, reason: "no-plan" } as const };
		if (!previous.items.some((item) => item.status === "pending" || item.status === "in_progress")) return { result: { ok: false, reason: "no-open-items" } as const };
		const stale = previous.writer === PROC_MARK ? [] : previous.items.filter((item) => item.status === "in_progress");
		const state: PlanState = { ...previous, phase: "executing" };
		return { state, result: { ok: true, state, stale } as const };
	});
}

async function clearPlan(cwd: string, replacement?: () => Promise<void>): Promise<void> {
	const path = statePath(cwd);
	if (!path && replacement) throw new Error("private plan storage is not ready; retry after session startup");
	if (path) {
		const privateFile = usesPrivateStorage(cwd);
		await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : undefined });
		if (privateFile) await chmod(dirname(path), 0o700);
	}
	if (path) await withFileMutationQueue(path, () => withPlanFileLock(path, async () => {
		await unlink(path).catch(() => undefined);
		const projection = privatePlanProjectionPath(cwd);
		if (projection) await unlink(projection).catch(() => undefined);
		if (replacement) await replacement();
	}));
	delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
	delete (globalThis as Record<string, unknown>)[RESEARCH_ROOT_CONTEXTS_KEY];
}

async function startPlanCommand(args: string, ctx: any, pi: ExtensionAPI): Promise<void> {
	rejectChildPlanMutation();
	const request = cleanText(args);
	if (!request) { ctx.ui.notify("Usage: /plan <request>", "error"); return; }
	if (!enterPlanningSurface(pi)) { ctx.ui.notify("Planning cannot start because the explicit tool selection excludes plan_write.", "error"); return; }
	const runId = `plan-${timestamp()}`;
	try {
		rememberModel(ctx);
		const now = isoNow();
		const initialState: PlanState = {
			schema_version: PLAN_GRAPH ? 5 : 4, run_id: runId, request, summary: "Planning pending.", autonomy: "lean",
			phase: "planned", created_at: now, updated_at: now, items: [],
		};
		await clearPlan(ctx.cwd, () => writeStateUnlocked(ctx.cwd, initialState));
	} catch (error) {
		leavePlanningSurface(pi, false);
		throw error;
	}
	setPlanning(true);
	awaitingReview = true;
	planEvent("start", runId, { request_bytes: utf8Bytes(request) });
	// Extension commands are already being dispatched from AgentSession.prompt().
	// Re-entering prompt() through sendUserMessage() here races the outer headless
	// `pi -p` prompt lifecycle and can replace the session while extension handlers
	// still hold its old context. Pi explicitly reserves sendMessage(triggerTurn)
	// for command-owned LLM interaction; use that single prompt path instead.
	pi.sendMessage({
		customType: "pi-munchkin:plan-command",
		content: planPrompt(request),
		display: true,
		details: { action: "plan", run_id: runId },
	}, { triggerTurn: true });
	// sendMessage is intentionally fire-and-forget on ExtensionAPI. A command
	// handler must keep a print-mode process alive until its triggered turn has
	// actually settled; otherwise `pi -p '/plan …'` exits 0 with an empty plan.
	if (typeof ctx.waitForIdle === "function") await ctx.waitForIdle();
}

async function goCommand(ctx: any, pi: ExtensionAPI): Promise<void> {
	rejectChildPlanMutation();
	const outcome = await goTransition(ctx.cwd);
	if (!outcome.ok) { ctx.ui.notify(outcome.reason === "no-plan" ? "No plan to run. Start with /plan <request>." : "Plan has no open items.", "error"); return; }
	setPlanning(false);
	awaitingReview = false;
	leavePlanningSurface(pi, true);
	// After a restart the planning-surface bookkeeping is gone (in-memory), so
	// leavePlanningSurface's keepPlanTools path is a no-op — yet session_start
	// stripped the plan tools. Resuming execution then steered the model to call
	// plan_update while it was hidden (observed live 2026-08-25: "plan-write not
	// available" loop on an interrupted plan). /plan-go is the user's explicit
	// resume, so it re-activates the flat plan tools unconditionally.
	const activeNow = pi.getActiveTools();
	const restorable = ["plan_write", "plan_update"].filter((name) =>
		!activeNow.includes(name) && pi.getAllTools().some((tool) => tool.name === name));
	if (restorable.length) pi.setActiveTools([...activeNow, ...restorable]);
	planEvent("go", outcome.state.run_id, { resumed: outcome.stale.length > 0 });
	pi.appendEntry("plan_spine", { run_id: outcome.state.run_id });
	const stale = outcome.stale.length ? `\n\nPreviously in_progress IDs may contain partial work: ${outcome.stale.map((item) => item.id).join(", ")}. Inspect before continuing.` : "";
	pi.sendMessage({
		customType: "pi-munchkin:plan-command",
		content: executionPrompt(outcome.state) + stale,
		display: true,
		details: { action: "plan-go", run_id: outcome.state.run_id },
	}, { triggerTurn: true });
	if (typeof ctx.waitForIdle === "function") await ctx.waitForIdle();
}

type Rebound = { openItems: number; interrupted: boolean };

/**
 * Publish the active-plan context from disk, and REPORT what was found.
 *
 * It used to take a notify callback and return void. That hid a dead affordance:
 * the session_start caller passed a real `ctx.ui.notify`, but under the shipped
 * defaults plan state is unreadable at session_start (the capsule identity lands at
 * manifest index 26), so it always returned early here; the LATE caller — the one
 * where the state actually is readable — passed `() => undefined`. The interrupted-
 * plan notice was therefore unreachable in every default session, which is exactly
 * the "stopped a plan halfway and could not get back to it" report from 2026-08-25.
 * Returning the facts lets each caller decide, instead of one of them silently
 * discarding them.
 */
async function rebindActivePlan(cwd: string): Promise<Rebound | null> {
	if (!statePath(cwd)) return null;
	const rebound = await mutatePlan<{ state: PlanState; staleLeases: number; interrupted: boolean } | null>(cwd, async (previous) => {
		if (!previous) return { result: null };
		const interrupted = previous.writer !== PROC_MARK;
		const staleLeases = interrupted ? previous.items.filter((item) => Boolean(item.lease) && !graphTerminal(item)) : [];
		if (!staleLeases.length) return { result: { state: previous, staleLeases: 0, interrupted } };
		const staleIds = new Set(staleLeases.map((item) => item.id));
		const state: PlanState = {
			...previous,
			items: previous.items.map((item) => {
				if (!staleIds.has(item.id)) return item;
				const next = { ...item, status: "blocked" as const, note: "Delegated branch interrupted before a validated result; inspect evidence and explicitly reopen before retrying.", evidence_gaps: ["branch:interrupted"] };
				if (next.budget) next.budget = { ...next.budget, used: { ...next.budget.allocated } };
				delete next.lease;
				return next;
			}),
		};
		return { state, result: { state, staleLeases: staleLeases.length, interrupted: true } };
	});
	const state = rebound?.state;
	if (!state) {
		delete (globalThis as Record<string, unknown>)[RESEARCH_ROOT_CONTEXTS_KEY];
		return null;
	}
	const openItems = openItemCount(state);
	if ((rebound?.staleLeases ?? 0) > 0) planEvent("branch-failed", state.run_id, { failure_class: "interrupted", stale_leases: rebound?.staleLeases });
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id, item_id: currentItem(state)?.id, open_items: openItems, blocked_items: blockedItemCount(state),
		graph: state.schema_version === 5, profile: state.profile?.name, settled: Boolean(state.settled_at),
	};
	publishResearchRootContexts(state);
	return { openItems, interrupted: Boolean(rebound?.interrupted) && openItems > 0 };
}

const interruptedPlanNotice = (openItems: number) =>
	`Interrupted plan: ${openItems} open item(s). Use /plan-status, /plan-go, or /plan-cancel.`;

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
		return raw.split("\n").filter((line) => line.trim()).slice(-maxLines);
	} catch { return []; }
	finally { await handle?.close().catch(() => undefined); }
}

export function policyBlock(_autonomy: Autonomy, subagentAvailable: boolean): string {
	return `Work one bounded plan item at a time. Update status by item ID.${subagentAvailable ? " Delegate only independent, well-scoped work." : ""}`;
}

async function mergeBranchResult(cwd: string, context: import("../lib/branch-report.ts").PlanContextV1, report: BranchReportV1 | null, failureClass: string | null): Promise<void> {
	type MergeOutcome = { kind: "ignored" } | { kind: "failed"; runId: string; failureClass: string } | { kind: "merged"; runId: string; children: number; leads: number; gaps: number };
	const releaseLease = (item: PlanItem): PlanItem => {
		if (!item.lease || item.owner_ref !== context.owner_ref) return item;
		const next = { ...item };
		delete next.lease;
		return next;
	};
	const consumeUncertainBudget = (item: PlanItem): PlanItem => {
		if (!item.budget) return item;
		return { ...item, budget: { ...item.budget, used: { ...item.budget.allocated } } };
	};
	const blockParent = (previous: PlanState, parent: PlanItem, failure: string): { state: PlanState; result: MergeOutcome } => {
		const state = { ...previous, items: previous.items.map((item) => item.id === parent.id ? {
			...consumeUncertainBudget(releaseLease(item)), status: "blocked" as const, note: `Delegated branch failed: ${failure}.`, evidence_gaps: [`branch:${failure}`],
		} : item) };
		// The fallback state deliberately contains no incoming child claims. It is
		// therefore safe to persist even when the report that triggered the merge
		// violated a graph invariant.
		validateStateSize(state);
		return { state, result: { kind: "failed", runId: previous.run_id, failureClass: failure } };
	};
	let outcome: MergeOutcome;
	try {
		outcome = await mutatePlan<MergeOutcome>(cwd, async (previous) => {
		if (!previous || previous.schema_version !== 5 || previous.run_id !== context.run_id || previous.settled_at) return { result: { kind: "ignored" } };
		const parent = previous.items.find((item) => item.id === context.parent_item_id);
		if (!parent || parent.owner_ref !== context.owner_ref || parent.parent_id) return { result: { kind: "ignored" } };
		if (graphTerminal(parent)) return { result: { kind: "ignored" } };
		// A branch-result is authoritative only when it carries the credential and
		// retry generation issued for the currently leased dispatch. Matching the
		// deterministic owner alone is insufficient: an unlaunched or late child
		// could otherwise inject a valid-looking report into an open branch.
		if (!context.lease_id || !parent.lease || parent.lease.lease_id !== context.lease_id ||
			(context.dispatch_epoch ?? 0) !== (parent.dispatch_epoch ?? 0)) return { result: { kind: "ignored" } };
		if (!report) {
			const failure = failureClass ?? "missing_report";
			const items = previous.items.map((item) => item.id === parent.id ? {
				...(failure === "child_failed" ? releaseLease(item) : consumeUncertainBudget(releaseLease(item))),
				status: "blocked" as const, note: `Delegated branch failed: ${failure}.`, evidence_gaps: [`branch:${failure}`],
			} : item);
			return { state: { ...previous, items }, result: { kind: "failed", runId: previous.run_id, failureClass: failure } };
		}
		const incomingIds = new Set(report.children.map((child) => child.item_id));
		const collision = previous.items.find((item) => incomingIds.has(item.id) && item.parent_id !== parent.id);
		if (collision) return blockParent(previous, parent, "merge_collision");
		const retained = previous.items.filter((item) => item.parent_id !== parent.id);
		const children: PlanItem[] = report.children.map((child) => ({
			id: child.item_id, parent_id: parent.id, kind: "research_leaf", owner_ref: ownerRef(previous.run_id, child.item_id),
			title: cleanText(child.title), note: cleanText(child.note) || undefined, status: child.status,
			budget: child.budget, evidence_gaps: child.evidence_gaps?.map(cleanText).filter(Boolean), coverage: child.coverage, defer: child.defer,
		}));
		const priorUsed = parent.budget?.used ?? { searches: 0, reads: 0 };
		const cumulativeUsed = addBudget(priorUsed, report.consumed);
		// A reopened branch receives only the remainder of its original allocation.
		// Keep consumption cumulative in the authoritative graph; replacing it with
		// the latest attempt would make a retry look as if earlier calls never ran.
		if (parent.budget && !budgetWithin(cumulativeUsed, parent.budget.allocated)) return blockParent(previous, parent, "merge_over_budget");
		const items = retained.map((item) => item.id === parent.id ? {
			...releaseLease(item), status: report.status, note: cleanText(report.note), defer: report.defer,
			budget: item.budget ? { ...item.budget, used: cumulativeUsed } : item.budget,
			evidence_gaps: report.evidence_gaps.map(cleanText).filter(Boolean), source_leads: report.source_leads.map((lead) => storedUrl(lead.url).display), coverage: report.coverage,
		} : item).concat(children);
		const next = { ...previous, items };
		try { validateStateSize(next); }
		catch { return blockParent(previous, parent, "merge_rejected"); }
		return { state: next, result: { kind: "merged", runId: previous.run_id, children: children.length, leads: report.source_leads.length, gaps: report.evidence_gaps.length } };
		});
	} catch {
		// Unexpected merge failures (for example a transient report projection
		// error) must not look like a retryable success. Make one bounded attempt
		// to close the owning branch without accepting any child claims.
		try {
			outcome = await mutatePlan<MergeOutcome>(cwd, async (previous) => {
				if (!previous || previous.schema_version !== 5 || previous.run_id !== context.run_id || previous.settled_at) return { result: { kind: "ignored" } };
				const parent = previous.items.find((item) => item.id === context.parent_item_id);
				if (!parent || parent.owner_ref !== context.owner_ref || parent.parent_id || graphTerminal(parent)) return { result: { kind: "ignored" } };
				return blockParent(previous, parent, "merge_rejected");
			});
		} catch {
			outcome = { kind: "ignored" };
		}
	}
	if (outcome.kind === "merged") planEvent("branch-merged", outcome.runId, { children: outcome.children, lead_count: outcome.leads, evidence_gaps: outcome.gaps });
	if (outcome.kind === "failed") planEvent("branch-failed", outcome.runId, { failure_class: outcome.failureClass });
}

export default function (pi: ExtensionAPI): void {
	api = pi;
	pi.registerTool(planWrite);
	pi.registerTool(planUpdate);
	if (GOALS_ENABLED) {
		pi.registerTool(goalPropose);
		pi.registerTool(goalInspect);
		pi.registerTool(goalUpdate);
		pi.registerTool(goalSettle);
		pi.registerTool(goalBlock);
	}
	if (PLAN_GRAPH) {
		pi.registerTool(planExpand);
		pi.registerTool(planSettle);
		if (process.env[PLAN_CONTEXT_ENV] && process.env[BRANCH_REPORT_ENV]) pi.registerTool(branchPlan);
		if (DEEP_RESEARCH_PLANNING) pi.registerTool(researchPlanStart);
	}

	if (PLAN_TOOL_GO) {
		pi.registerTool(defineTool({
			name: "plan_go", label: "Start Plan Execution", description: "Headless opt-in: start the saved plan.", parameters: Type.Object({}),
			async execute(_id, _params, _signal, _update, ctx) {
				rejectChildPlanMutation();
				if (awaitingReview) rejectPlanTool("plan_go rejected: this plan is still awaiting user review. Stop here; the user starts execution.");
				const outcome = await goTransition(ctx.cwd);
				if (!outcome.ok) rejectPlanTool(`plan_go rejected: ${outcome.reason}`);
				setPlanning(false);
				planEvent("go", outcome.state.run_id, { resumed: false });
				return { content: [{ type: "text" as const, text: executionPrompt(outcome.state) }], details: { tool_name: "plan_go", success: true } };
			},
		}));
	}

	pi.on("session_start", async (_event, ctx) => {
		setPlanning(false);
		awaitingReview = false;
		planningSurfaceBefore = null;
		planningSurfaceApplied = null;
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		delete (globalThis as Record<string, unknown>).__pi_active_goal_context;
		lastSessionCwd = ctx.cwd;
		rememberModel(ctx);
		if (GOALS_ENABLED) await rebindActiveGoal(ctx.cwd);
		lastNotify = (message: string) => ctx.ui.notify(message, "info");
		reboundAnnounced = false;
		// A delegated research planner shares the project cwd with its parent in
		// project-storage mode, but it is not a restarted parent. Rebinding here
		// would see the parent's writer marker, classify the live dispatch lease as
		// stale, and block the branch before the child can publish its report.
		const delegatedContext = await readPlanContext(process.env[PLAN_CONTEXT_ENV]);
		const delegatedState = delegatedContext ? await readState(ctx.cwd) : undefined;
		delegatedBranchProcess = Boolean(
			IS_SUBAGENT_PROCESS ||
			(delegatedContext && delegatedState?.run_id === delegatedContext.run_id),
		);
		// Signals are subscribed once per process. Test harnesses and embedders can
		// reload this extension in the same process, so keep the child marker on a
		// shared global as well as this module instance. An older subscription must
		// not reclaim a parent lease after a delegated child has started.
		(globalThis as Record<string, unknown>)[DELEGATED_BRANCH_PROCESS_GLOBAL] = delegatedBranchProcess;
		const rebound = delegatedBranchProcess ? null : await rebindActivePlan(ctx.cwd);
		if (rebound?.interrupted) { reboundAnnounced = true; lastNotify(interruptedPlanNotice(rebound.openItems)); }
		if (!FORCE_PLAN_WRITE) {
			const hidden = new Set(PLAN_SURFACE_TOOLS);
			pi.setActiveTools(pi.getActiveTools().filter((name) => !hidden.has(name)));
		}
		// A depth-one research planner is a protocol child, not an ordinary user
		// session. Its only parent-write capability is branch_plan; keep that tool
		// available even though the normal core profile parks specialist tools.
		if (process.env[PLAN_CONTEXT_ENV] && process.env[BRANCH_REPORT_ENV] && pi.getAllTools().some((tool) => tool.name === "branch_plan") && !pi.getActiveTools().includes("branch_plan")) {
			pi.setActiveTools([...pi.getActiveTools(), "branch_plan"]);
		}
	});

	subscribeOnce("plan-runner:domain-signal", () => onHarnessSignal(pi.events, (signal) => {
		if (!lastSessionCwd) return;
		if (signal.type === "capsule/identity") {
			if (delegatedBranchProcess || (globalThis as Record<string, unknown>)[DELEGATED_BRANCH_PROCESS_GLOBAL] === true) return;
			const cwd = lastSessionCwd;
			pendingRebind = rebindActivePlan(cwd).then((rebound) => {
				if (!rebound) return;
				// tool-activation derived its core/deferred split four slots before the
				// capsule identity existed, so it decided `activePlan === false` and
				// deferred the plan tools even mid-plan. This is the only moment the
				// answer is knowable; announce it rather than leaving two compensating
				// patches (/plan-go re-arm, capability(planning)) to paper over it.
				emitHarnessSignal(pi.events, { v: 1, type: "plan/rebound", openItems: rebound.openItems, interrupted: rebound.interrupted });
				if (rebound.interrupted && !reboundAnnounced) { reboundAnnounced = true; lastNotify?.(interruptedPlanNotice(rebound.openItems)); }
			}).catch(() => undefined).finally(() => { pendingRebind = null; });
		}
		if (signal.type === "plan/branch-result") {
			// Only the owning parent may merge a delegated result into the graph. A
			// child has its own event bus in production, but reloads and embedders can
			// share one; the process marker keeps a local signal from becoming a
			// parent-state mutation through this subscriber.
			if (delegatedBranchProcess || (globalThis as Record<string, unknown>)[DELEGATED_BRANCH_PROCESS_GLOBAL] === true) return;
			const prior = pendingBranchMerge ?? Promise.resolve();
			const next = prior.catch(() => undefined).then(() => mergeBranchResult(lastSessionCwd!, signal.context, signal.report, signal.failureClass)).catch(() => undefined);
			pendingBranchMerge = next;
			void next.finally(() => { if (pendingBranchMerge === next) pendingBranchMerge = null; });
		}
	}));
	pi.on("before_agent_start", async () => {
		if (pendingRebind) await pendingRebind;
		if (pendingBranchMerge) await pendingBranchMerge;
		if (!GOALS_ENABLED || !lastSessionCwd) return;
		const goal = await rebindActiveGoal(lastSessionCwd);
		if (goal?.status === "active") return {
			message: {
				customType: "pi-munchkin:goal-context",
				content: goalExecutionPrompt(goal),
				display: false,
				details: { status: goal.status },
			},
		};
	});

	pi.registerCommand("plan", { description: "Enter bounded read-only planning for a request.", handler: async (args, ctx) => startPlanCommand(args, ctx, pi) });
	if (GOALS_ENABLED) {
		pi.registerCommand("goal", {
			description: "Create and activate a persistent project/worktree goal.",
			handler: async (args, ctx) => {
				rejectChildGoalMutation();
				const objective = cleanText(args);
				if (!objective) { ctx.ui.notify("Usage: /goal <objective>", "error"); return; }
				const result = await mutateGoal(ctx.cwd, async (previous) => {
					if (previous && !["complete", "cancelled"].includes(previous.status)) throw new Error("An active or pending goal already exists; use /goal-status or /goal-resume.");
					const goal = createGoal({ cwd: ctx.cwd, objective, scope: goalScope(), status: "active" });
					return { goal, result: goal };
				});
				publishGoal(result);
				emitGoalState(pi, result);
				goalEvent("started", result);
				ctx.ui.notify(`Goal active: ${result.goal_id}`, "info");
				await startGoalTurn(pi, ctx, result, "goal");
			},
		});
		pi.registerCommand("goal-accept", {
			description: "Accept the current skill-proposed goal and activate it.",
			handler: async (_args, ctx) => {
				rejectChildGoalMutation();
				const result = await mutateGoal(ctx.cwd, async (previous) => {
					if (!previous) throw new Error("No proposed goal exists.");
					const goal = acceptGoal(previous);
					return { goal, result: goal };
				});
				publishGoal(result);
				emitGoalState(pi, result);
				goalEvent("accepted", result);
				ctx.ui.notify(`Goal accepted: ${result.goal_id}`, "info");
				await startGoalTurn(pi, ctx, result, "goal-accept");
			},
		});
		pi.registerCommand("goal-status", {
			description: "Show the active persistent goal and its evidence-backed criteria.",
			handler: async (_args, ctx) => {
				const goal = await rebindActiveGoal(ctx.cwd);
				ctx.ui.notify(renderGoal(goal, await readGoals(ctx.cwd)), "info");
			},
		});
		pi.registerCommand("goal-resume", {
			description: "Resume a paused, blocked, or 80/20-accepted goal.",
			handler: async (_args, ctx) => {
				rejectChildGoalMutation();
				const result = await mutateGoal(ctx.cwd, async (previous) => {
					if (!previous) throw new Error("No resumable goal exists.");
					const goal = resumeGoal(previous);
					return { goal, result: goal };
				});
				publishGoal(result);
				emitGoalState(pi, result);
				goalEvent("resumed", result);
				ctx.ui.notify(`Goal resumed: ${result.goal_id}`, "info");
				await startGoalTurn(pi, ctx, result, "goal-resume");
			},
		});
		pi.registerCommand("goal-pause", {
			description: "Pause the active goal without discarding its evidence.",
			handler: async (_args, ctx) => {
				rejectChildGoalMutation();
				const result = await mutateGoal(ctx.cwd, async (previous) => {
					if (!previous) throw new Error("No active goal exists.");
					const goal = pauseGoal(previous);
					return { goal, result: goal };
				});
				publishGoal(result);
				emitGoalState(pi, result);
				goalEvent("paused", result);
				ctx.ui.notify(`Goal paused: ${result.goal_id}`, "info");
			},
		});
		pi.registerCommand("goal-cancel", {
			description: "Cancel the active goal while retaining its private history.",
			handler: async (_args, ctx) => {
				rejectChildGoalMutation();
				const result = await mutateGoal(ctx.cwd, async (previous) => {
					if (!previous) throw new Error("No active goal exists.");
					const goal = cancelGoal(previous);
					return { goal, result: goal };
				});
				goalEvent("cancelled", result);
				publishGoal(undefined);
				emitGoalState(pi, result);
				ctx.ui.notify(`Goal cancelled: ${result.goal_id}`, "info");
			},
		});
	}
	pi.registerCommand("plan-go", { description: "Start or resume execution of the reviewed plan.", handler: async (_args, ctx) => goCommand(ctx, pi) });
	pi.registerCommand("plan-cancel", {
		description: "Discard the active plan and restore the previous tool selection.",
		handler: async (_args, ctx) => {
			rejectChildPlanMutation();
			await clearPlan(ctx.cwd);
			setPlanning(false);
			awaitingReview = false;
			leavePlanningSurface(pi, false);
			if (PLAN_GRAPH) pi.setActiveTools(pi.getActiveTools().filter((name) => !["plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start"].includes(name)));
			ctx.ui.notify("Plan cancelled.", "info");
		},
	});
	pi.registerCommand("plan-status", { description: "Show the current bounded plan or one graph subtree.", handler: async (args, ctx) => {
		const state = await readState(ctx.cwd);
		const selected = cleanText(args) || undefined;
		if (selected && state && !state.items.some((item) => item.id === selected)) { ctx.ui.notify(`Unknown plan item: ${selected}`, "error"); return; }
		ctx.ui.notify(state ? renderTodo(state, selected) : "No current plan found.", "info");
	} });
	pi.registerCommand("plan-export", { description: "Export the private plan review snapshot.", handler: async (_args, ctx) => {
		rejectChildPlanMutation();
		const state = await readState(ctx.cwd);
		if (!state) { ctx.ui.notify("No plan to export.", "info"); return; }
		await mkdir(dirname(todoPath(ctx.cwd)), { recursive: true });
		await atomicWrite(todoPath(ctx.cwd), renderTodo(state, undefined, true), false);
		await atomicWrite(reviewExportPath(ctx.cwd), `${JSON.stringify(state, null, 2)}\n`, false);
		ctx.ui.notify("Plan exported to .pi/TODO.md and .pi/plan-review.json.", "info");
	} });
	pi.registerCommand("plan-trace", { description: "Show bounded historical plan trace lines.", handler: async (args, ctx) => {
		const path = tracePath(ctx.cwd);
		const n = Math.min(50, Math.max(1, Number.parseInt(args.trim(), 10) || 10));
		ctx.ui.notify(path ? (await tailLines(path, n)).join("\n") || "No plan trace found." : "No plan trace found.", "info");
	} });

	pi.on("tool_call", async (event) => {
		if (isPlanning() && !SAFE_PLAN_TOOLS.has(event.toolName)) {
			emitHarnessSignal(pi.events, { v: 1, type: "tool/prevented", toolCallId: event.toolCallId, failureClass: "policy_rejection" });
			planEvent("plan-mode-block", `plan-mode-${actionId()}`, { toolName: event.toolName });
			return { block: true, reason: "failure_class=policy_rejection. Planning is read-only. Finish with plan_write, then stop; the user starts execution." };
		}
		if (!FORCE_PLAN_WRITE || isPlanning()) return;
		const mutates = MUTATION_TOOLS.has(event.toolName) || (event.toolName === "bash" && classifyBashCommand(String((event.input as any)?.command ?? "")).mutates);
		if (!mutates || !pi.getActiveTools().includes("plan_write")) return;
		const state = lastSessionCwd ? await readState(lastSessionCwd) : undefined;
		if (!state) {
			emitHarnessSignal(pi.events, { v: 1, type: "tool/prevented", toolCallId: event.toolCallId, failureClass: "policy_rejection" });
			// Was: "Set FORCE_PLAN_WRITE=off ...". A model cannot set an environment
			// variable for the process it is already running inside, and the message
			// omitted the one action that WOULD unblock it. Operator-facing knobs belong
			// in the docs, not in a block reason the model is expected to act on.
			return { block: true, reason: "failure_class=policy_rejection. This mode requires a plan before source mutation. Call plan_write with the items you intend to complete, then retry this edit." };
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!event.isError || (event.toolName !== "plan_write" && event.toolName !== "plan_update")) return;
		const state = await readState(ctx.cwd);
		planEvent("write-rejected", state?.run_id ?? `rejected-${actionId()}`, { reason_class: "schema_or_execution" });
	});

	pi.on("agent_end", async (_event, ctx) => {
		const state = await readState(ctx.cwd);
		if (!state || state.phase !== "executing" || openItemCount(state) === 0) return;
		record("plan-runner", "ended-open", { run_id: state.run_id, open_items: openItemCount(state) });
	});
}
