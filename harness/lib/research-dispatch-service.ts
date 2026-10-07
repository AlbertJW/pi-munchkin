import { randomUUID } from 'node:crypto';
import type { BranchReportV1, PlanContextV1, ResearchCoverageObservation } from './branch-report.ts';
import { graphTerminal, ownerRef, type ResearchBranchLease, type ResearchBudget } from './plan-graph.ts';
import type { MutatePlanOptions, PlanState } from './plan-service.ts';
import type { ResearchAggregatePhase } from './research-aggregate.ts';
import { mutateParentResearchRoundLedger } from './research-round.ts';
export type ResearchBranchLeaseResult = {
    ok: true;
    lease_id: string;
} | {
    ok: false;
    reason: "no-plan" | "wrong-plan" | "unknown-branch" | "terminal-branch" | "already-leased" | "stale-context" | "budget-exhausted" | "invalid-context";
};
export type ResearchDispatchPort = {
    readState(cwd: string): Promise<PlanState | undefined>;
    mutatePlan<T>(cwd: string, fn: (state: PlanState | undefined) => Promise<{
        state?: PlanState;
        result: T;
    }>, options?: MutatePlanOptions): Promise<T>;
    requireActiveParentResearch(cwd: string, runId: string, operation: string): Promise<void>;
    projectResearchAggregate(cwd: string, runId: string, state: PlanState, phase?: ResearchAggregatePhase): Promise<void>;
    parentWorkflow: boolean;
};
export function coverageNeedsFailureReason(value: unknown): boolean {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return false;
    const coverage = value as Record<string, unknown>;
    return coverage.complete === false && coverage.truncated !== true && coverage.budget_exhausted !== true && coverage.failed !== true;
}
export function explainCoverageInvariant(report: BranchReportV1, terminal = false): string | null {
    const terminalStatuses = new Set(["done", "blocked", "deferred"]);
    if (terminal && !report.coverage)
        return "top-level coverage receipt";
    if (coverageNeedsFailureReason(report.coverage))
        return "top-level coverage";
    for (const child of report.children) {
        if (terminal && terminalStatuses.has(child.status) && !child.coverage)
            return `terminal child ${child.item_id} coverage receipt`;
        if (coverageNeedsFailureReason(child.coverage))
            return `child ${child.item_id} coverage`;
    }
    return null;
}
export function normalizePartialDoneReport(report: BranchReportV1, ownCoverage?: ResearchCoverageObservation): BranchReportV1 {
    if (report.status !== "done" || report.source_leads.length === 0)
        return report;
    const partial = report.evidence_gaps.length > 0 || report.coverage?.complete === false || ownCoverage?.incomplete === true;
    if (!partial)
        return report;
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
    if (!coverage.truncated && !coverage.budget_exhausted && !coverage.failed)
        coverage.budget_exhausted = true;
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
export function createResearchDispatchService(port: ResearchDispatchPort) {
    const { readState, mutatePlan, requireActiveParentResearch, projectResearchAggregate } = port;
    const PARENT_RESEARCH_WORKFLOW = port.parentWorkflow;
    const isoNow = () => new Date().toISOString();
    async function researchBranchDispatchEpoch(cwd: string, context: PlanContextV1): Promise<number | null> {
        if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id))
            return null;
        const state = await readState(cwd);
        if (!state || state.schema_version !== 5 || state.run_id !== context.run_id || state.profile?.name !== "deep-research")
            return null;
        const item = state.items.find((candidate) => candidate.id === context.parent_item_id);
        if (!item || item.parent_id !== undefined || item.kind !== "research_branch" || item.owner_ref !== context.owner_ref)
            return null;
        return item.dispatch_epoch ?? 0;
    }
    function sameBudget(a: ResearchBudget, b: ResearchBudget): boolean {
        return a.searches === b.searches && a.reads === b.reads;
    }
    async function researchBranchDispatchContext(cwd: string, context: PlanContextV1): Promise<PlanContextV1 | null> {
        if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id))
            return null;
        const state = await readState(cwd);
        if (!state || state.schema_version !== 5 || state.run_id !== context.run_id || state.profile?.name !== "deep-research" || state.settled_at)
            return null;
        const item = state.items.find((candidate) => candidate.id === context.parent_item_id);
        if (!item || item.parent_id !== undefined || item.kind !== "research_branch" || item.owner_ref !== context.owner_ref || graphTerminal(item) || !item.budget)
            return null;
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
    async function acquireResearchBranchLease(cwd: string, context: PlanContextV1): Promise<ResearchBranchLeaseResult> {
        if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id))
            return { ok: false, reason: "invalid-context" };
        const result = await mutatePlan<ResearchBranchLeaseResult>(cwd, async (previous) => {
            if (!previous)
                return { result: { ok: false, reason: "no-plan" } };
            if (previous.schema_version !== 5 || previous.run_id !== context.run_id || previous.profile?.name !== "deep-research" || previous.settled_at) {
                return { result: { ok: false, reason: "wrong-plan" } };
            }
            await requireActiveParentResearch(cwd, previous.run_id, "research branch lease");
            const parent = previous.items.find((item) => item.id === context.parent_item_id);
            if (!parent || parent.parent_id !== undefined || parent.kind !== "research_branch" || parent.owner_ref !== context.owner_ref) {
                return { result: { ok: false, reason: "unknown-branch" } };
            }
            if (graphTerminal(parent))
                return { result: { ok: false, reason: "terminal-branch" } };
            if (parent.lease)
                return { result: { ok: false, reason: "already-leased" } };
            if (!parent.budget)
                return { result: { ok: false, reason: "wrong-plan" } };
            if (context.dispatch_epoch !== undefined && context.dispatch_epoch !== (parent.dispatch_epoch ?? 0)) {
                return { result: { ok: false, reason: "stale-context" } };
            }
            const remaining = {
                searches: Math.max(0, parent.budget.allocated.searches - parent.budget.used.searches),
                reads: Math.max(0, parent.budget.allocated.reads - parent.budget.used.reads),
            };
            if (!sameBudget(context.budget, remaining))
                return { result: { ok: false, reason: "stale-context" } };
            if (remaining.searches === 0 && remaining.reads === 0)
                return { result: { ok: false, reason: "budget-exhausted" } };
            if (PARENT_RESEARCH_WORKFLOW) {
                if (previous.items.some(item => item.lease))
                    return { result: { ok: false, reason: "already-leased" } };
                await mutateParentResearchRoundLedger(cwd, context.run_id, ledger => {
                    if (ledger.state.child_reservations.length || ledger.state.child_reports.length)
                        throw new Error("parent research permits only one bounded child per run");
                    ledger.reserveChild(context.owner_ref, { ...remaining, validation_reads: 0 });
                }, ["active"], { rejectExpired: true, requireDiscovery: true });
            }
            const lease: ResearchBranchLease = { lease_id: randomUUID(), issued_at: isoNow(), owner_ref: context.owner_ref };
            const state: PlanState = { ...previous, items: previous.items.map((item) => item.id === parent.id ? { ...item, lease } : item) };
            return { state, result: { ok: true, lease_id: lease.lease_id } };
        }, {
            beforePersist: async (nextState) => {
                if (PARENT_RESEARCH_WORKFLOW)
                    await projectResearchAggregate(cwd, context.run_id, nextState, "active");
            },
        });
        return result;
    }
    async function releaseResearchBranchLease(cwd: string, context: PlanContextV1, leaseId: string): Promise<boolean> {
        if (context.depth !== 1 || context.owner_ref !== ownerRef(context.run_id, context.parent_item_id))
            return false;
        const released = await mutatePlan<boolean>(cwd, async (previous) => {
            if (!previous || previous.schema_version !== 5 || previous.run_id !== context.run_id)
                return { result: false };
            const parent = previous.items.find((item) => item.id === context.parent_item_id);
            if (!parent?.lease || parent.owner_ref !== context.owner_ref || parent.lease.lease_id !== leaseId)
                return { result: false };
            if (PARENT_RESEARCH_WORKFLOW)
                await mutateParentResearchRoundLedger(cwd, context.run_id, ledger => ledger.releaseUndispatchedChild(context.owner_ref), ["active", "paused", "awaiting_extension", "blocked"]);
            const items = previous.items.map((item) => {
                if (item.id !== parent.id)
                    return item;
                const next = { ...item };
                delete next.lease;
                return next;
            });
            return { state: { ...previous, items }, result: true };
        }, {
            beforePersist: async (nextState) => {
                if (PARENT_RESEARCH_WORKFLOW)
                    await projectResearchAggregate(cwd, context.run_id, nextState, "active");
            },
        });
        return released;
    }
    return { researchBranchDispatchEpoch, researchBranchDispatchContext, acquireResearchBranchLease, releaseResearchBranchLease };
}
