import assert from "node:assert/strict";
import test from "node:test";
import { RunStateStoreV1, validateRunStateSnapshot } from "../lib/run-kernel-state.ts";
import type { ExecutionReceiptV1, RunEventV1 } from "../lib/run-kernel-types.ts";
import { CONTROL_REASON_VALUES, buildControlProposal } from "../lib/control-proposal.ts";

const H = "a".repeat(64);
const legacy = {
	planActive: false, planItemActive: false, planItemHash: null, planOpenItems: null,
	planBlockedItems: null, verifyKnown: false, verifyMutated: false, verifyOk: false,
};

function session(sequence = 1): RunEventV1 {
	return { v: 1, type: "run/session-started", sequence, atMs: sequence, sessionIdHash: H, runIdHash: H,
		generation: 1, surfaceHash: H, piVersion: "0.83.2", provider: "local", model: "small",
		activeToolCount: 4, allToolCount: 8, preservedExplicitTools: false, detectedGateHash: H,
		sandboxPosture: "unknown", legacy };
}

function receipt(overrides: Partial<ExecutionReceiptV1> = {}): ExecutionReceiptV1 {
	return { v: 1, toolCallIdHash: H, toolName: "read", toolFamily: "read", targetHash: H,
		planItemHash: H, startedSequence: 2, endedSequence: 3, startedAtMs: 2, endedAtMs: 3,
		status: "succeeded", isError: false, mutation: "none", verification: "none", failureClass: null,
		resultBytes: 0, hadStart: true, hadToolResult: true, surfaceHash: H, ...overrides };
}

function apply(store: RunStateStoreV1, event: RunEventV1): void {
	assert.equal(store.apply(event).applied, true);
}

test("operational settlement is distinct from semantic completion", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/cycle-started", sequence: 2, atMs: 2, cycleIdHash: H, runIdHash: null });
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 3, atMs: 3, textOnly: false });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 4, atMs: 4 });
	assert.equal(store.snapshot().lifecycle.state, "idle");
	assert.equal(store.snapshot().outcome.status, "paused");
	assert.notEqual(store.snapshot().workflow.phase, "complete");
});

test("only a verifier started after the latest successful mutation is valid", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/tool-finished", sequence: 10, atMs: 10,
		receipt: receipt({ toolName: "edit", toolFamily: "file_mutation", mutation: "source", startedSequence: 4, endedSequence: 10 }) });
	apply(store, { v: 1, type: "run/tool-finished", sequence: 11, atMs: 11,
		receipt: receipt({ toolName: "bash", toolFamily: "bash:verify", verification: "project_gate", startedSequence: 9, endedSequence: 11 }) });
	assert.equal(store.snapshot().verification.validAfterMutation, false, "overlapping verifier cannot prove the later mutation");
	apply(store, { v: 1, type: "run/tool-finished", sequence: 13, atMs: 13,
		receipt: receipt({ toolName: "verify_project", toolFamily: "verify_project", verification: "project_gate", startedSequence: 12, endedSequence: 13 }) });
	assert.equal(store.snapshot().verification.validAfterMutation, true);
	apply(store, { v: 1, type: "run/tool-finished", sequence: 15, atMs: 15,
		receipt: receipt({ toolName: "write", toolFamily: "file_mutation", mutation: "source", startedSequence: 14, endedSequence: 15 }) });
	assert.equal(store.snapshot().verification.validAfterMutation, false, "a later mutation invalidates prior green evidence");
});

test("accepted planning remains paused even after a green gate", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/tool-finished", sequence: 3, atMs: 3,
		receipt: receipt({ toolName: "plan_write", toolFamily: "plan", mutation: "plan" }) });
	apply(store, { v: 1, type: "run/tool-finished", sequence: 5, atMs: 5,
		receipt: receipt({ toolName: "bash", toolFamily: "bash:verify", verification: "project_gate", startedSequence: 4, endedSequence: 5 }) });
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 6, atMs: 6, textOnly: true });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 7, atMs: 7 });
	assert.equal(store.snapshot().outcome.status, "paused");
	assert.notEqual(store.snapshot().workflow.phase, "complete");
});

test("a fully closed structured plan can complete without conflating settlement", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/tool-finished", sequence: 3, atMs: 3,
		receipt: receipt({ toolName: "plan_write", toolFamily: "plan", mutation: "plan" }) });
	apply(store, { v: 1, type: "run/legacy-observed", sequence: 4, atMs: 4,
		legacy: { ...legacy, planActive: true, planOpenItems: 0 } });
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 5, atMs: 5, textOnly: true });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 6, atMs: 6 });
	assert.equal(store.snapshot().outcome.status, "complete");
	assert.equal(store.snapshot().workflow.phase, "complete");
});

