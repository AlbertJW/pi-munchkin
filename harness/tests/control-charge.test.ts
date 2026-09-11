import assert from "node:assert/strict";
import test from "node:test";
import { createDeliveryCharge } from "../lib/control-charge.ts";
import { buildControlProposal, emitControlDecision, type ControlDecisionV1, type ControlProposalV1 } from "../lib/control-proposal.ts";
import { makeFakePi } from "./integration-harness.ts";

function decisionFor(winner: ControlProposalV1, delivered: string[]): ControlDecisionV1 {
	return {
		v: 1, boundarySequence: winner.boundarySequence, mode: "enforce",
		proposalCount: 1, collisionCount: 0, legacyActionCount: 0, winner, delivered,
	};
}

function proposal(boundarySequence: number): ControlProposalV1 {
	return buildControlProposal({
		boundarySequence, kind: "failure_recovery", reason: "outcome_repeat", source: "loop-breaker",
		cooldownKey: "test", messageFactory: "loop-outcome",
	});
}

test("settle fires true when the boundary's decision delivered this proposal's hash", () => {
	const fp = makeFakePi();
	const charge = createDeliveryCharge(fp.pi.events, "test:delivered");
	const won = proposal(1);
	let settled: boolean | null = null;
	charge.awaitDecision(won, (delivered) => { settled = delivered; });
	emitControlDecision(fp.pi.events, decisionFor(won, [won.proposalIdHash]));
	assert.equal(settled, true);
});

test("settle fires false when the boundary's decision did not deliver this proposal's hash", () => {
	const fp = makeFakePi();
	const charge = createDeliveryCharge(fp.pi.events, "test:not-delivered");
	const lost = proposal(1);
	const won = proposal(1);
	let settled: boolean | null = null;
	charge.awaitDecision(lost, (delivered) => { settled = delivered; });
	// The arbiter's own decision names a different winner for the same boundary;
	// `lost`'s hash is absent from `delivered`.
	emitControlDecision(fp.pi.events, decisionFor(won, [won.proposalIdHash]));
	assert.equal(settled, false);
});

test("a decision for a different boundary does not settle a proposal parked on another", () => {
	const fp = makeFakePi();
	const charge = createDeliveryCharge(fp.pi.events, "test:boundary-mismatch");
	const parked = proposal(5);
	let settleCalls = 0;
	charge.awaitDecision(parked, () => { settleCalls += 1; });
	// A stale or unrelated boundary's decision must never resolve this parked record —
	// resolving it here would charge the wrong turn (module docstring).
	emitControlDecision(fp.pi.events, decisionFor(proposal(6), []));
	assert.equal(settleCalls, 0, "the mismatched-boundary decision must not settle");
	// The matching boundary's decision still settles it afterward.
	emitControlDecision(fp.pi.events, decisionFor(parked, [parked.proposalIdHash]));
	assert.equal(settleCalls, 1);
});

test("forget() drops the parked proposal before its boundary decides", () => {
	const fp = makeFakePi();
	const charge = createDeliveryCharge(fp.pi.events, "test:forget");
	const parked = proposal(9);
	let settleCalls = 0;
	charge.awaitDecision(parked, () => { settleCalls += 1; });
	charge.forget();
	emitControlDecision(fp.pi.events, decisionFor(parked, [parked.proposalIdHash]));
	assert.equal(settleCalls, 0, "a forgotten proposal's boundary decision must not settle it");
});

test("no decision ever arriving never settles — fail-open, the budget is simply not spent", () => {
	const fp = makeFakePi();
	const charge = createDeliveryCharge(fp.pi.events, "test:no-decision");
	let settleCalls = 0;
	charge.awaitDecision(proposal(1), () => { settleCalls += 1; });
	// Nothing emitted at all; an unrelated boundary's decision does not confuse it either.
	emitControlDecision(fp.pi.events, decisionFor(proposal(2), []));
	assert.equal(settleCalls, 0);
});

test("only the latest parked proposal is live — awaitDecision replaces, does not queue", () => {
	const fp = makeFakePi();
	const charge = createDeliveryCharge(fp.pi.events, "test:replace");
	const first = proposal(1);
	const second = proposal(2);
	let firstSettled = 0;
	let secondSettled: boolean | null = null;
	charge.awaitDecision(first, () => { firstSettled += 1; });
	charge.awaitDecision(second, (delivered) => { secondSettled = delivered; });
	// first's own boundary deciding now must not settle it — it was replaced, not queued.
	emitControlDecision(fp.pi.events, decisionFor(first, [first.proposalIdHash]));
	assert.equal(firstSettled, 0, "a replaced parked proposal must never settle");
	emitControlDecision(fp.pi.events, decisionFor(second, [second.proposalIdHash]));
	assert.equal(secondSettled, true);
});

test("re-creating a charge for the same key disposes the previous generation's subscription", () => {
	const fp = makeFakePi();
	const first = createDeliveryCharge(fp.pi.events, "test:reload");
	const parked = proposal(1);
	let firstSettled = 0;
	first.awaitDecision(parked, () => { firstSettled += 1; });
	// A reload re-invokes the factory with the same key; subscribeOnce (module
	// docstring) disposes the stale generation's bus subscription so it cannot
	// double-fire alongside the new one.
	const second = createDeliveryCharge(fp.pi.events, "test:reload");
	let secondSettled = 0;
	second.awaitDecision(proposal(1), () => { secondSettled += 1; });
	emitControlDecision(fp.pi.events, decisionFor(parked, [parked.proposalIdHash]));
	assert.equal(firstSettled, 0, "the disposed generation's parked proposal must not settle");
	assert.equal(secondSettled, 1, "only the current generation observes the decision");
});
