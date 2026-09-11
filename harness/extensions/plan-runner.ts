import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import { currentCompactionOwner } from "../lib/compaction-coordinator.ts";
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
	type BranchChildInput, type GraphPlanItem, type GraphPlanState, type ParentEvidenceCard, type PlanStatus, type ResearchBranchLease, type ResearchBudget,
} from "../lib/plan-graph.ts";
import { planStorageMode, privatePlanProjectionPath, privatePlanStatePath, privatePlanTracePath } from "../lib/plan-state-storage.ts";
import { processWriterMarker } from "../lib/process-writer.ts";
import { auditResearchCitations, storedUrl } from "../lib/research-ledger.ts";
import { canonicalResearchUrl, claimIdForText, RESEARCH_EVIDENCE_CARDS_KEY } from "../lib/research-evidence.ts";
import { atomicWriteFile } from "../lib/private-artifact.ts";
import {
	RESEARCH_ROUND_MAX_GAPS, ResearchRoundLedger, mutateResearchRoundLedger, readResearchRoundLedger, researchRoundPath, writeResearchRoundLedger,
	validateResearchRoundLedger, type ClaimObligationV1, type EvidenceGapV1, type EvidenceCardRefV1, type ResearchRoundProposalV1, type ChildResearchReportV1, type ResearchRoundLedgerStateV1,
} from "../lib/research-round.ts";
import {
	deadlineFor, deadlinePhase, extendDeadline, migrateResearchPair, mutateResearchAggregate, readResearchAggregate, researchAggregatePath, transitionAggregate, writeResearchAggregate,
	type ResearchAggregatePhase,
} from "../lib/research-aggregate.ts";
import { inspectResearchPage, renderCoverageDigest } from "../lib/research-view.ts";
import { initialToolSurface } from "../lib/session-bootstrap.ts";
import { record } from "../lib/telemetry.ts";
import {
	continuationDispatcherActive, emitContinuationRequest, hashContinuationIdentity,
	type ContinuationRequestV1,
} from "../lib/continuation-authority.ts";
import { CORE_NAMES, profileFromEnvironment } from "./tool-activation.ts";
import {
	acceptGoal, blockGoal, cancelGoal, createGoal, goalAmbientSummary, goalContinuationDecision, goalsEnabled, inspectGoal, mutateGoal, pauseGoal, readCurrentGoal,
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
export const PLAN_GRAPH_DEFAULT: "on" | "off" = "off";
export const DEEP_RESEARCH_PLANNING_DEFAULT: "on" | "off" = "off";
const PLAN_GRAPH = (process.env.PLAN_GRAPH ?? PLAN_GRAPH_DEFAULT) === "on";
const DEEP_RESEARCH_PLANNING = PLAN_GRAPH && (process.env.DEEP_RESEARCH_PLANNING ?? DEEP_RESEARCH_PLANNING_DEFAULT) === "on";
/** New parent-owned workflow is dark until explicitly enabled alongside the
 * existing graph, planning and ledger flags. Legacy research_round remains
 * available unchanged when this is unset. */
const PARENT_RESEARCH_WORKFLOW = DEEP_RESEARCH_PLANNING && process.env.RESEARCH_WORKFLOW === "parent";
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

type MergeOutcome =
	| { kind: "ignored" }
	| { kind: "failed"; runId: string; failureClass: string; headTerminal: boolean; headTerminalAt?: string; openItems: number }
	| { kind: "merged"; runId: string; children: number; leads: number; gaps: number; headTerminal: boolean; headTerminalAt?: string; openItems: number };

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
	research_round_contract?: GraphPlanState["research_round_contract"];
	head_terminal_at?: string;
	settled_at?: string;
	writer?: string;
};

type ModelIdentity = { provider: string; id: string };
let activeModel: ModelIdentity = { provider: "unknown", id: "unknown" };
let api: ExtensionAPI | undefined;
let lastSessionCwd: string | null = null;
let lastSessionIdHash: string | null = null;
// Captured at session_start so the LATE capsule-identity rebind — the only point at
// which plan state is readable under the shipped defaults — can still reach the user.
let lastNotify: ((message: string) => void) | null = null;
let reboundAnnounced = false;
let pendingRebind: Promise<void> | null = null;
let pendingBranchMerge: Promise<void> | null = null;
// One autonomous offer per persisted goal revision. A model that makes no
// durable progress cannot cause an unbounded follow-up loop; a changed goal
// revision earns one fresh offer.
const GOAL_CONTINUATION_OFFERS = "__pi_goal_continuation_offers_v1";
function goalContinuationOffers(): Set<string> {
	const shared = globalThis as Record<string, unknown>;
	if (!(shared[GOAL_CONTINUATION_OFFERS] instanceof Set)) shared[GOAL_CONTINUATION_OFFERS] = new Set<string>();
	return shared[GOAL_CONTINUATION_OFFERS] as Set<string>;
}
// A child result can arrive after the parent agent has ended. The merge may
// make the graph terminal, but without a fresh parent turn the model never
// rereads delegated sources or calls plan_settle. Keep one follow-up per
// terminal generation (reopened branches receive a new head-terminal marker).
const researchSynthesisFollowUps = new Set<string>();
let awaitingReview = false;
let planningSurfaceBefore: string[] | null = null;
let planningSurfaceApplied: string[] | null = null;
let delegatedBranchProcess = false;
const DELEGATED_BRANCH_PROCESS_GLOBAL = "__pi_delegated_branch_process_v1";

const PLAN_FLAG = "__pi_plan_phase_active";
const EXPLICIT_FLAG = "__pi_tool_selection_explicit";
const RESEARCH_ROOT_CONTEXTS_KEY = "__pi_research_root_contexts_v1";
const RESEARCH_ROUND_PATH_KEY = "__pi_research_round_path_v1";
const RESEARCH_AGGREGATE_PATH_KEY = "__pi_research_aggregate_path_v1";
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

function offerContinuation(
	pi: ExtensionAPI,
	request: ContinuationRequestV1,
	authorize: () => boolean | Promise<boolean>,
): boolean {
	return continuationDispatcherActive(pi.events) && emitContinuationRequest(pi.events, { request, authorize });
}

function goalContinuationInstruction(goal: GoalState, decision: "continue" | "settle"): string {
	if (decision === "settle") {
		return goal.criteria.some((criterion) => criterion.status === "deferred")
			? "[pi-munchkin:goal-continuation] Required criteria are met and optional work is deferred. Verify the delivered value, then call goal_settle with outcome=accepted_80_20, concrete evidence, and value, risk, and rationale for the deferrals. If evidence is insufficient, leave the goal active and explain the gap."
			: "[pi-munchkin:goal-continuation] All goal criteria are recorded as met. Perform the final verification you can justify, then call goal_settle with outcome=complete and concrete evidence; if evidence is insufficient, leave the goal active and explain the gap.";
	}
	return "[pi-munchkin:goal-continuation] The active goal still has open criteria. Continue with one highest-value next action, then record the resulting evidence with goal_update. Do not repeat work that produced no new evidence.";
}

async function offerGoalContinuation(pi: ExtensionAPI, ctx: { cwd: string; sessionManager: { getSessionId(): string } }): Promise<void> {
	if (!GOALS_ENABLED || IS_SUBAGENT_PROCESS) return;
	// A compact_context call resolves asynchronously, well after the tool result
	// and this agent_end handler. If one is in flight, its own resume offer
	// already carries this same goal forward (compact-tool reads the current
	// goal and scopes its continuation to it) once compaction settles. Offering
	// a second, independent goal continuation here raced the compaction offer
	// under real timing and delivered two receipts for one lifecycle boundary
	// (2026-09 G01-E). Defer to the compaction outcome instead of competing
	// with it; a normal turn re-offers on its own next agent_end regardless.
	if (currentCompactionOwner() !== null) return;
	const goal = await readExecutableGoal(ctx.cwd);
	const decision = goalContinuationDecision(goal);
	if (decision === "stop" || !goal) return;
	const revision = createHash("sha256").update(JSON.stringify(goal)).digest("hex");
	const goalIdHash = createHash("sha256").update(goal.goal_id).digest("hex");
	const sessionIdHash = hashContinuationIdentity(ctx.sessionManager?.getSessionId?.() ?? `compat:${ctx.cwd}`);
	const offerKey = `${goal.goal_id}:${revision}`;
	if (goalContinuationOffers().has(offerKey)) return;
	const accepted = offerContinuation(pi, {
		v: 1,
		session_id_hash: sessionIdHash,
		owner_id_hash: goalIdHash,
		generation: revision,
		scope: "goal",
		reason: "goal",
		priority: 500,
		idempotency_key: `goal:${sessionIdHash}:${goalIdHash}:${revision}:${decision}`,
		message: goalContinuationInstruction(goal, decision),
		expires_at_ms: Date.now() + 60_000,
	}, async () => {
		const current = await readExecutableGoal(ctx.cwd);
		return Boolean(current &&
			createHash("sha256").update(current.goal_id).digest("hex") === goalIdHash &&
			createHash("sha256").update(JSON.stringify(current)).digest("hex") === revision &&
			goalContinuationDecision(current) === decision);
	});
	if (accepted) goalContinuationOffers().add(offerKey);
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
			item.claim_ids !== undefined || item.evidence_gaps !== undefined || item.lease !== undefined || item.dispatch_epoch !== undefined
		))) return undefined;
		// Validate the persisted v5 shape before applying the migration's bounded
		// text cleanup. Normalizing an invalid status, ID, budget, or evidence field
		// could turn corrupted state into executable work and make the original
		// damage impossible to diagnose. v4 has explicit legacy cleanup semantics;
		// v5 must either validate as-is or remain untouched for inspection/recovery.
		if (raw.items.some((item: unknown) => !item || typeof item !== "object" || Array.isArray(item))) return undefined;
		try {
			if (validateGraph(raw as GraphPlanState).length) return undefined;
		} catch { return undefined; }
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
		...(raw.schema_version === 5 && Array.isArray(item.claim_ids) ? { claim_ids: item.claim_ids.filter((value: unknown) => typeof value === "string").slice(0, 16) } : {}),
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
			...(raw.schema_version === 5 && PLAN_GRAPH && raw.profile?.name === "deep-research"
				? { research_round_contract: raw.research_round_contract === "v1" ? "v1" as const : "legacy" as const }
				: {}),
		...(raw.schema_version === 5 && PLAN_GRAPH && typeof raw.head_terminal_at === "string" ? { head_terminal_at: raw.head_terminal_at } : {}),
		...(raw.schema_version === 5 && PLAN_GRAPH && typeof raw.settled_at === "string" ? { settled_at: raw.settled_at } : {}),
		writer: typeof raw.writer === "string" ? raw.writer : undefined,
	};
	if (state.schema_version === 5 && !(state.phase === "planned" && state.items.length === 0) && validateGraph(state as GraphPlanState).length) return undefined;
	return state;
}