test("a closed accepted plan completes without requiring a text-only marker", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/plan-observed", sequence: 2, atMs: 2,
		runIdHash: H, accepted: true, executionStarted: true, openItems: 0 });
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 3, atMs: 3, textOnly: false });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 4, atMs: 4 });
	assert.equal(store.snapshot().outcome.status, "complete");
	assert.equal(store.snapshot().workflow.phase, "complete");
});

test("an active failure wall prevents semantic completion at settlement", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/failure-state-observed", sequence: 2, atMs: 2,
		activeWalls: 1, exposedEpisodes: 1, lastClass: "edit_conflict" });
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 3, atMs: 3, textOnly: true });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 4, atMs: 4 });
	assert.equal(store.snapshot().outcome.status, "paused");
	assert.equal(store.snapshot().workflow.phase, "recovery");
});

test("manual recovery clears walls, reopens the run, and records a transition", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/failure-state-observed", sequence: 2, atMs: 2,
		activeWalls: 2, exposedEpisodes: 1, lastClass: "edit_conflict" });
	const result = store.apply({ v: 1, type: "run/recovery-resumed", sequence: 3, atMs: 3, cleared: 1, blocked: 2 });
	assert.equal(result.applied, true);
	assert.equal(store.snapshot().failures.activeWalls, 0);
	assert.equal(store.snapshot().failures.exposedEpisodes, 0);
	assert.equal(store.snapshot().outcome.status, "active");
	assert.equal(store.snapshot().workflow.reason, "manual-resume");
	assert.equal(store.snapshot().workflow.history.at(-1)?.reason, "manual-resume");
});

test("text-only read-only run can complete and next cycle gets a new run", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 2, atMs: 2, textOnly: true });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 3, atMs: 3 });
	assert.equal(store.snapshot().outcome.status, "complete");
	const next = "b".repeat(64);
	apply(store, { v: 1, type: "run/cycle-started", sequence: 4, atMs: 4, cycleIdHash: next, runIdHash: next });
	assert.equal(store.snapshot().identity.runIdHash, next);
	assert.equal(store.snapshot().workflow.phase, "intake");
	assert.equal(store.snapshot().outcome.status, "active");
});

test("a new objective after completion resets the run without retaining prompt text", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/cycle-ended", sequence: 2, atMs: 2, textOnly: true });
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 3, atMs: 3 });
	const next = "b".repeat(64);
	const objective = "d".repeat(64);
	apply(store, { v: 1, type: "run/objective-observed", sequence: 4, atMs: 4, objectiveHash: objective, runIdHash: next });
	const state = store.snapshot();
	assert.equal(state.identity.runIdHash, next);
	assert.equal(state.objective.hash, objective);
	assert.equal(state.objective.label, null);
	assert.equal(state.outcome.status, "active");
});

test("compaction preserves run identity and snapshot stays persistence-safe", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/session-compacted", sequence: 2, atMs: 2 });
	const state = store.snapshot();
	assert.equal(state.identity.runIdHash, H);
	assert.equal(state.workflow.phase, "recovery");
	assert.equal(state.context.compactionGeneration, 1);
	assert.deepEqual(validateRunStateSnapshot(state), []);
});

test("failure and exported blocked-plan facts enter recovery and blocked phases", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/tool-finished", sequence: 2, atMs: 2,
		receipt: receipt({ status: "failed", isError: true, failureClass: "not_found" }) });
	assert.equal(store.snapshot().workflow.phase, "recovery");
	apply(store, { v: 1, type: "run/legacy-observed", sequence: 3, atMs: 3,
		legacy: { ...legacy, planActive: true, planOpenItems: 1, planBlockedItems: 1 } });
	assert.equal(store.snapshot().workflow.phase, "blocked");
	apply(store, { v: 1, type: "run/cycle-settled", sequence: 4, atMs: 4 });
	assert.equal(store.snapshot().outcome.status, "blocked");
});

