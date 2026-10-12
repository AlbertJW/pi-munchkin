import { defineTool, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';
import { acceptGoal, acceptSettlementProposal, blockGoal, currentVerification, goalStoragePath, settleOrProposeGoal, cancelGoal, createGoal, GOAL_MAX_CRITERIA, GOAL_MODEL_TEXT_MAX_BYTES, goalAmbientSummary, goalLedgerLoadError, goalRevision, goalScope, inspectGoal, loadGoalLedger, mutateGoal, pauseGoal, readCurrentGoal, readExecutableGoal, renderGoalRecoveryBrief, resumeGoal, updateGoal, type CriterionStatus, type DeferredGoalItem, type GoalInspectSection, type GoalState } from "./goal-state.ts";
import { emitHarnessSignal } from './harness-signals.ts';
import { cleanText } from './plan-service.ts';
import { record } from './telemetry.ts';
import { runtimeValue } from './runtime-ownership.ts';

/** The goal revision whose brief is already in this session's live context. Pi persists
 * every before_agent_start message in the conversation, so re-injecting an unchanged
 * brief on every run stacks duplicate copies until compaction. Cleared on compaction. */
const BRIEF_FIELD = { key: "goal-brief-in-context", lifetime: "session" as const, create: () => ({ revision: null as string | null }) };
export function goalBriefInContext(bus: object): string | null { return runtimeValue(bus, BRIEF_FIELD).revision; }
export function noteGoalBriefInContext(bus: object, revision: string | null): void { runtimeValue(bus, BRIEF_FIELD).revision = revision; }
export function goalContinuationInstruction(goal: GoalState, decision: "continue" | "settle"): string {
    if (decision === "settle") {
        return goal.criteria.some((criterion) => criterion.status === "deferred")
            ? "[pi-munchkin:goal-continuation] Required criteria are met and optional work is deferred. Verify the delivered value, then call goal_settle with outcome=accepted_80_20, concrete evidence, and value, risk, and rationale for the deferrals. If evidence is insufficient, leave the goal active and explain the gap."
            : "[pi-munchkin:goal-continuation] All goal criteria are recorded as met. Perform the final verification you can justify, then call goal_settle with outcome=complete and concrete evidence; if evidence is insufficient, leave the goal active and explain the gap.";
    }
    return "[pi-munchkin:goal-continuation] The active goal still has open criteria. Continue with one highest-value next action, then record the resulting evidence with goal_update. Do not repeat work that produced no new evidence.";
}
export function goalEvent(kind: string, goal: GoalState | undefined, detail: Record<string, unknown> = {}): void {
    if (!goal)
        return;
    const payload = {
        goal_id_hash: createHash("sha256").update(goal.goal_id).digest("hex"), status: goal.status,
        open_criteria: goal.criteria.filter((criterion) => criterion.status === "open").length,
        ...detail,
    };
    // Keep each event name statically visible to the catalog tripwire; dynamic
    // event names otherwise make a real emitter look like an orphan.
    switch (kind) {
        case "proposed":
            record("goal-runner", "proposed", payload);
            break;
        case "started":
            record("goal-runner", "started", payload);
            break;
        case "accepted":
            record("goal-runner", "accepted", payload);
            break;
        case "updated":
            record("goal-runner", "updated", payload);
            break;
        case "settled":
            record("goal-runner", "settled", payload);
            break;
        case "settlement-proposed":
            record("goal-runner", "settlement-proposed", payload);
            break;
        case "resumed":
            record("goal-runner", "resumed", payload);
            break;
        case "paused":
            record("goal-runner", "paused", payload);
            break;
        case "blocked":
            record("goal-runner", "blocked", payload);
            break;
        case "cancelled":
            record("goal-runner", "cancelled", payload);
            break;
    }
}
export function publishGoal(goal: GoalState | undefined): void {
    const shared = globalThis as Record<string, unknown>;
    if (goal)
        shared.__pi_active_goal_context = goalAmbientSummary(goal);
    else
        delete shared.__pi_active_goal_context;
}
export function emitGoalState(pi: ExtensionAPI, goal: GoalState | undefined): void {
    emitHarnessSignal(pi.events, { v: 1, type: "goal/state", status: goal?.status ?? "none" });
}
export function goalExecutionPrompt(goal: GoalState): string {
    return [
        "MODE: GOAL",
        "Pursue this persistent user-owned goal across turns until it is complete, explicitly accepted at 80/20, paused, blocked, or cancelled.",
        "Use goal_update to record criterion evidence and residual risk. Use goal_settle only when its evidence requirements are satisfied.",
        renderGoalRecoveryBrief(goal),
    ].join("\n\n");
}
export async function startGoalTurn(pi: ExtensionAPI, ctx: any, goal: GoalState, action: "goal" | "goal-accept" | "goal-resume"): Promise<void> {
    emitGoalState(pi, goal);
    noteGoalBriefInContext(pi.events, goalRevision(goal)); // goalExecutionPrompt carries the brief
    pi.sendMessage({
        customType: "pi-munchkin:goal-command",
        content: goalExecutionPrompt(goal),
        display: true,
        details: { action, goal_id_hash: createHash("sha256").update(goal.goal_id).digest("hex") },
    }, { triggerTurn: true });
    if (typeof ctx.waitForIdle === "function")
        await ctx.waitForIdle();
}
/** A writer that crashed mid-write leaves `goal-v2.json.lock`; locks are never stolen. */
async function goalLockNotice(cwd: string): Promise<string | null> {
    const lockPath = `${goalStoragePath(cwd)}.lock`;
    const advice = "If no Pi session is writing goals, stop all sessions using this project and remove that directory.";
    try {
        const owner = JSON.parse(await readFile(join(lockPath, "owner.json"), "utf8")) as { pid?: unknown; created_at?: unknown };
        return `Goal lock present: ${lockPath} (pid ${String(owner.pid)}, since ${String(owner.created_at)}). ${advice}`;
    } catch {
        try { await stat(lockPath); } catch { return null; }
        return `Goal lock present without a readable owner record: ${lockPath}. ${advice}`;
    }
}
export function rejectChildGoalMutation(): void {
    if (process.env.PI_SUBAGENT_DEPTH !== undefined && process.env.PI_SUBAGENT_DEPTH !== "0")
        throw new Error("persistent goal mutation is parent-owned; child processes may report findings but cannot write the goal ledger");
}
export async function rebindActiveGoal(cwd: string): Promise<GoalState | undefined> {
    const goal = await readCurrentGoal(cwd);
    publishGoal(goal);
    return goal;
}
export function renderGoal(goal: GoalState | undefined, all: GoalState[] = []): string {
    if (!goal)
        return all.length ? `No active goal. Stored goals: ${all.map((entry) => `${entry.goal_id}=${entry.status}`).join(", ")}` : "No persistent goal found.";
    const criteria = goal.criteria.map((criterion) => `${criterion.id} [${criterion.status}]${criterion.required ? " required" : " optional"} ${criterion.text}`).join("\n");
    return [
        `Goal ${goal.goal_id} [${goal.status}]`, `Scope: ${goal.scope}`, `Objective: ${goal.objective}`,
        `Criteria (${goal.criteria.filter((criterion) => criterion.status === "met").length}/${goal.criteria.length} met):`, criteria || "(none)",
        `Evidence: ${goal.evidence.length}`, `Deferred: ${goal.deferred.length}`, `Confidence: ${goal.confidence ?? "unknown"}`,
        goal.delivered_value ? `Delivered: ${goal.delivered_value}` : "Delivered: not settled",
        ...(goal.verification ? [`Verification at settlement: ${goal.verification}`] : []),
        ...(goal.settlement_proposal ? [
            `Pending 80/20 settlement proposed by the model (verification: ${goal.settlement_proposal.verification}):`,
            `  Delivered: ${goal.settlement_proposal.delivered_value}`,
            ...goal.settlement_proposal.deferred.map((item) => `  Deferred: ${item.value} — risk: ${item.risk}`),
            "  /goal-accept accepts it; /goal-resume declines it and continues the work.",
        ] : []),
    ].join("\n");
}
export function createGoalTools(getApi: () => ExtensionAPI) {
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
                if (previous && !["complete", "cancelled"].includes(previous.status))
                    throw new Error("goal_propose rejected: an active or pending goal already exists");
                const goal = createGoal({ cwd: ctx.cwd, objective: params.objective, constraints: params.constraints, criteria: params.criteria, scope: goalScope(), status: "proposed", proposal: { source: "skill", note: params.note ?? "Skill-proposed goal." } });
                return { goal, result: goal };
            });
            publishGoal(result);
            emitGoalState(getApi(), result);
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
                if (!previous)
                    throw new Error("goal_update rejected: no active goal");
                const goal = updateGoal(previous, { criteria: params.criteria as Array<{
                        id: string;
                        status: CriterionStatus;
                        evidence?: string[];
                    }> | undefined, progressEvidence: params.progress_evidence, residualRisks: params.residual_risks });
                return { goal, result: goal };
            });
            publishGoal(result);
            emitGoalState(getApi(), result);
            goalEvent("updated", result);
            return { content: [{ type: "text" as const, text: `Goal updated (${result.criteria.filter((criterion) => criterion.status === "met").length}/${result.criteria.length} criteria met).` }], details: { tool_name: "goal_update", success: true } };
        },
    });
    const goalSettle = defineTool({
        name: "goal_settle", label: "Settle Goal", description: "Settle a persistent goal as complete, or propose an evidence-backed 80/20 settlement for the user to accept. Required criteria and safety obligations cannot be waived.",
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
                if (!previous)
                    throw new Error("goal_settle rejected: no active goal");
                const goal = settleOrProposeGoal(previous, { outcome: params.outcome, deliveredValue: params.delivered_value, confidence: params.confidence, residualRisks: params.residual_risks, deferred: params.deferred as DeferredGoalItem[] | undefined, evidence: params.evidence, verification: currentVerification() });
                return { goal, result: goal };
            });
            publishGoal(result);
            emitGoalState(getApi(), result);
            if (result.settlement_proposal) {
                goalEvent("settlement-proposed", result, { deferred: result.settlement_proposal.deferred.length });
                return { content: [{ type: "text" as const, text: "80/20 settlement proposed. The goal stays active until the user accepts it with /goal-accept or declines it with /goal-resume. Stop here and summarise what was delivered and what is deferred." }], details: { tool_name: "goal_settle", success: true, outcome: "settlement_proposed" } };
            }
            goalEvent("settled", result, { outcome: result.status, deferred: result.deferred.length });
            return { content: [{ type: "text" as const, text: `Goal ${result.status} (verification: ${result.verification ?? "unknown"}). Planner execution may stop.` }], details: { tool_name: "goal_settle", success: true, outcome: result.status } };
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
                if (!previous || previous.status !== "active")
                    throw new Error("goal_block rejected: no active goal exists");
                const goal = blockGoal(previous, { reason: params.reason, evidence: params.evidence, unblockCondition: params.unblock_condition });
                return { goal, result: goal };
            });
            publishGoal(result);
            emitGoalState(getApi(), result);
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
            if (!goal)
                throw new Error("goal_inspect rejected: no active goal");
            const page = inspectGoal(goal, (params.section ?? "all") as GoalInspectSection, params.cursor);
            return { content: [{ type: "text" as const, text: JSON.stringify(page) }], details: { tool_name: "goal_inspect", success: true, has_more: page.next_cursor !== null } };
        },
    });
    return { goalPropose, goalInspect, goalUpdate, goalSettle, goalBlock };
}
export function registerGoalCommands(pi: ExtensionAPI): void {
    {
        pi.registerCommand("goal", {
            description: "Create and activate a persistent project/worktree goal.",
            handler: async (args, ctx) => {
                rejectChildGoalMutation();
                const objective = cleanText(args);
                if (!objective) {
                    ctx.ui.notify("Usage: /goal <objective>", "error");
                    return;
                }
                const result = await mutateGoal(ctx.cwd, async (previous) => {
                    if (previous && !["complete", "cancelled"].includes(previous.status))
                        throw new Error("An active or pending goal already exists; use /goal-status or /goal-resume.");
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
            description: "Accept what the model proposed: a new goal, or an 80/20 settlement of the active goal.",
            handler: async (_args, ctx) => {
                rejectChildGoalMutation();
                const result = await mutateGoal(ctx.cwd, async (previous) => {
                    if (!previous)
                        throw new Error("Nothing to accept: no proposed goal or settlement exists.");
                    const goal = previous.status === "active" && previous.settlement_proposal ? acceptSettlementProposal(previous) : acceptGoal(previous);
                    return { goal, result: goal };
                });
                publishGoal(result);
                emitGoalState(pi, result);
                if (result.status === "accepted_80_20") {
                    goalEvent("settled", result, { outcome: result.status, deferred: result.deferred.length });
                    ctx.ui.notify(`80/20 settlement accepted: ${result.goal_id}. /goal-resume reopens it.`, "info");
                    return;
                }
                goalEvent("accepted", result);
                ctx.ui.notify(`Goal accepted: ${result.goal_id}`, "info");
                await startGoalTurn(pi, ctx, result, "goal-accept");
            },
        });
        pi.registerCommand("goal-status", {
            description: "Show the active persistent goal and its evidence-backed criteria.",
            handler: async (_args, ctx) => {
                const load = await loadGoalLedger(ctx.cwd);
                if (load.kind !== "valid" && load.kind !== "absent") {
                    publishGoal(undefined);
                    emitGoalState(pi, undefined);
                    ctx.ui.notify(goalLedgerLoadError(load), "error");
                    return;
                }
                const all = load.kind === "valid" ? load.ledger.goals : [];
                const goal = load.kind === "valid" ? all.find(entry => entry.goal_id === load.ledger.current_goal_id) : undefined;
                publishGoal(goal);
                const lock = await goalLockNotice(ctx.cwd);
                ctx.ui.notify(lock ? `${renderGoal(goal, all)}\n${lock}` : renderGoal(goal, all), "info");
            },
        });
        pi.registerCommand("goal-resume", {
            description: "Resume a paused, blocked, or 80/20-accepted goal.",
            handler: async (_args, ctx) => {
                rejectChildGoalMutation();
                const result = await mutateGoal(ctx.cwd, async (previous) => {
                    if (!previous)
                        throw new Error("No resumable goal exists.");
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
                    if (!previous)
                        throw new Error("No active goal exists.");
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
                    if (!previous)
                        throw new Error("No active goal exists.");
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
}