async function readState(cwd: string): Promise<PlanState | undefined> {
	const path = statePath(cwd);
	let rawState: any;
	let persisted: PlanState | undefined;
	if (path && await exists(path)) {
		try {
			rawState = JSON.parse(await readFile(path, "utf8"));
			persisted = migrateState(rawState);
		} catch { /* fall through to the private aggregate recovery view */ }
	}
	// Parent-owned research treats the aggregate as the authority, not merely as
	// a fallback when the compatibility graph happens to be unreadable. A valid
	// but stale graph must never shadow a newer aggregate revision. Derive the
	// aggregate path from the persisted run identity so this remains safe across
	// process restarts where the in-memory pointer has not yet been rebound.
	if (PARENT_RESEARCH_WORKFLOW) {
		const parentResearch = rawState?.profile?.name === "deep-research" || persisted?.profile?.name === "deep-research" || rawState?.research_round_contract === "v1";
		const runId = typeof persisted?.run_id === "string" ? persisted.run_id : typeof rawState?.run_id === "string" ? rawState.run_id : undefined;
		if (parentResearch && runId) {
			const aggregatePath = researchAggregatePath(cwd, runId, process.env);
			const aggregate = await readResearchAggregate(aggregatePath);
			if (!aggregate || aggregate.run_id !== runId || !aggregate.graph || typeof aggregate.graph !== "object") return undefined;
			(globalThis as Record<string, unknown>)[RESEARCH_AGGREGATE_PATH_KEY] = aggregatePath;
			const recovered = migrateState(aggregate.graph);
			return recovered && recovered.run_id === aggregate.run_id ? recovered : undefined;
		}
	}
	return persisted;
}

/** Read the graph compatibility view without consulting the aggregate. Sync
 * operations use this deliberately: the aggregate is authoritative for reads,
 * but a freshly committed graph mutation is the input that must be projected
 * into that aggregate before the next authoritative read. */
async function readCompatibilityState(cwd: string): Promise<PlanState | undefined> {
	const path = statePath(cwd);
	if (!path || !(await exists(path))) return undefined;
	try { return migrateState(JSON.parse(await readFile(path, "utf8"))); } catch { return undefined; }
}

async function requireActiveParentResearch(cwd: string, runId: string, operation: string): Promise<void> {
	if (!PARENT_RESEARCH_WORKFLOW) return;
	const path = researchAggregatePath(cwd, runId, process.env);
	const aggregate = await readResearchAggregate(path);
	if (!aggregate || aggregate.run_id !== runId) rejectPlanTool(`${operation} rejected: parent research aggregate is missing or malformed`);
	let phase = aggregate.phase;
	if (phase === "active" && deadlinePhase(aggregate) === "expired") {
		await mutateResearchAggregate(path, (state) => ({ state: transitionAggregate(state, { phase: "awaiting_extension" }), result: undefined }));
		const refreshed = await readResearchAggregate(path);
		if (!refreshed || refreshed.run_id !== runId) rejectPlanTool(`${operation} rejected: parent research aggregate is missing or malformed`);
		phase = refreshed.phase;
	}
	if (phase === "active" && deadlinePhase(aggregate) === "validation" && (operation === "plan_expand" || operation === "research branch lease")) {
		rejectPlanTool(`${operation} rejected: the discovery phase has ended; continuation is unavailable until the user extends the run`);
	}
	if (phase !== "active") rejectPlanTool(`${operation} rejected: parent research is ${phase}; continuation is unavailable until the user extends the run`);
}

async function requireFinishableParentResearch(cwd: string, runId: string): Promise<void> {
	if (!PARENT_RESEARCH_WORKFLOW) return;
	const path = researchAggregatePath(cwd, runId, process.env);
	const aggregate = await readResearchAggregate(path);
	if (!aggregate || aggregate.run_id !== runId) rejectPlanTool("research_finish rejected: parent research aggregate is missing or malformed");
	let phase = aggregate.phase;
	if (phase === "active" && deadlinePhase(aggregate) === "expired") {
		await mutateResearchAggregate(path, (state) => ({ state: transitionAggregate(state, { phase: "awaiting_extension" }), result: undefined }));
		const refreshed = await readResearchAggregate(path);
		if (!refreshed || refreshed.run_id !== runId) rejectPlanTool("research_finish rejected: parent research aggregate is missing or malformed");
		phase = refreshed.phase;
	}
	// An expired run is represented as awaiting_extension. Finishing is still
	// allowed when evidence is already complete; explicit cancellation/blocked
	// states must remain terminal until the user resumes them.
	if (phase === "settled" && typeof (aggregate.graph as { settled_at?: unknown }).settled_at !== "string") return;
	if (phase !== "active" && phase !== "awaiting_extension") rejectPlanTool(`research_finish rejected: parent research is ${phase}; continuation is unavailable until the user extends the run`);
}

/** Creation must not treat a present but unreadable plan as an empty slot. */
async function planStateFilePresent(cwd: string): Promise<boolean> {
	const path = statePath(cwd);
	return Boolean(path && await exists(path));
}

async function rejectUnreadablePlanState(cwd: string): Promise<void> {
	if (await planStateFilePresent(cwd) && !await readState(cwd)) {
		rejectPlanTool("plan creation rejected: existing plan state is malformed; inspect or explicitly cancel it before creating a replacement");
	}
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
		// Ambient status intentionally exposes only a bounded count, never the gap
		// text. Source-validation gaps are still evidence gaps and must not vanish
		// from the compact view merely because their internal label uses `source:`.
		const gaps = item.evidence_gaps?.length ?? 0;
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
		"# Meta", `Phase: ${state.phase}`, `Head terminal: ${state.head_terminal_at ? "yes" : "no"}`, `Updated: ${state.updated_at}`, `Run ID: ${state.run_id}`, "",
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
	await atomicWriteFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: privateFile ? 0o600 : 0o644, ...(privateFile ? { directoryMode: 0o700 } : {}) });
	if (privateFile) {
		const projection = privatePlanProjectionPath(cwd);
		if (!projection) throw new Error("private plan projection is not ready");
		await atomicWriteFile(projection, renderTodo(state), { mode: 0o600, directoryMode: 0o700 });
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

type MutatePlanOptions = {
	/** Prepare dependent durable views while the plan lock is still held. If
	 * preparation fails, the executable compatibility graph is not published. */
	beforePersist?: (state: PlanState) => Promise<void> | void;
};

async function mutatePlan<T>(cwd: string, fn: (state: PlanState | undefined) => Promise<{ state?: PlanState; result: T }>, options: MutatePlanOptions = {}): Promise<T> {
	const path = statePath(cwd);
	if (!path) throw new Error("private plan storage is not ready; retry after session startup");
	const privateFile = planStorageMode() === "capsule";
	await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : undefined });
	if (privateFile) await chmod(dirname(path), 0o700);
	return withFileMutationQueue(path, () => withPlanFileLock(path, async () => {
		const out = await fn(await readState(cwd));
		if (out.state) {
			if (options.beforePersist) await options.beforePersist(out.state);
			await writeStateUnlocked(cwd, out.state);
		}
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
	const result = await mutatePlan<ResearchBranchLeaseResult>(cwd, async (previous) => {
		if (!previous) return { result: { ok: false, reason: "no-plan" } };
		if (previous.schema_version !== 5 || previous.run_id !== context.run_id || previous.profile?.name !== "deep-research" || previous.settled_at) {
			return { result: { ok: false, reason: "wrong-plan" } };
		}
		await requireActiveParentResearch(cwd, previous.run_id, "research branch lease");
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
	}, {
		beforePersist: async (nextState) => {
			if (PARENT_RESEARCH_WORKFLOW) await projectResearchAggregate(cwd, context.run_id, nextState, "active");
		},
	});
	return result;
}

/** Release only the exact lease acquired for this branch. Used when a multi-arm
 * dispatch cannot acquire all of its leases before any child is launched. */
export async function releaseResearchBranchLease(cwd: string, context: PlanContextV1, leaseId: string): Promise<boolean> {
	if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id)) return false;
	const released = await mutatePlan<boolean>(cwd, async (previous) => {
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
	}, {
		beforePersist: async (nextState) => {
			if (PARENT_RESEARCH_WORKFLOW) await projectResearchAggregate(cwd, context.run_id, nextState, "active");
		},
	});
	return released;
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

/** Models sometimes report a productive branch as `done` even though the
 * process-local retrieval receipt says that the bounded search/read was
 * truncated, failed, or otherwise incomplete. This is a recoverable protocol
 * mistake: retain the source leads, but downgrade the claim to `deferred` so
 * the parent can validate the evidence rather than accepting a false terminal
 * success. We never upgrade an incomplete receipt to `done`. */
function normalizePartialDoneReport(report: BranchReportV1, ownCoverage?: ResearchCoverageObservation): BranchReportV1 {
	if (report.status !== "done" || report.source_leads.length === 0) return report;
	const partial = report.evidence_gaps.length > 0 || report.coverage?.complete === false || ownCoverage?.incomplete === true;
	if (!partial) return report;
	const base = report.coverage ?? {
		strategy: report.children.length > 0 ? "hybrid" as const : "direct" as const,
		scope: "bounded" as const,
		returned_count: ownCoverage?.returned_count ?? 0,
		truncated: false, budget_exhausted: false, failed: false, complete: false,
	};
	const coverage = {
		...base,
		truncated: base.truncated || ownCoverage?.truncated === true,
		budget_exhausted: base.budget_exhausted || ownCoverage?.budget_exhausted === true,
		failed: base.failed || ownCoverage?.failed === true,
		complete: false,
	};
	// The schema requires every incomplete receipt to name a bounded reason. If
	// neither the model nor the retrieval observer supplied one, conservatively
	// classify the unresolved envelope as exhausted rather than inventing a
	// successful completion. This does not add budget or permit another call.
	if (!coverage.truncated && !coverage.budget_exhausted && !coverage.failed) coverage.budget_exhausted = true;
	const evidence_gaps = [...new Set([
		...report.evidence_gaps,
		"partial retrieval evidence requires parent validation before settlement",
	])].slice(0, 8);
	return {
		...report,
		status: "deferred",
		evidence_gaps,
		coverage,
		defer: report.defer ?? {
			value: "Retain the bounded source leads for parent synthesis",
			risk: "The incomplete retrieval may not support the final claim",
			rationale: "The branch produced usable leads but its coverage receipt is incomplete; the parent must reread and validate them.",
		},
	};
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
			const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
			// An explicit allowlist is authoritative even after a restart; only the
			// ordinary derived surface may regain the flat planner tools here.
			if (keepPlanTools && !explicit) for (const name of ["plan_write", "plan_update"]) if (registered.has(name)) restored.add(name);
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
		const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
		if (keepPlanTools && !explicit) {
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
			if (!previous) await rejectUnreadablePlanState(ctx.cwd);
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
			if (previous.profile?.name === "deep-research") await requireActiveParentResearch(ctx.cwd, previous.run_id, "plan_update");
			const applied = applyPlanDeltas(previous.items, params.deltas as PlanDelta[]);
			if (!applied.ok) rejectPlanTool(`plan_update rejected: ${applied.errors.join("; ")}`);
			// Depth-two scouts are terminal evidence leaves, not independently
			// dispatchable work. Reopening one would leave a pending node that no
			// runtime path can execute (only depth-one research branches own leases
			// and may mint a fresh bounded child set). Reopen the owning branch
			// instead; its retry epoch and branch report replace the leaf set
			// transactionally.
			if (previous.profile?.name === "deep-research") {
				for (const prior of previous.items) {
					if (prior.kind !== "research_leaf" || !graphTerminal(prior)) continue;
					const next = (applied.items as PlanItem[]).find((item) => item.id === prior.id);
					if (next && !graphTerminal(next)) rejectPlanTool(`plan_update rejected: research leaves cannot be reopened independently; reopen owning branch ${prior.parent_id ?? "(unknown)"}`);
				}
			}
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
					delete next.claim_ids;
					delete next.evidence_gaps;
					delete next.defer;
					return next;
				}
				if (!item.lease || !graphTerminal(item)) return item;
				const next = { ...item };
				delete next.lease;
				return next;
			}), ...((applied.items as PlanItem[]).every((item) => graphTerminal(item)) ? { head_terminal_at: previous.head_terminal_at ?? isoNow() } : { head_terminal_at: undefined }) };
			validateStateSize(state);
			return { state, result: { state, changed: applied.changed, idempotent: applied.idempotent } };
		}, {
			beforePersist: async (nextState) => {
				if (PARENT_RESEARCH_WORKFLOW && nextState.profile?.name === "deep-research") await projectResearchAggregate(ctx.cwd, nextState.run_id, nextState, "active");
			},
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
	const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
	for (const name of ["plan_write", "plan_update", "plan_expand", "plan_settle", ...(DEEP_RESEARCH_PLANNING ? ["research_round"] : []), ...(PARENT_RESEARCH_WORKFLOW ? ["research_finish"] : [])]) {
		if ((!explicit || active.includes(name)) && api.getAllTools().some((tool) => tool.name === name) && !active.includes(name)) active.push(name);
	}
	api.setActiveTools(active);
}