test("transition history is bounded and duplicate sequences are ignored", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	for (let i = 2; i < 82; i += 2) {
		apply(store, { v: 1, type: "run/tool-started", sequence: i, atMs: i,
			receipt: { ...receipt({ toolName: "read" }), startedSequence: i } });
		apply(store, { v: 1, type: "run/session-compacted", sequence: i + 1, atMs: i + 1 });
	}
	assert.equal(store.snapshot().workflow.history.length, 32);
	assert.equal(store.apply({ v: 1, type: "run/cycle-settled", sequence: 81, atMs: 81 }).applied, false);
});

test("control proposals and decisions enter RunState without message text", () => {
	const store = new RunStateStoreV1();
	apply(store, session());
	const proposal = buildControlProposal({
		boundarySequence: 7, kind: "verification_required", reason: "exact_gate_missing",
		source: "verify-gate", cooldownKey: "verify", messageFactory: "verify-wrap", legacyActed: true,
	});
	apply(store, { v: 1, type: "run/control-proposed", sequence: 2, atMs: 2, proposal });
	apply(store, {
		v: 1, type: "run/control-decided", sequence: 3, atMs: 3,
		decision: { v: 1, boundarySequence: 7, mode: "shadow", proposalCount: 2, collisionCount: 1, legacyActionCount: 2, winner: proposal, delivered: [] },
	});
	const state = store.snapshot();
	assert.equal(state.control.proposals, 1);
	assert.equal(state.control.collisions, 1);
	assert.equal(state.control.boundarySequence, 7);
	assert.deepEqual(state.control.lastDecision, {
		kind: "verification_required", reason: "exact_gate_missing", source: "verify-gate", priority: 500, mode: "shadow",
	});
	assert.deepEqual(validateRunStateSnapshot(state), []);
	assert.equal(JSON.stringify(state).includes("message"), false);
});

test("an over-budget context reading is clamped instead of killing the snapshot channel", () => {
	// Context usage is reported above 100% when a run exceeds its budget. The
	// snapshot contract caps it at 100, so an unclamped reading made
	// validateRunStateSnapshot reject the whole state — silently ending the
	// evidence stream exactly when the run was in trouble.
	const store = new RunStateStoreV1();
	apply(store, session());
	apply(store, { v: 1, type: "run/context-observed", sequence: 2, atMs: 2, usagePct: 137.5 });
	const over = store.snapshot();
	assert.equal(over.context.usagePct, 100);
	assert.deepEqual(validateRunStateSnapshot(over), [], "the snapshot stays valid and keeps flowing");

	apply(store, { v: 1, type: "run/context-observed", sequence: 3, atMs: 3, usagePct: -4 });
	assert.equal(store.snapshot().context.usagePct, 0);
	apply(store, { v: 1, type: "run/context-observed", sequence: 4, atMs: 4, usagePct: null });
	assert.equal(store.snapshot().context.usagePct, null, "null still means unknown");
	apply(store, { v: 1, type: "run/context-observed", sequence: 5, atMs: 5, usagePct: 42 });
	assert.equal(store.snapshot().context.usagePct, 42, "ordinary readings pass through");
});

// Enum-parity guard (2026-08-18). `verification_plateau` entered the control
// vocabulary with the shadow plateau feature but not run-kernel-state's validator,
// so a plateau decision made validateRunStateSnapshot reject the whole state —
// capsule persistence stops silently and the round yields no settled row. Drives
// the REAL store per reason and asserts the validator returns zero errors, so the
// two vocabularies can never drift apart again. (validateRunStateSnapshot RETURNS
// errors, it does not throw — an assert.doesNotThrow here would pass vacuously.)
test("every canonical control reason survives run-state validation", () => {
	for (const reason of CONTROL_REASON_VALUES) {
		const store = new RunStateStoreV1();
		apply(store, session());
		const proposal = buildControlProposal({
			boundarySequence: 7, kind: "failure_recovery", reason, source: "verify-gate",
			cooldownKey: `parity:${reason}`, messageFactory: "verify-wrap",
		});
		apply(store, { v: 1, type: "run/control-proposed", sequence: 2, atMs: 2, proposal });
		apply(store, {
			v: 1, type: "run/control-decided", sequence: 3, atMs: 3,
			decision: { v: 1, boundarySequence: 7, mode: "enforce", proposalCount: 1, collisionCount: 0, legacyActionCount: 0, winner: proposal, delivered: [proposal.proposalIdHash] },
		});
		const state = store.snapshot();
		assert.equal(state.control.lastDecision?.reason, reason);
		assert.deepEqual(validateRunStateSnapshot(state), [],
			`control reason ${reason} must be accepted by the persisted-state validator`);
	}
});
