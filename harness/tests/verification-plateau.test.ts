import assert from "node:assert/strict";
import test from "node:test";
import { VerificationPlateauTracker } from "../lib/verification-plateau.ts";

const GATE = "a".repeat(64);
const ITEM = "b".repeat(64);
const OTHER = "c".repeat(64);
const scope = { gateHash: GATE, planItemHash: ITEM };

function failedEpoch(tracker: VerificationPlateauTracker, advanced = false) {
	tracker.noteSuccessfulMutation(scope);
	return tracker.observeExactGate({ ...scope, recognized: true, passed: false, ordered: true, advanced });
}

test("three paired unchanged mutation/gate epochs expose one strict plateau", () => {
	const tracker = new VerificationPlateauTracker();
	assert.equal(failedEpoch(tracker, true).advanced, true, "a productive frontier establishes progress, not a plateau");
	assert.equal(failedEpoch(tracker).reached, null);
	assert.equal(failedEpoch(tracker).reached, null);
	assert.equal(failedEpoch(tracker).reached, 3);
	assert.deepEqual(tracker.snapshot(), {
		v: 1, eligibleEpochs: 3, plateauEvents: 1, maxStreak: 3,
		frontierAdvances: 1, currentStreak: 3, pendingSuccessfulMutation: false,
	});
});

test("one gate consumes at most one mutation and repeated gates cannot manufacture epochs", () => {
	const tracker = new VerificationPlateauTracker();
	tracker.noteSuccessfulMutation(scope);
	tracker.noteSuccessfulMutation(scope);
	tracker.observeExactGate({ ...scope, recognized: true, passed: false, ordered: true, advanced: false });
	tracker.observeExactGate({ ...scope, recognized: true, passed: false, ordered: true, advanced: false });
	assert.equal(tracker.snapshot().eligibleEpochs, 1);
	assert.equal(tracker.snapshot().currentStreak, 0, "an unpaired gate fails closed and clears the candidate streak");
});

test("plan changes, exact green, and frontier advances reset a plateau", () => {
	const tracker = new VerificationPlateauTracker();
	failedEpoch(tracker);
	failedEpoch(tracker);
	tracker.notePlanItem(OTHER);
	assert.equal(tracker.snapshot().currentStreak, 0);
	failedEpoch(tracker);
	tracker.observeExactGate({ ...scope, recognized: false, passed: true, ordered: true, advanced: false });
	assert.equal(tracker.snapshot().currentStreak, 0, "exact exit success ends the failed plateau even without TAP counts");
	failedEpoch(tracker);
	assert.equal(failedEpoch(tracker, true).advanced, true);
	assert.equal(tracker.snapshot().currentStreak, 0);
});

test("unknown or overlapping gates cannot consume the pending successful mutation", () => {
	const tracker = new VerificationPlateauTracker();
	tracker.noteSuccessfulMutation(scope);
	tracker.observeExactGate({ ...scope, recognized: false, passed: false, ordered: true, advanced: false });
	assert.equal(tracker.snapshot().pendingSuccessfulMutation, true);
	tracker.observeExactGate({ ...scope, recognized: true, passed: false, ordered: false, advanced: false });
	assert.equal(tracker.snapshot().pendingSuccessfulMutation, true);
	tracker.observeExactGate({ ...scope, recognized: true, passed: false, ordered: true, advanced: false });
	assert.equal(tracker.snapshot().eligibleEpochs, 1);
});

test("five unchanged epochs expose activation tier without another steer tier", () => {
	const tracker = new VerificationPlateauTracker();
	const reached = Array.from({ length: 5 }, () => failedEpoch(tracker).reached);
	assert.deepEqual(reached, [null, null, 3, null, 5]);
	assert.equal(tracker.snapshot().plateauEvents, 1);
});