function graphLifecycleAvailable(): boolean {
	if (!api || !PLAN_GRAPH) return false;
	const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
	if (!explicit) return true;
	const active = new Set(api.getActiveTools());
	// Starting a graph needs a way to update branches, expand generic graph
	// structure, and settle the parent. Under an explicit allowlist, refuse the
	// start rather than silently adding omitted tools after the graph is written.
	const required = ["plan_update", "plan_expand", "plan_settle"];
	if (DEEP_RESEARCH_PLANNING) required.push("research_round");
	if (PARENT_RESEARCH_WORKFLOW) required.push("research_finish");
	return required.every((name) => active.has(name));
}

const ResearchRoundClaimSchema = Type.Object({
	claim_id: Type.String({ minLength: 1, maxLength: 96 }), text: Type.String({ minLength: 1, maxLength: 500 }),
	required: Type.Boolean(), missing: Type.String({ minLength: 1, maxLength: 300 }), why: Type.String({ minLength: 1, maxLength: 300 }),
	next_action: Type.String({ minLength: 1, maxLength: 300 }),
});
const ResearchRoundQuerySchema = Type.Object({ query_id: Type.String({ minLength: 1, maxLength: 96 }), claim_id: Type.String({ minLength: 1, maxLength: 96 }), query: Type.String({ minLength: 1, maxLength: 500 }) });
const ResearchRoundLeadSchema = Type.Object({
	lead_id: Type.String({ minLength: 1, maxLength: 96 }), url: Type.String({ minLength: 1, maxLength: 1_999 }),
	claim_ids: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { minItems: 1, maxItems: 16 }),
	triage: Type.Union([Type.Literal("selected"), Type.Literal("rejected"), Type.Literal("duplicate")]), reason: Type.Optional(Type.String({ maxLength: 300 })),
});
const ResearchRoundReadSchema = Type.Object({
	url: Type.String({ minLength: 1, maxLength: 1_999 }), phase: Type.Union([Type.Literal("discovery"), Type.Literal("parent_validation")]),
	method: Type.Union([Type.Literal("ketch"), Type.Literal("jina")]), outcome: Type.Union([Type.Literal("completed"), Type.Literal("failed"), Type.Literal("truncated"), Type.Literal("blocked")]),
	truncated: Type.Boolean(), parent_validated: Type.Boolean(),
});
const ResearchRoundCardSchema = Type.Object({
	card_id: Type.String({ minLength: 32, maxLength: 32 }), original_url: Type.String({ minLength: 1, maxLength: 1_999 }), content_sha256: Type.String({ minLength: 64, maxLength: 64 }),
	claim_ids: Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { minItems: 1, maxItems: 16 }), truncated: Type.Boolean(), parent_validated: Type.Boolean(),
	retrieval_method: Type.Union([Type.Literal("ketch"), Type.Literal("jina")]),
});
const ResearchRoundConflictSchema = Type.Object({
	conflict_id: Type.String({ minLength: 1, maxLength: 96 }), claim_id: Type.String({ minLength: 1, maxLength: 96 }),
	card_ids: Type.Array(Type.String({ minLength: 32, maxLength: 32 }), { minItems: 2, maxItems: 8 }),
	status: Type.Union([Type.Literal("open"), Type.Literal("resolved"), Type.Literal("deferred")]), note: Type.Optional(Type.String({ maxLength: 300 })),
});
const ResearchRoundGapSchema = Type.Object({
	gap_id: Type.String({ minLength: 1, maxLength: 96 }), claim_id: Type.String({ minLength: 1, maxLength: 96 }), missing: Type.String({ minLength: 1, maxLength: 300 }),
	why: Type.String({ minLength: 1, maxLength: 300 }), next_action: Type.String({ minLength: 1, maxLength: 300 }),
	status: Type.Union([Type.Literal("open"), Type.Literal("resolved"), Type.Literal("blocked"), Type.Literal("deferred")]),
});
const ResearchRoundDeferralSchema = Type.Object({ claim_id: Type.String({ minLength: 1, maxLength: 96 }), value: Type.String({ minLength: 1, maxLength: 200 }), risk: Type.String({ minLength: 1, maxLength: 200 }), rationale: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }) });
const ResearchRoundParameters = Type.Object({
	action: Type.Union([Type.Literal("start"), Type.Literal("record"), Type.Literal("inspect"), Type.Literal("settle")]),
	run_id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })), round_id: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
	claim_obligations: Type.Optional(Type.Array(ResearchRoundClaimSchema, { minItems: 1, maxItems: 16 })), selected_gaps: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 96 }), { maxItems: RESEARCH_ROUND_MAX_GAPS })),
	queries: Type.Optional(Type.Array(ResearchRoundQuerySchema, { maxItems: 3 })), source_leads: Type.Optional(Type.Array(ResearchRoundLeadSchema, { maxItems: 16 })),
	reads: Type.Optional(Type.Array(ResearchRoundReadSchema, { maxItems: 10 })), evidence_cards: Type.Optional(Type.Array(ResearchRoundCardSchema, { maxItems: 32 })),
	conflicts: Type.Optional(Type.Array(ResearchRoundConflictSchema, { maxItems: 12 })), gaps: Type.Optional(Type.Array(ResearchRoundGapSchema, { maxItems: RESEARCH_ROUND_MAX_GAPS })),
	proposed_next_action: Type.Optional(Type.Union([Type.Literal("search"), Type.Literal("read"), Type.Literal("validate"), Type.Literal("synthesize"), Type.Literal("stop"), Type.Literal("escalate")])),
	optional_deferrals: Type.Optional(Type.Array(ResearchRoundDeferralSchema, { maxItems: 16 })), note: Type.Optional(Type.String({ maxLength: 500 })), summary: Type.Optional(Type.String({ maxLength: 300 })),
});

type ResearchRoundToolParams = {
	action: "start" | "record" | "inspect" | "settle"; run_id?: string; round_id?: string; claim_obligations?: ClaimObligationV1[];
	selected_gaps?: string[]; queries?: ResearchRoundProposalV1["queries"]; source_leads?: ResearchRoundProposalV1["source_leads"];
	reads?: ResearchRoundProposalV1["reads"]; evidence_cards?: EvidenceCardRefV1[]; conflicts?: ResearchRoundProposalV1["conflicts"];
	gaps?: EvidenceGapV1[]; proposed_next_action?: ResearchRoundProposalV1["proposed_next_action"];
	optional_deferrals?: Array<{ claim_id: string; value: string; risk: string; rationale: string }>; note?: string; summary?: string;
};

