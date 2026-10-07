import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { createPlanningRuntime } from '../lib/planning-runtime.ts';
import type { PlanContextV1 } from '../lib/branch-report.ts';
export { FORCE_PLAN_WRITE_DEFAULT, PLAN_GRAPH_DEFAULT, DEEP_RESEARCH_PLANNING_DEFAULT } from '../lib/planning-runtime.ts';
export { truncateBytes } from '../lib/plan-service.ts';
export type { ResearchBranchLeaseResult } from '../lib/research-dispatch-service.ts';
// Public filesystem operations create an independent orchestration scope.
export const researchBranchDispatchEpoch = (cwd: string, context: PlanContextV1) => createPlanningRuntime().researchBranchDispatchEpoch(cwd, context);
export const researchBranchDispatchContext = (cwd: string, context: PlanContextV1) => createPlanningRuntime().researchBranchDispatchContext(cwd, context);
export const acquireResearchBranchLease = (cwd: string, context: PlanContextV1) => createPlanningRuntime().acquireResearchBranchLease(cwd, context);
export const releaseResearchBranchLease = (cwd: string, context: PlanContextV1, leaseId: string) => createPlanningRuntime().releaseResearchBranchLease(cwd, context, leaseId);
export const tailLines = (path: string, maxLines: number) => createPlanningRuntime().tailLines(path, maxLines);
export const policyBlock = (autonomy: 'lean' | 'yolo', subagentAvailable: boolean) => createPlanningRuntime().policyBlock(autonomy, subagentAvailable);
export default function planRunner(pi: ExtensionAPI): void { createPlanningRuntime().register(pi); }
