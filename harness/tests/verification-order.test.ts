import assert from "node:assert/strict";
import test from "node:test";
import { VerificationOrderClock } from "../lib/verification-order.ts";

test("an overlapping verifier cannot verify a mutation that finishes after it starts", () => {
	const clock = new VerificationOrderClock();
	clock.start({ callId: "mutation", kind: "source_mutation" });
	clock.start({ callId: "gate", kind: "verification" });
	assert.equal(clock.finish({ callId: "mutation", succeeded: true })?.mutationSettled, true);
	const gate = clock.finish({ callId: "gate", succeeded: true });
	assert.equal(gate?.verificationPassed, true);
	assert.equal(gate?.verificationValid, false);
});

test("a failed mutation attempt disarms earlier green evidence", () => {
	const clock = new VerificationOrderClock();
	clock.start({ callId: "gate-1", kind: "verification" });
	assert.equal(clock.finish({ callId: "gate-1", succeeded: true })?.verificationValid, true);
	clock.start({ callId: "mutation", kind: "source_mutation" });
	const mutation = clock.finish({ callId: "mutation", succeeded: false });
	assert.equal(mutation?.mutationAttempted, true);
	assert.equal(mutation?.mutationSettled, true);
	clock.start({ callId: "gate-overlap", kind: "verification" });
	assert.equal(clock.finish({ callId: "gate-overlap", succeeded: true })?.verificationValid, true,
		"only a verifier started after the failed mutation settled can restore green evidence");
});

test("a pending mutation prevents later verifiers from becoming valid", () => {
	const clock = new VerificationOrderClock();
	clock.start({ callId: "mutation", kind: "source_mutation" });
	clock.start({ callId: "gate", kind: "verification" });
	assert.equal(clock.finish({ callId: "gate", succeeded: true })?.verificationValid, false);
});

test("an overlapping verifier cannot recover a failed mutation attempt", () => {
	const clock = new VerificationOrderClock();
	clock.start({ callId: "mutation", kind: "source_mutation" });
	clock.start({ callId: "gate", kind: "verification" });
	clock.finish({ callId: "mutation", succeeded: false });
	assert.equal(clock.finish({ callId: "gate", succeeded: true })?.verificationValid, false);
});

test("a verifier started after mutation completion is valid and a later mutation disarms it", () => {
	const clock = new VerificationOrderClock();
	clock.start({ callId: "mutation-1", kind: "source_mutation" });
	clock.finish({ callId: "mutation-1", succeeded: true });
	clock.start({ callId: "gate", kind: "verification" });
	assert.equal(clock.finish({ callId: "gate", succeeded: true })?.verificationValid, true);
	clock.start({ callId: "mutation-2", kind: "source_mutation" });
	assert.equal(clock.finish({ callId: "mutation-2", succeeded: true })?.mutationSettled, true);
	clock.start({ callId: "gate-2", kind: "verification" });
	assert.equal(clock.finish({ callId: "gate-2", succeeded: false })?.verificationValid, false);
});

test("missing starts and duplicate ends cannot manufacture verification", () => {
	const clock = new VerificationOrderClock();
	assert.equal(clock.finish({ callId: "missing", succeeded: true }), null);
	clock.start({ callId: "gate", kind: "verification" });
	assert.equal(clock.hasCompleted("gate"), false);
	assert.equal(clock.finish({ callId: "gate", succeeded: true })?.verificationValid, true);
	assert.equal(clock.hasCompleted("gate"), true);
	assert.equal(clock.finish({ callId: "gate", succeeded: true }), null);
});

test("a proven pre-execution refusal cancels a pending mutation", () => {
	const clock = new VerificationOrderClock();
	clock.start({ callId: "blocked", kind: "source_mutation" });
	assert.equal(clock.hasPendingMutations(), true);
	assert.equal(clock.prevent("blocked"), "source_mutation");
	assert.equal(clock.hasPendingMutations(), false);
	assert.equal(clock.hasCompleted("blocked"), true);
	clock.start({ callId: "gate", kind: "verification" });
	assert.equal(clock.finish({ callId: "gate", succeeded: true })?.verificationValid, true);
});