async function loadResearchRound(cwd: string, runId?: string): Promise<{ path: string; ledger: ResearchRoundLedger } | null> {
	const shared = globalThis as Record<string, unknown>;
	const state = await readState(cwd);
	const selectedRun = runId ?? state?.run_id;
	if (!selectedRun || (state && state.run_id !== selectedRun)) return null;
	// The path is derived from the authenticated run identity every time. A
	// stale process-global pointer must never select another run's ledger.
	const path = researchRoundPath(cwd, selectedRun, process.env);
	const aggregate = PARENT_RESEARCH_WORKFLOW ? await readResearchAggregate(researchAggregatePath(cwd, selectedRun, process.env)) : null;
	const aggregateRaw = aggregate?.evidence_round;
	const raw = aggregateRaw && validateResearchRoundLedger(aggregateRaw) ? aggregateRaw : await readResearchRoundLedger(path);
	if (!raw || raw.run_id !== selectedRun || typeof raw !== "object" || !validateResearchRoundLedger(raw)) return null;
	shared[RESEARCH_ROUND_PATH_KEY] = path;
	return { path, ledger: ResearchRoundLedger.fromState(raw as any) };
}

/** Project a graph/evidence transition into the parent aggregate before
 * publishing either compatibility view. The caller holds the relevant file
 * lock; this ordering makes the aggregate authoritative even if the later
 * graph or ledger write fails. */
async function projectResearchAggregateSnapshot(cwd: string, runId: string, graph: PlanState, round: ResearchRoundLedgerStateV1, phase?: ResearchAggregatePhase): Promise<void> {
	if (!PARENT_RESEARCH_WORKFLOW) return;
	if (!graph || graph.run_id !== runId || !round || round.run_id !== runId) throw new Error("research aggregate migration refused: graph/round pair is missing or has mismatched identity");
	const path = researchAggregatePath(cwd, runId, process.env);
	const existing = await readResearchAggregate(path);
	if (!existing) {
		await writeResearchAggregate(path, migrateResearchPair(graph, round));
	} else {
		await mutateResearchAggregate(path, (state) => ({
			// A freshness projection must never resurrect a run that was explicitly
			// paused, blocked, or placed at the extension boundary. Only terminal
			// requests may advance a non-active lifecycle phase.
			state: transitionAggregate(state, { graph, evidence_round: round, phase: phase && phase !== "active" ? phase : state.phase, budget: (round.budget as any).consumed ?? { searches: 0, reads: 0, validation_reads: 0 } }),
			result: undefined,
		}));
	}
	(globalThis as Record<string, unknown>)[RESEARCH_AGGREGATE_PATH_KEY] = path;
}

/** Project a graph transition using the latest authoritative evidence ledger. */
async function projectResearchAggregate(cwd: string, runId: string, graph: PlanState, phase?: ResearchAggregatePhase): Promise<void> {
	if (!PARENT_RESEARCH_WORKFLOW) return;
	const aggregatePath = researchAggregatePath(cwd, runId, process.env);
	const existing = await readResearchAggregate(aggregatePath);
	// Once an aggregate exists it is authoritative. A compatibility ledger may
	// still be stale when its later view write was interrupted, so never project
	// that older snapshot back over the durable evidence-round state.
	const round = existing
		? (validateResearchRoundLedger(existing.evidence_round) ? existing.evidence_round as ResearchRoundLedgerStateV1 : null)
		: await readResearchRoundLedger(researchRoundPath(cwd, runId, process.env));
	if (!round || round.run_id !== runId) throw new Error("research aggregate migration refused: research round ledger is missing or malformed");
	await projectResearchAggregateSnapshot(cwd, runId, graph, round, phase);
}

/** Project a ledger transition using the current compatibility graph. */
async function projectResearchRoundAggregate(cwd: string, runId: string, round: ResearchRoundLedgerStateV1, phase?: ResearchAggregatePhase): Promise<void> {
	if (!PARENT_RESEARCH_WORKFLOW) return;
	const aggregatePath = researchAggregatePath(cwd, runId, process.env);
	const existing = await readResearchAggregate(aggregatePath);
	// Mirror the graph from the aggregate when available. Falling back to the
	// compatibility file is only safe during initial creation, before an
	// authoritative aggregate exists; otherwise an interrupted graph write could
	// regress a newer graph revision during an unrelated ledger transition.
	const graph = existing ? migrateState(existing.graph) : await readCompatibilityState(cwd);
	if (!graph || graph.run_id !== runId) throw new Error("research aggregate migration refused: compatibility graph is missing or malformed");
	await projectResearchAggregateSnapshot(cwd, runId, graph, round, phase);
}

function defaultResearchObligation(request: string): ClaimObligationV1 {
	return { claim_id: claimIdForText(request), text: cleanText(request).slice(0, 500), required: true, status: "open", missing: "An authoritative parent-validated source is required.", why: "The research request must be supported by evidence before synthesis.", next_action: "Search for an authoritative source." };
}

function roundTelemetry(ledger: ResearchRoundLedger, round: { consumed: { searches: number; reads: number; validation_reads: number }; duplicate_count: number; status: string; next_action: string }): void {
	const state = ledger.state;
	record("research", "round", {
		round: state.rounds.length, status: round.status, next_action: round.next_action,
		consumed_searches: round.consumed.searches, consumed_reads: round.consumed.reads, validation_reads: round.consumed.validation_reads,
		duplicate_count: round.duplicate_count, open_gaps: state.gaps.filter((gap) => gap.status !== "resolved").length, conflicts: state.conflicts.filter((conflict) => conflict.status === "open").length,
	});
}

function parentEvidenceCardIsAuthoritative(card: EvidenceCardRefV1): boolean {
	const raw = (globalThis as Record<string, unknown>)[RESEARCH_EVIDENCE_CARDS_KEY];
	if (!Array.isArray(raw)) return false;
	return raw.some((entry) => {
		if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
		const value = entry as Record<string, unknown>;
		if (value.parent_validated !== true || value.truncated === true || value.content_sha256 !== card.content_sha256 || typeof value.original_url !== "string" || !Array.isArray(value.claim_ids)) return false;
		try {
			const claimIds = value.claim_ids.filter((claim): claim is string => typeof claim === "string");
			return canonicalResearchUrl(value.original_url) === card.original_url && card.claim_ids.every((claim) => claimIds.includes(claim));
		} catch { return false; }
	});
}

function requireAuthoritativeParentCards(cards: readonly EvidenceCardRefV1[]): void {
	for (const card of cards) if (card.parent_validated && !card.truncated && !parentEvidenceCardIsAuthoritative(card)) rejectPlanTool("research_round rejected: parent evidence card is not backed by a verified parent research note");
}

const researchPlanStart = defineTool({
	name: "research_plan_start", label: "Start Deep Research Plan",
	description: "Start a headless, executing deep-research plan graph for a complex research request. Straightforward fact lookups should not use this tool.",
	promptSnippet: "research_plan_start: create up to three evidence branches under one global discovery budget",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Use only for contested, comparative, multi-part, or delegated research. Allocate at most 3 searches and 5 reads across all branches.",
		...(PARENT_RESEARCH_WORKFLOW
			? ["The parent owns these branches and should research them directly. Delegate at most one bounded branch only when isolation clearly improves the answer; do not dispatch a child merely because a context was returned."]
			: ["Copy the returned plan_context exactly into the matching research-planner subagent call.", "After a successful start, immediately dispatch one research-planner child for each returned context; do not call research_plan_start again or spend parent retrieval budget first."]),
	] : undefined,
		parameters: Type.Object({
			request: Type.String({ minLength: 1, maxLength: 1_000 }),
			summary: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }),
			claim_obligations: Type.Optional(Type.Array(ResearchRoundClaimSchema, { minItems: 1, maxItems: 16 })),
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
		if (!graphLifecycleAvailable()) rejectPlanTool("research_plan_start rejected: explicit tool selection excludes graph lifecycle tools (plan_update, plan_expand, plan_settle)");
		let roundPath = "";
		const state = await mutatePlan(ctx.cwd, async (previous) => {
			if (!previous) await rejectUnreadablePlanState(ctx.cwd);
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
				research_round_contract: "v1",
			};
			validateStateSize(next);
			return { state: next, result: next };
		}, {
			beforePersist: async (nextState) => {
				// Prepare the round ledger and (for the parent profile) its aggregate
				// before publishing the executable graph. The plan lock spans both
				// steps, so a failed dependent write leaves no runnable graph behind.
				const obligations = params.claim_obligations?.length ? params.claim_obligations.map((claim) => ({ ...claim, status: "open" as const })) : [defaultResearchObligation(params.request)];
				const roundLedger = new ResearchRoundLedger({ run_id: nextState.run_id, obligations, budget: { searches: 3, reads: 5, validation_reads: 5 } });
				// In the parent-owned profile these root budgets are planning hints, not
				// child reservations. Reserving them would make every local branch look
				// like an in-flight delegated process and permanently block settlement.
				if (!PARENT_RESEARCH_WORKFLOW) {
					for (const item of nextState.items) roundLedger.reserveChild(item.owner_ref!, { searches: item.budget!.allocated.searches, reads: item.budget!.allocated.reads, validation_reads: 0 });
				}
				roundPath = researchRoundPath(ctx.cwd, nextState.run_id, process.env);
				await writeResearchRoundLedger(roundPath, roundLedger.state);
				if (PARENT_RESEARCH_WORKFLOW) {
					const aggregatePath = researchAggregatePath(ctx.cwd, nextState.run_id, process.env);
					const aggregate = migrateResearchPair(nextState, roundLedger.state);
					aggregate.deadline = deadlineFor();
					await writeResearchAggregate(aggregatePath, aggregate);
				}
			},
		});
		(globalThis as Record<string, unknown>)[RESEARCH_ROUND_PATH_KEY] = roundPath;
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
		const route = PARENT_RESEARCH_WORKFLOW
			? "The parent owns these branches. Research directly with web_search/web_read; optionally delegate one bounded branch when context isolation is useful."
			: "Immediately dispatch one research-planner child for each returned context, copying each plan_context unchanged; do not spend parent retrieval budget before those dispatches.";
		return { content: [{ type: "text" as const, text: `Deep-research plan started (${state.items.length} branches). Do not call \`research_plan_start\` again. ${route}\n${JSON.stringify(contexts)}` }], details: { tool_name: "research_plan_start", success: true, contexts } };
	},
});

