import type { RunStateV1 } from "./run-kernel-types.ts";

export type ProjectionCheck = {
	ok: boolean;
	reason: "ok" | "identity_changed" | "plan_lost" | "mutation_lost" | "failure_lost" | "context_regressed";
};

/** Compare the durable facts that compaction must not erase. */
export function checkCompactionProjection(before: RunStateV1, after: RunStateV1): ProjectionCheck {
	if (before.identity.sessionIdHash !== after.identity.sessionIdHash ||
		before.identity.runIdHash !== after.identity.runIdHash ||
		before.identity.surfaceHash !== after.identity.surfaceHash) {
		return { ok: false, reason: "identity_changed" };
	}
	if (before.plan.accepted && (!after.plan.accepted || after.plan.currentItemHash !== before.plan.currentItemHash ||
		after.plan.openItems !== before.plan.openItems)) return { ok: false, reason: "plan_lost" };
	if (after.mutation.count < before.mutation.count || after.mutation.lastStartedSequence !== before.mutation.lastStartedSequence ||
		after.mutation.lastCompletedSequence !== before.mutation.lastCompletedSequence) return { ok: false, reason: "mutation_lost" };
	if (after.failures.count < before.failures.count || after.failures.exposedEpisodes < before.failures.exposedEpisodes) {
		return { ok: false, reason: "failure_lost" };
	}
	if (after.context.compactionGeneration !== before.context.compactionGeneration + 1) {
		return { ok: false, reason: "context_regressed" };
	}
	return { ok: true, reason: "ok" };
}
