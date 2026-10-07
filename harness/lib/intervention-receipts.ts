import { createHash } from "node:crypto";
import { runtimeIdentity } from "./runtime-ownership.ts";
import type { ControlProposalV1 } from "./control-proposal.ts";
export type InterventionStage = "proposed" | "selected" | "dispatch-accepted" | "dispatch-rejected";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function interventionReceipt(bus: object, proposal: ControlProposalV1, stage: InterventionStage, request: number | null, env = process.env) {
 const identity = runtimeIdentity(bus);
 return { v: 1, stage, proposalIdHash: proposal.proposalIdHash, source: proposal.source, reason: proposal.reason,
  boundarySequence: proposal.boundarySequence, request, generation: identity.generation,
  sessionIdHash: identity.sessionId === null ? null : hash(identity.sessionId),
  taskIdHash: env.MUNCHKIN_ACCEPTANCE_TASK ? hash(env.MUNCHKIN_ACCEPTANCE_TASK) : null,
  runIdHash: env.MUNCHKIN_ACCEPTANCE_RUN ? hash(env.MUNCHKIN_ACCEPTANCE_RUN) : null,
  branchIdHash: env.MUNCHKIN_ACCEPTANCE_BRANCH ? hash(env.MUNCHKIN_ACCEPTANCE_BRANCH) : null,
  // Accepted into Pi's delivery API does not prove provider/model consumption.
  consumptionObserved: false };
}