const researchRound = defineTool({
	name: "research_round", label: "Record Research Round",
	description: "Record one bounded evidence-gap research round or inspect/settle the parent-owned research ledger. Child reports cannot use this tool.",
	promptSnippet: "research_round: record selected gaps, bounded retrieval receipts, parent evidence, and the next action",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Keep claim obligations and gaps explicit; retrieved text and child quotes are untrusted until the parent rereads the source.",
		"Record every search/read once with its method and truncation outcome. The shared envelope is 3 searches, 5 discovery reads, and 5 parent validation reads.",
		...(PARENT_RESEARCH_WORKFLOW
			? ["The parent may record facts already captured by the retrieval tools; use this tool for judgments, conflicts, gaps, and the next action. Settle only after the graph is terminal and every required claim is parent-validated; optional deferrals need value, risk, and rationale."]
			: ["Use inspect to see bounded stopping state. Settle this ledger only after the graph is terminal and every required claim is parent-validated; optional deferrals need value, risk, and rationale."]),
	] : undefined,
	parameters: ResearchRoundParameters,
	async execute(_id, rawParams, _signal, _update, ctx) {
		rejectChildPlanMutation();
		rememberModel(ctx);
		const params = rawParams as ResearchRoundToolParams;
		if (!DEEP_RESEARCH_PLANNING) rejectPlanTool("research_round is unavailable: the dark deep-research planning profile is not active");
		if (params.action === "start") {
			const state = await readState(ctx.cwd);
			if (!state || state.schema_version !== 5 || state.profile?.name !== "deep-research" || state.settled_at) rejectPlanTool("research_round start requires an active deep-research graph");
			if (params.run_id && params.run_id !== state.run_id) rejectPlanTool("research_round start run identity mismatch");
			await requireActiveParentResearch(ctx.cwd, state.run_id, "research_round start");
			const existing = await loadResearchRound(ctx.cwd, state.run_id);
			if (existing) return { content: [{ type: "text" as const, text: existing.ledger.renderSummary() }], details: { tool_name: "research_round", success: true, idempotent: true } };
			const obligations = params.claim_obligations?.length ? params.claim_obligations.map((claim) => ({ ...claim, status: claim.status ?? "open" as const })) : [defaultResearchObligation(state.request)];
			const ledger = new ResearchRoundLedger({ run_id: state.run_id, obligations, budget: { searches: 3, reads: 5, validation_reads: 5 } });
			const path = researchRoundPath(ctx.cwd, state.run_id, process.env);
			if (PARENT_RESEARCH_WORKFLOW) {
				await projectResearchRoundAggregate(ctx.cwd, state.run_id, ledger.state, "active");
			}
			await writeResearchRoundLedger(path, ledger.state);
			(globalThis as Record<string, unknown>)[RESEARCH_ROUND_PATH_KEY] = path;
			return { content: [{ type: "text" as const, text: `Research round ledger started for ${state.run_id}. Record a bounded round before retrieval.\n${ledger.renderSummary()}` }], details: { tool_name: "research_round", success: true, idempotent: false } };
		}
		const loaded = await loadResearchRound(ctx.cwd, params.run_id);
		if (!loaded) rejectPlanTool("research_round rejected: no valid parent research ledger exists");
		const { path, ledger } = loaded;
		if (params.action === "inspect") return { content: [{ type: "text" as const, text: ledger.renderSummary() }], details: { tool_name: "research_round", success: true, idempotent: true } };
		if (params.action === "record") {
			if (!params.round_id || !params.proposed_next_action) rejectPlanTool("research_round record requires round_id and proposed_next_action");
			await requireActiveParentResearch(ctx.cwd, ledger.runId, "research_round record");
			const proposal: ResearchRoundProposalV1 = {
				schema: "pi.research-round/v1", run_id: ledger.runId, round_id: params.round_id,
				selected_gaps: params.selected_gaps ?? [], queries: params.queries ?? [], source_leads: params.source_leads ?? [], reads: params.reads ?? [],
				evidence_cards: params.evidence_cards ?? [], conflicts: params.conflicts ?? [], gaps: params.gaps ?? [], proposed_next_action: params.proposed_next_action, ...(params.note === undefined ? {} : { note: params.note }),
			};
			requireAuthoritativeParentCards(proposal.evidence_cards);
			const result = await mutateResearchRoundLedger(path, (latest) => {
				if (latest.runId !== proposal.run_id) throw new Error("research round run identity mismatch");
				const round = latest.recordRound(proposal);
				return { round, state: latest.state, summary: latest.renderSummary() };
			}, {
				beforePersist: async (nextRound) => {
					if (PARENT_RESEARCH_WORKFLOW) {
						const phase = nextRound.status === "blocked" ? "blocked" : "active";
						await projectResearchRoundAggregate(ctx.cwd, ledger.runId, nextRound, phase);
					}
				},
			});
			const committedLedger = ResearchRoundLedger.fromState(result.state);
			roundTelemetry(committedLedger, result.round);
			return { content: [{ type: "text" as const, text: `Research round ${result.round.round_id} recorded: ${result.round.status}; next action=${result.round.next_action}.\n${result.summary}` }], details: { tool_name: "research_round", success: true, round_id: result.round.round_id, status: result.round.status } };
		}
		await requireFinishableParentResearch(ctx.cwd, ledger.runId);
		const result = await mutateResearchRoundLedger(path, async (latest) => {
			if (latest.runId !== ledger.runId) throw new Error("research round run identity mismatch");
			const graph = await readState(ctx.cwd);
			const graphTerminalNow = Boolean(graph && graph.run_id === latest.runId && graph.items.every((item) => graphTerminal(item)));
			requireAuthoritativeParentCards(latest.state.evidence_cards);
			const settled = latest.settle({ graph_terminal: graphTerminalNow, optional_deferrals: params.optional_deferrals ?? [], reason: params.summary ?? "Parent evidence obligations satisfied." });
			return { state: settled, summary: latest.renderSummary() };
		}, {
			beforePersist: async (nextRound) => {
				if (PARENT_RESEARCH_WORKFLOW) await projectResearchRoundAggregate(ctx.cwd, ledger.runId, nextRound, "settled");
			},
		});
		return { content: [{ type: "text" as const, text: `Research evidence is settled for ${ledger.runId}. The parent may now call plan_settle.\n${result.summary}` }], details: { tool_name: "research_round", success: true, settled: true }, };
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
			if (previous.profile?.name === "deep-research") await requireActiveParentResearch(ctx.cwd, previous.run_id, "plan_expand");
			const next = expandGraph(previous as GraphPlanState, params.parent_item_id, params.children as BranchChildInput[]);
			return { state: next, result: next };
	}, {
		beforePersist: async (nextState) => {
			if (PARENT_RESEARCH_WORKFLOW && nextState.profile?.name === "deep-research") await projectResearchAggregate(ctx.cwd, nextState.run_id, nextState, "active");
		},
	});
	planEvent("expand", state.run_id, { parent_item_id: params.parent_item_id, children: params.children.length, open_items: openItemCount(state) });
		return { content: [{ type: "text" as const, text: `Plan branch expanded: ${params.parent_item_id} now has ${childrenOf(state.items, params.parent_item_id).length} child node(s).` }], details: { tool_name: "plan_expand", success: true } };
	},
});

