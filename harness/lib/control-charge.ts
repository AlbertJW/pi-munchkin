// control-charge — spend a one-shot budget when the model HEARD the message, not
// when the producer composed it.
//
// Fifteen of the harness's sixteen charge sites mutate their own latch or counter
// before calling `emitControlProposal`, and then record an `injected_chars` row for
// it. The arbiter picks one winner per boundary and drops the rest, so under the
// shipped `CONTROL_ARBITER=enforce` a producer routinely spends its budget — and
// reports an intervention — for a message nobody read. That is the signal every
// efficiency measurement is built on, so it corrupts the instrument, not just a log.
//
// Keying on `decision.winner` is NOT the fix, and two of the producers prove why:
// the arbiter's merge rescues attach a loser's text to the winner's, so verify-gate's
// wrap nag is often delivered while the winner names loop-breaker, and the state lens
// (priority 100, triggered by a 600) can never win at all yet is delivered whenever
// it merges. `decision.delivered` carries the honest set; this helper is the shape
// that consumes it.
//
// Fail-open by construction: if no decision ever arrives for the boundary, the budget
// is simply not spent. For a MESSAGE budget that is the safe direction — under-spend
// means the model might hear one more correction, over-spend means it silently hears
// none.

import type { EventBus } from "@earendil-works/pi-coding-agent";
import { onControlDecision, type ControlProposalV1 } from "./control-proposal.ts";
import { subscribeOnce } from "./extension-lifecycle.ts";

export type DeliveryCharge = {
	/** Park a proposal. `settle` runs once, when THIS proposal's boundary is decided. */
	awaitDecision(proposal: ControlProposalV1, settle: (delivered: boolean) => void): void;
	/** Drop any parked proposal — call at a session or agent boundary. */
	forget(): void;
};

/**
 * `key` must be unique per producer; it names the bus subscription so a reload
 * disposes the previous generation's rather than stacking a new one beside it.
 */
export function createDeliveryCharge(events: EventBus, key: string): DeliveryCharge {
	let pending: { hash: string; boundary: number; settle: (delivered: boolean) => void } | null = null;

	subscribeOnce(`${key}:control-decision`, () => onControlDecision(events, (decision) => {
		// A boundary can produce NO decision at all — the arbiter clears its queue on
		// agent_start and MAX_PENDING evicts the oldest boundary — so a parked record
		// must only ever be settled by its OWN boundary. Resolving it against whatever
		// decision arrives next charges the wrong turn.
		if (!pending || decision.boundarySequence !== pending.boundary) return;
		const parked = pending;
		pending = null;
		parked.settle(decision.delivered.includes(parked.hash));
	}));

	return {
		awaitDecision(proposal, settle) {
			pending = { hash: proposal.proposalIdHash, boundary: proposal.boundarySequence, settle };
		},
		forget() { pending = null; },
	};
}
