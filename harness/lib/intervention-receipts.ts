import { createHash } from "node:crypto";
import { runtimeValue, runtimeIdentity } from "./runtime-ownership.ts";
import type { ControlProposalV1 } from "./control-proposal.ts";
export type InterventionStage = "proposed" | "selected" | "dispatch-accepted" | "dispatch-rejected";
const requestField = { key: "intervention-request-correlation", lifetime: "session" as const, create: () => ({ sequence: 0, awaiting: new Set<string>() }) };
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export function interventionReceipt(bus: object, proposal: ControlProposalV1, stage: InterventionStage, request: number | null, env = process.env) {
 const identity = runtimeIdentity(bus);
 if (stage === "dispatch-accepted") { const state = runtimeValue(bus, requestField); state.awaiting.add(proposal.proposalIdHash); if (state.awaiting.size > 64) state.awaiting.delete(state.awaiting.values().next().value!); }
 return { v: 1, stage, proposalIdHash: proposal.proposalIdHash, source: proposal.source, reason: proposal.reason,
  boundarySequence: proposal.boundarySequence, request, generation: identity.generation,
  sessionIdHash: identity.sessionId === null ? null : hash(identity.sessionId),
  taskIdHash: env.MUNCHKIN_ACCEPTANCE_TASK ? hash(env.MUNCHKIN_ACCEPTANCE_TASK) : null,
  runIdHash: env.MUNCHKIN_ACCEPTANCE_RUN ? hash(env.MUNCHKIN_ACCEPTANCE_RUN) : null,
  branchIdHash: env.MUNCHKIN_ACCEPTANCE_BRANCH ? hash(env.MUNCHKIN_ACCEPTANCE_BRANCH) : null,
  // Accepted into Pi's delivery API does not prove provider/model consumption.
  consumptionObserved: false };
}

/** Correlation only: a request following acceptance does not prove the text survived every transform. */
export function beginProviderRequest(bus: object, env = process.env) {
 const state = runtimeValue(bus, requestField);
 const acceptedProposalIds = [...state.awaiting]; state.awaiting.clear();
 return { request: ++state.sequence, acceptedProposalIds,
  taskIdHash: env.MUNCHKIN_ACCEPTANCE_TASK ? hash(env.MUNCHKIN_ACCEPTANCE_TASK) : null,
  runIdHash: env.MUNCHKIN_ACCEPTANCE_RUN ? hash(env.MUNCHKIN_ACCEPTANCE_RUN) : null,
  branchIdHash: env.MUNCHKIN_ACCEPTANCE_BRANCH ? hash(env.MUNCHKIN_ACCEPTANCE_BRANCH) : null,
  consumptionObserved: false };
}