const planSettle = defineTool({
	name: "plan_settle", label: "Settle Plan",
	description: "Request terminal settlement after required nodes and parent-owned evidence verification are complete. Deep research must include the useful final answer to deliver to the user.",
	promptSnippet: "plan_settle: close a verified graph plan; include the final answer for deep research",
	parameters: Type.Object({
		summary: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }),
		final_answer: Type.Optional(Type.String({ minLength: 1, maxLength: 16_000 })),
	}),
	async execute(_id, params, _signal, _update, ctx) {
		rejectChildPlanMutation();
		let settledFinalAnswer: string | undefined;
		const state = await mutatePlan(ctx.cwd, async (previous) => {
			if (!previous || previous.schema_version !== 5) rejectPlanTool("plan_settle requires an active graph plan");
			if (previous.settled_at) rejectPlanTool("plan_settle rejected: plan is already settled and immutable");
			const verifiedRaw = (globalThis as Record<string, unknown>).__pi_plan_validation_urls;
			const verified = new Set(Array.isArray(verifiedRaw) ? verifiedRaw.filter((value): value is string => typeof value === "string") : []);
			const rawCards = (globalThis as Record<string, unknown>)[RESEARCH_EVIDENCE_CARDS_KEY];
			const evidenceCards: ParentEvidenceCard[] = Array.isArray(rawCards)
				? rawCards.flatMap((card): ParentEvidenceCard[] => {
					if (!card || typeof card !== "object" || Array.isArray(card)) return [];
					const value = card as Record<string, unknown>;
					return typeof value.card_id === "string" && /^[a-f0-9]{32}$/.test(value.card_id) && typeof value.original_url === "string" && Array.isArray(value.claim_ids) &&
						typeof value.truncated === "boolean" && typeof value.parent_validated === "boolean" &&
						value.claim_ids.every((id) => typeof id === "string")
						? [{ card_id: value.card_id, original_url: value.original_url, claim_ids: value.claim_ids as string[], truncated: value.truncated, parent_validated: value.parent_validated }]
						: [];
				})
				: [];
				const errors = settleErrors(previous as GraphPlanState, verified, evidenceCards);
				if (errors.length) {
				const claimRepair = errors.some((error) => /delegated source (?:lacks|not parent-verified)|claim evidence card|claim obligation/i.test(error))
					? " Repair delegated evidence by rereading each unverified URL only once, then call research_note with the delegated claim text copied exactly (do not shorten or rewrite it) before retrying; do not search or redispatch."
					: "";
					rejectPlanTool(`plan_settle rejected: ${errors.join("; ")}.${claimRepair}`);
				}
				if (previous.profile?.name === "deep-research" && previous.research_round_contract === "v1") {
					const roundPath = researchRoundPath(ctx.cwd, previous.run_id, process.env);
					const aggregate = PARENT_RESEARCH_WORKFLOW ? await readResearchAggregate(researchAggregatePath(ctx.cwd, previous.run_id, process.env)) : null;
					const roundRaw = aggregate ? aggregate.evidence_round : await readResearchRoundLedger(roundPath);
					if (!roundRaw) rejectPlanTool("plan_settle rejected: research evidence ledger is missing or malformed; record and settle the parent ledger first");
					if (!validateResearchRoundLedger(roundRaw)) rejectPlanTool("plan_settle rejected: research evidence ledger is malformed; inspect and restart the parent round");
					const roundLedger = ResearchRoundLedger.fromState(roundRaw);
					const roundCheck = roundLedger.settlementCheck({ graph_terminal: previous.items.every((item) => graphTerminal(item)) });
					if (roundRaw.status !== "settled" || !roundCheck.ready) rejectPlanTool(`plan_settle rejected: research evidence is not settled (${roundCheck.reasons.join(", ") || "call research_round settle after parent validation"})`);
					const finalAnswer = cleanText(params.final_answer);
					if (!finalAnswer || utf8Bytes(finalAnswer) > 16_000) rejectPlanTool("plan_settle rejected: deep-research settlement requires a bounded final_answer");
					const citationUrls = evidenceCards.flatMap((card) => {
						if (!card.parent_validated || card.truncated) return [];
						try { return [canonicalResearchUrl(card.original_url)]; } catch { return []; }
					});
					const citationAudit = auditResearchCitations(finalAnswer, citationUrls);
					if (citationAudit.unverified.length || citationAudit.explicitlyUnverified.length) rejectPlanTool("plan_settle rejected: final_answer cites a URL that the parent has not validated");
					settledFinalAnswer = finalAnswer;
				}
				const next = { ...previous, summary: cleanText(params.summary), settled_at: isoNow() };
			return { state: next, result: next };
		}, {
			beforePersist: async (nextState) => {
				if (PARENT_RESEARCH_WORKFLOW && nextState.profile?.name === "deep-research") await projectResearchAggregate(ctx.cwd, nextState.run_id, nextState, "settled");
			},
		});
		const active = api?.getActiveTools() ?? [];
			api?.setActiveTools(active.filter((name) => !["plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "research_round", "research_finish"].includes(name)));
		planEvent("settled", state.run_id, { items: state.items.length, deferred: state.items.filter((item) => item.status === "deferred").length });
		const message = settledFinalAnswer
			? `Final answer:\n${settledFinalAnswer}\n\nResearch plan settled. No further research or delegation will be scheduled.`
			: "Plan settled. Planner guidance and task-scoped plan tools are no longer active.";
		return { content: [{ type: "text" as const, text: message }], details: { tool_name: "plan_settle", success: true, ...(settledFinalAnswer ? { final_answer: true } : {}) }, terminate: true };
	},
});

async function finalizeParentResearchGraph(
	cwd: string,
	runId: string,
	optionalDeferrals: ResearchRoundToolParams["optional_deferrals"] | undefined,
): Promise<void> {
	const loaded = await loadResearchRound(cwd, runId);
	if (!loaded) rejectPlanTool("research_finish rejected: no valid parent research ledger exists");
	const check = loaded.ledger.settlementCheck({ graph_terminal: true, optional_deferrals: optionalDeferrals ?? [] });
	if (!check.ready) rejectPlanTool(`research_finish rejected: evidence is not ready (${check.reasons.join(", ")})`);
	const cards = loaded.ledger.state.evidence_cards.filter((card) => card.parent_validated && !card.truncated);
	if (cards.length === 0) rejectPlanTool("research_finish rejected: no complete parent-validated evidence cards exist");
	const urls = [...new Set(cards.map((card) => card.original_url))];
	const claimIds = [...new Set(cards.flatMap((card) => card.claim_ids))];
	const coverage = {
		strategy: "direct" as const, scope: "bounded" as const, returned_count: cards.length,
		truncated: false, budget_exhausted: false, failed: false, complete: true,
	};
	await mutatePlan(cwd, async (previous) => {
		if (!previous || previous.run_id !== runId || previous.profile?.name !== "deep-research" || previous.settled_at) {
			rejectPlanTool("research_finish rejected: the parent graph changed or is no longer active");
		}
		const roots = previous.items.filter((item) => item.kind === "research_branch" && item.parent_id === undefined && !graphTerminal(item));
		if (roots.length === 0) return { result: undefined };
		// Parent-owned branches do not require a second model call just to copy
		// receipts into graph metadata. The validated ledger is authoritative; the
		// graph receives a compact derived view immediately before terminal checks.
		const items = previous.items.map((item) => {
			if (!roots.some((root) => root.id === item.id)) return item;
			return { ...item, status: "done" as const, coverage, source_leads: urls, claim_ids: claimIds, evidence_gaps: [] };
		});
		const state = { ...previous, items, head_terminal_at: previous.head_terminal_at ?? isoNow() };
		validateStateSize(state);
		return { state, result: undefined };
	}, {
		beforePersist: async (nextState) => {
			if (PARENT_RESEARCH_WORKFLOW) await projectResearchAggregate(cwd, runId, nextState, "active");
		},
	});
}

const researchFinish = defineTool({
	name: "research_finish", label: "Finish Research",
	description: "Validate the parent-owned research ledger and graph, then settle them and deliver one bounded final answer.",
	promptSnippet: "research_finish: validate and settle research, then deliver the answer",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Use only after every required claim is parent-validated and the graph is terminal; optional deferrals must include value, risk, and rationale.",
		"This replaces the separate research_round settle and plan_settle calls for the parent-owned workflow.",
	] : undefined,
	parameters: Type.Object({
		run_id: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
		summary: Type.String({ minLength: 1, maxLength: PLAN_DEFER_FIELD_MAX_BYTES }),
		final_answer: Type.String({ minLength: 1, maxLength: 16_000 }),
		optional_deferrals: Type.Optional(Type.Array(ResearchRoundDeferralSchema, { maxItems: 16 })),
	}),
	async execute(id, params, signal, update, ctx) {
		rejectChildPlanMutation();
		if (!PARENT_RESEARCH_WORKFLOW) rejectPlanTool("research_finish is unavailable: the parent research workflow is not active");
		const state = await readState(ctx.cwd);
		if (!state || state.schema_version !== 5 || state.profile?.name !== "deep-research" || state.settled_at) {
			rejectPlanTool("research_finish requires an active deep-research graph");
		}
		const runId = params.run_id ?? state.run_id;
		if (runId !== state.run_id) rejectPlanTool("research_finish rejected: run identity mismatch");
		await requireFinishableParentResearch(ctx.cwd, runId);
		await finalizeParentResearchGraph(ctx.cwd, runId, params.optional_deferrals);
		// Keep the two existing validators as the implementation boundary while
		// exposing one model-facing terminal operation. The ledger settles first;
		// plan_settle then validates the now-settled ledger, citations, deferrals,
		// and terminal graph before it writes the final state and terminates.
		// The ledger is durable before the final graph/citation checks. If a
		// process or validator fails after that boundary, a retry must resume at
		// plan_settle rather than attempting to settle an immutable ledger again.
		const latest = await loadResearchRound(ctx.cwd, runId);
		if (!latest || latest.ledger.state.status !== "settled") {
			await researchRound.execute(id, {
				action: "settle", run_id: runId, summary: params.summary,
				optional_deferrals: params.optional_deferrals,
			}, signal, update, ctx);
		}
		return await planSettle.execute(id, {
			summary: params.summary, final_answer: params.final_answer,
		}, signal, update, ctx);
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
		let report: BranchReportV1 = { v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, ...params } as BranchReportV1;
		let terminal = ["done", "blocked", "deferred"].includes(report.status);
		const shared = globalThis as Record<string, unknown>;
		const own = shared.__pi_research_state as { searches?: unknown; reads?: unknown } | undefined;
		const ownUsage = { searches: typeof own?.searches === "number" ? own.searches : 0, reads: typeof own?.reads === "number" ? own.reads : 0 };
		const ownCoverage = validResearchCoverageObservation(shared[RESEARCH_COVERAGE_KEY])
			? shared[RESEARCH_COVERAGE_KEY] as ResearchCoverageObservation
			: undefined;
		report = normalizePartialDoneReport(report, ownCoverage);
		terminal = ["done", "blocked", "deferred"].includes(report.status);
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
		const terminalHasOpenChild = terminal && report.children.some((child) => !["done", "blocked", "deferred"].includes(child.status));
		if (terminalHasOpenChild) rejectPlanTool("branch_plan rejected: terminal branch must resolve every child before completion");
		const evidenceYieldError = branchEvidenceYieldError(report);
		if (evidenceYieldError) rejectPlanTool(`branch_plan rejected: ${evidenceYieldError}; use blocked or deferred with an explicit evidence gap when no usable source was found`);
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
	const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
	if (explicit) {
		const baseline = initialToolSurface();
		const updateAvailable = pi.getActiveTools().includes("plan_update") || baseline?.active.includes("plan_update");
		if (!updateAvailable) {
			ctx.ui.notify("Plan cannot resume: explicit tool selection excludes plan_update. Relaunch with plan_update enabled.", "error");
			return;
		}
	}
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
	// resume, so it restores the flat plan tools only when they were not explicitly omitted.
	const activeNow = pi.getActiveTools();
	const restorable = explicit ? [] : ["plan_write", "plan_update"].filter((name) =>
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
		const items = previous.items.map((item) => {
				if (!staleIds.has(item.id)) return item;
				const next = { ...item, status: "blocked" as const, note: "Delegated branch interrupted before a validated result; inspect evidence and explicitly reopen before retrying.", evidence_gaps: ["branch:interrupted"] };
				if (next.budget) next.budget = { ...next.budget, used: { ...next.budget.allocated } };
				delete next.lease;
				return next;
			});
		const state: PlanState = { ...previous, items, ...(items.every((item) => graphTerminal(item)) ? { head_terminal_at: previous.head_terminal_at ?? isoNow() } : { head_terminal_at: undefined }) };
		return { state, result: { state, staleLeases: staleLeases.length, interrupted: true } };
	}, {
		beforePersist: async (nextState) => {
			if (PARENT_RESEARCH_WORKFLOW && nextState.profile?.name === "deep-research") await projectResearchAggregate(cwd, nextState.run_id, nextState, "active");
		},
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

async function mergeBranchResult(cwd: string, context: import("../lib/branch-report.ts").PlanContextV1, report: BranchReportV1 | null, failureClass: string | null): Promise<MergeOutcome> {
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
		const items = previous.items.map((item) => item.id === parent.id ? {
			...consumeUncertainBudget(releaseLease(item)), status: "blocked" as const, note: `Delegated branch failed: ${failure}.`, evidence_gaps: [`branch:${failure}`],
		} : item);
		const headTerminal = items.every((item) => graphTerminal(item));
		const state = { ...previous, items, ...(headTerminal ? { head_terminal_at: previous.head_terminal_at ?? isoNow() } : { head_terminal_at: undefined }) };
		// The fallback state deliberately contains no incoming child claims. It is
		// therefore safe to persist even when the report that triggered the merge
		// violated a graph invariant.
		validateStateSize(state);
		return { state, result: { kind: "failed", runId: previous.run_id, failureClass: failure, headTerminal, headTerminalAt: state.head_terminal_at, openItems: openItemCount(state) } };
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
			const headTerminal = items.every((item) => graphTerminal(item));
			const state = { ...previous, items, ...(headTerminal ? { head_terminal_at: previous.head_terminal_at ?? isoNow() } : { head_terminal_at: undefined }) };
			return { state, result: { kind: "failed", runId: previous.run_id, failureClass: failure, headTerminal, headTerminalAt: state.head_terminal_at, openItems: openItemCount(state) } };
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
			evidence_gaps: report.evidence_gaps.map(cleanText).filter(Boolean), source_leads: report.source_leads.map((lead) => storedUrl(lead.url).display),
			claim_ids: [...new Set(report.source_leads.map((lead) => claimIdForText(lead.claim)))], coverage: report.coverage,
		} : item).concat(children);
		const headTerminal = items.every((item) => graphTerminal(item));
		const next = { ...previous, items, ...(headTerminal ? { head_terminal_at: previous.head_terminal_at ?? isoNow() } : { head_terminal_at: undefined }) };
		try { validateStateSize(next); }
		catch { return blockParent(previous, parent, "merge_rejected"); }
		return { state: next, result: { kind: "merged", runId: previous.run_id, children: children.length, leads: report.source_leads.length, gaps: report.evidence_gaps.length, headTerminal, headTerminalAt: next.head_terminal_at, openItems: openItemCount(next) } };
		}, {
			beforePersist: async (nextState) => {
				if (PARENT_RESEARCH_WORKFLOW) await projectResearchAggregate(cwd, context.run_id, nextState, "active");
			},
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
			}, {
				beforePersist: async (nextState) => {
					if (PARENT_RESEARCH_WORKFLOW) await projectResearchAggregate(cwd, context.run_id, nextState, "blocked");
				},
			});
		} catch {
			outcome = { kind: "ignored" };
		}
	}
	if (outcome.kind === "merged") planEvent("branch-merged", outcome.runId, { children: outcome.children, lead_count: outcome.leads, evidence_gaps: outcome.gaps });
	if (outcome.kind === "failed") planEvent("branch-failed", outcome.runId, { failure_class: outcome.failureClass });
	return outcome;
}

/**
 * Mirror a delegated branch result into the parent-owned evidence-gap ledger.
 * Child quotes and page contents are intentionally discarded; parent rereads
 * are the only operation that can create validating evidence cards.
 */
async function mergeResearchRoundChildResult(cwd: string, context: PlanContextV1, report: BranchReportV1 | null, failureClass: string | null, outcome: MergeOutcome): Promise<void> {
	if (!DEEP_RESEARCH_PLANNING || context.depth !== 1 || outcome.kind === "ignored") return;
	try {
		const state = await readState(cwd);
		if (!state || state.run_id !== context.run_id || state.profile?.name !== "deep-research" || state.settled_at) return;
		const path = researchRoundPath(cwd, context.run_id, process.env);
		const result = await mutateResearchRoundLedger(path, (ledger) => {
			// Graph lease validation is authoritative. A report that was ignored by
			// the graph (stale, unleased, settled, or wrong owner) must never mint a
			// ledger reservation or otherwise change evidence state.
			if (!ledger.state.child_reservations.some((reservation) => reservation.owner_ref === context.owner_ref)) return { merged: false };
			const acceptedReport = outcome.kind === "merged" ? report : null;
			const effectiveFailure = outcome.kind === "failed" ? outcome.failureClass : failureClass;
			const obligations = ledger.state.obligations;
			const claimForText = (claimText: string): string | undefined => obligations.find((obligation) => obligation.text === claimText)?.claim_id ?? (obligations.length === 1 ? obligations[0].claim_id : undefined);
			const sourceLeads = (acceptedReport?.source_leads ?? []).flatMap((lead) => {
				let url: string;
				try { url = canonicalResearchUrl(lead.url); } catch { return []; }
				const claim = claimForText(lead.claim); return claim ? [{ url, claim_ids: [claim] }] : [];
			});
			const fallbackClaim = obligations[0]?.claim_id;
			const gaps = (acceptedReport?.evidence_gaps ?? []).flatMap((missing, index) => fallbackClaim ? [{ gap_id: `child-gap-${context.parent_item_id}-${index}`, claim_id: fallbackClaim, missing: cleanText(missing).slice(0, 300) || "Child reported an unresolved evidence gap.", why: "Delegated evidence remains unverified until the parent rereads it.", next_action: "Parent reread and validate a source card.", status: acceptedReport?.status === "deferred" ? "deferred" as const : "open" as const }] : []);
			const childReport: ChildResearchReportV1 = {
				report_id: `child-${createHash("sha256").update(`${context.run_id}:${context.owner_ref}:${context.dispatch_epoch ?? 0}`).digest("hex").slice(0, 48)}`,
				run_id: context.run_id, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref,
				status: acceptedReport ? (acceptedReport.status === "done" ? "done" : acceptedReport.status === "deferred" ? "deferred" : "blocked") : "blocked",
				allocated: { searches: context.budget.searches, reads: context.budget.reads, validation_reads: 0 },
				consumed: acceptedReport ? { searches: acceptedReport.consumed.searches, reads: acceptedReport.consumed.reads, validation_reads: 0 } : { searches: 0, reads: 0, validation_reads: 0 },
				source_leads: sourceLeads, evidence_cards: [], gaps,
				...(effectiveFailure ? { failure_class: effectiveFailure === "interrupted" ? "interrupted" as const : "child_failed" as const } : {}),
			};
			return { merged: ledger.mergeChildReport(childReport).merged };
		}, {
			beforePersist: async (nextRound) => {
				if (PARENT_RESEARCH_WORKFLOW) await projectResearchRoundAggregate(cwd, context.run_id, nextRound, "active");
			},
		});
		if (!result.merged) return;
	} catch {
		// The graph merge remains authoritative. A malformed evidence projection is
		// non-authoritative and is surfaced by the parent's bounded inspect state.
	}
}

const RESEARCH_SYNTHESIS_FOLLOW_UP = [
	"[pi-munchkin:research-synthesis-follow-up]",
	"Delegated research branches have returned and the parent graph is now terminal.",
	"Act as the parent synthesizer for this run:",
	"1. Reread every delegated source lead with web_read; do not trust child quotes or summaries.",
	"2. Record one parent-validated research_note/evidence card for each material claim you will use.",
	...(PARENT_RESEARCH_WORKFLOW
		? ["3. Record the parent reads, evidence cards, conflicts, and remaining gaps with research_round; inspect its next_action before finishing.", "4. If all required evidence is validated and only explicit deferred work remains, call research_finish once with the final answer and any deferrals."]
		: ["3. Record the parent reads, evidence cards, conflicts, and remaining gaps with research_round; inspect its next_action before settling.", "4. If all required evidence is validated and only explicit deferred work remains, call research_round settle, then plan_settle."]),
	"If a branch is blocked or a required card is still missing, do not force settlement: leave the bounded gap explicit with its value, risk, and rationale. Do not start fresh searches or delegate again.",
].join("\n");

async function queueResearchSynthesisFollowUp(outcome: MergeOutcome): Promise<void> {
	if (!api || !lastSessionCwd || !lastSessionIdHash || outcome.kind === "ignored" || !outcome.headTerminal || !outcome.headTerminalAt) return;
	// A branch result can race the parent's final settlement. Never enqueue a
	// stale synthesis turn after the authoritative graph has already settled;
	// Pi drains follow-ups after a terminating tool batch.
	if (lastSessionCwd) {
		const current = await readState(lastSessionCwd);
		if (current?.settled_at) return;
	}
	// Respect an explicit tool selection. A follow-up that asks for unavailable
	// web_read/plan_settle tools would only make a small model spin on an
	// impossible contract; graph start normally guarantees these are active.
	const active = api.getActiveTools();
	if (!active.includes("web_read") || !active.includes("plan_settle") || (DEEP_RESEARCH_PLANNING && !active.includes("research_round")) || (PARENT_RESEARCH_WORKFLOW && !active.includes("research_finish"))) return;
	const key = `${outcome.runId}:${outcome.headTerminalAt}`;
	if (researchSynthesisFollowUps.has(key)) return;
	if (researchSynthesisFollowUps.size >= 24) {
		const oldest = researchSynthesisFollowUps.values().next().value;
		if (typeof oldest === "string") researchSynthesisFollowUps.delete(oldest);
	}
	const cwd = lastSessionCwd;
	const runIdHash = signalRunId(outcome.runId);
	const terminalGeneration = outcome.headTerminalAt;
	const accepted = offerContinuation(api, {
		v: 1,
		session_id_hash: lastSessionIdHash,
		owner_id_hash: runIdHash,
		generation: terminalGeneration,
		scope: "plan",
		reason: "research_synthesis",
		priority: 350,
		idempotency_key: `research-synthesis:${lastSessionIdHash}:${runIdHash}:${terminalGeneration}`,
		message: `${RESEARCH_SYNTHESIS_FOLLOW_UP}\n\nOpen graph items: ${outcome.openItems}.`,
		expires_at_ms: Date.now() + 60_000,
	}, async () => {
		const current = await readState(cwd);
		return current?.run_id === outcome.runId && current.head_terminal_at === terminalGeneration && !current.settled_at;
	});
	if (accepted) researchSynthesisFollowUps.add(key);
}

/**
 * A parent agent_end is the boundary at which an abandoned research attempt
 * must become explicit graph state. Leaving an undispatched pending node in
 * the plan made a completed Pi run look executable on recovery and prevented
 * the head from ever acquiring a terminal marker. Close only unleased nodes;
 * an in-flight lease is handled by the existing stale-lease recovery path.
 */
async function closeUndispatchedResearchBranches(cwd: string): Promise<{ runId: string; closed: number; contexts: PlanContextV1[] } | null> {
	return mutatePlan<{ runId: string; closed: number; contexts: PlanContextV1[] } | null>(cwd, async (previous) => {
		if (!previous || previous.schema_version !== 5 || previous.profile?.name !== "deep-research" || previous.settled_at) return { result: null };
		const pending = previous.items.filter((item) => item.status === "pending" && !item.lease);
		if (pending.length === 0) return { result: null };
		const pendingIds = new Set(pending.map((item) => item.id));
		const items = previous.items.map((item) => {
			if (!pendingIds.has(item.id)) return item;
			const next: PlanItem = {
				...item,
				status: "blocked",
				note: "Research branch ended before dispatch; inspect the evidence gap and explicitly reopen the owning branch before retrying.",
				evidence_gaps: [...new Set([...(item.evidence_gaps ?? []), "branch:parent_ended_before_dispatch"])],
			};
			if (next.budget) next.budget = { ...next.budget, used: { ...next.budget.allocated } };
			delete next.lease;
			return next;
		});
		const state: PlanState = {
			...previous,
			items,
			...(items.every((item) => graphTerminal(item)) ? { head_terminal_at: previous.head_terminal_at ?? isoNow() } : { head_terminal_at: undefined }),
		};
		validateStateSize(state);
		// The graph transition closes the work item, but its research-round
		// reservation is a separate parent-owned ledger. Return the exact branch
		// credentials so agent_end can append a terminal interruption receipt and
		// burn the allocation transactionally instead of leaving budget in flight.
		const contexts = pending.flatMap((item): PlanContextV1[] => {
			if (!item.owner_ref || !item.budget) return [];
			return [{
				v: 1, profile: "deep-research", run_id: state.run_id, parent_item_id: item.id,
				owner_ref: item.owner_ref, depth: 1, budget: { ...item.budget.allocated },
				limits: { max_depth: 2, max_children: 2 },
				dispatch_epoch: item.dispatch_epoch ?? 0,
			}];
		});
		return { state, result: { runId: state.run_id, closed: pending.length, contexts } };
	});
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
		if (DEEP_RESEARCH_PLANNING) {
			pi.registerTool(researchPlanStart);
			pi.registerTool(researchRound);
			if (PARENT_RESEARCH_WORKFLOW) pi.registerTool(researchFinish);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		setPlanning(false);
		awaitingReview = false;
		planningSurfaceBefore = null;
		planningSurfaceApplied = null;
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		delete (globalThis as Record<string, unknown>).__pi_active_goal_context;
		delete (globalThis as Record<string, unknown>)[RESEARCH_ROUND_PATH_KEY];
		lastSessionCwd = ctx.cwd;
		lastSessionIdHash = hashContinuationIdentity(ctx.sessionManager?.getSessionId?.() ?? `compat:${ctx.cwd}`);
		researchSynthesisFollowUps.clear();
		goalContinuationOffers().clear();
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
		if (!delegatedBranchProcess) {
			const restoredPlan = await readState(ctx.cwd);
			if (restoredPlan?.profile?.name === "deep-research" && !restoredPlan.settled_at) {
				const restoredPath = researchRoundPath(ctx.cwd, restoredPlan.run_id, process.env);
				if (await readResearchRoundLedger(restoredPath)) (globalThis as Record<string, unknown>)[RESEARCH_ROUND_PATH_KEY] = restoredPath;
			}
		}
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
			const next = prior.catch(() => undefined).then(async () => {
					const outcome = await mergeBranchResult(lastSessionCwd!, signal.context, signal.report, signal.failureClass);
					await mergeResearchRoundChildResult(lastSessionCwd!, signal.context, signal.report, signal.failureClass, outcome);
					await queueResearchSynthesisFollowUp(outcome);
			}).catch(() => undefined);
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
			if (PLAN_GRAPH) pi.setActiveTools(pi.getActiveTools().filter((name) => !["plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "research_round", "research_finish"].includes(name)));
			ctx.ui.notify("Plan cancelled.", "info");
		},
	});
	pi.registerCommand("plan-status", { description: "Show the current bounded plan or one graph subtree.", handler: async (args, ctx) => {
		const state = await readState(ctx.cwd);
		const selected = cleanText(args) || undefined;
		if (selected && state && !state.items.some((item) => item.id === selected)) { ctx.ui.notify(`Unknown plan item: ${selected}`, "error"); return; }
		if (state) ctx.ui.notify(renderTodo(state, selected), "info");
		else if (await planStateFilePresent(ctx.cwd)) ctx.ui.notify("Planner state is malformed and has been preserved. Use /plan-cancel to discard it before creating a replacement.", "error");
		else ctx.ui.notify("No current plan found.", "info");
	} });
	pi.registerCommand("plan-export", { description: "Export the private plan review snapshot.", handler: async (_args, ctx) => {
		rejectChildPlanMutation();
		const state = await readState(ctx.cwd);
		if (!state) {
			if (await planStateFilePresent(ctx.cwd)) {
				ctx.ui.notify("Planner state is malformed and has been preserved; export is unavailable. Use /plan-cancel to discard it before creating a replacement.", "error");
			} else ctx.ui.notify("No plan to export.", "info");
			return;
		}
		await atomicWriteFile(todoPath(ctx.cwd), renderTodo(state, undefined, true), { mode: 0o644 });
		await atomicWriteFile(reviewExportPath(ctx.cwd), `${JSON.stringify(state, null, 2)}\n`, { mode: 0o644 });
		ctx.ui.notify("Plan exported to .pi/TODO.md and .pi/plan-review.json.", "info");
	} });
	pi.registerCommand("plan-trace", { description: "Show bounded historical plan trace lines.", handler: async (args, ctx) => {
		const path = tracePath(ctx.cwd);
		const n = Math.min(50, Math.max(1, Number.parseInt(args.trim(), 10) || 10));
		ctx.ui.notify(path ? (await tailLines(path, n)).join("\n") || "No plan trace found." : "No plan trace found.", "info");
	} });
	if (PARENT_RESEARCH_WORKFLOW) {
		pi.registerCommand("research-status", { description: "Show bounded status for the parent-owned research run.", handler: async (args, ctx) => {
			const state = await readState(ctx.cwd);
			const aggregate = state?.run_id ? await readResearchAggregate(researchAggregatePath(ctx.cwd, state.run_id, process.env)) : null;
			if (!aggregate) { ctx.ui.notify("No valid parent research aggregate found.", "info"); return; }
			try {
				const cursor = cleanText(args) || undefined;
				const view = cursor ? inspectResearchPage(aggregate, cursor) : renderCoverageDigest(aggregate);
				ctx.ui.notify(view.text, "info");
			} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Research status is unavailable.", "error"); }
		} });
		pi.registerCommand("research-extend", { description: "Extend a paused research run by one ten-minute interval.", handler: async (_args, ctx) => {
			const state = await readState(ctx.cwd);
			const path = state?.run_id ? researchAggregatePath(ctx.cwd, state.run_id, process.env) : null;
			if (!path) { ctx.ui.notify("No research run can be extended.", "error"); return; }
			try {
				await mutateResearchAggregate(path, (current) => ({ state: extendDeadline(current), result: undefined }));
				ctx.ui.notify("Research extension granted for one ten-minute interval. Existing search/read allowances remain unchanged.", "info");
			} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Research extension failed.", "error"); }
		} });
		pi.registerCommand("research-cancel", { description: "Cancel parent-owned research while retaining its evidence.", handler: async (_args, ctx) => {
			const state = await readState(ctx.cwd);
			const path = state?.run_id ? researchAggregatePath(ctx.cwd, state.run_id, process.env) : null;
			if (!path) { ctx.ui.notify("No research run can be cancelled.", "error"); return; }
			try {
				await mutateResearchAggregate(path, (current) => ({ state: transitionAggregate(current, { phase: "paused" }), result: undefined }));
				ctx.ui.notify("Research cancelled and paused. Evidence and the exact resource position remain inspectable.", "info");
			} catch (error) { ctx.ui.notify(error instanceof Error ? error.message : "Research cancellation failed.", "error"); }
		} });
	}

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
		if (!delegatedBranchProcess) {
			const closed = await closeUndispatchedResearchBranches(ctx.cwd);
			if (closed) {
				for (const context of closed.contexts) await mergeResearchRoundChildResult(ctx.cwd, context, null, "interrupted", { kind: "failed", runId: closed.runId, failureClass: "interrupted", headTerminal: true, openItems: 0 });
				planEvent("branches-closed", closed.runId, { closed: closed.closed, reason_class: "parent_ended_before_dispatch" });
			}
		}
		const state = await readState(ctx.cwd);
		if (state && state.phase === "executing" && openItemCount(state) > 0) {
			record("plan-runner", "ended-open", { run_id: state.run_id, open_items: openItemCount(state) });
		}
		await offerGoalContinuation(pi, ctx);
	});
}
