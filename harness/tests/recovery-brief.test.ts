import assert from "node:assert/strict";
import test from "node:test";
import { renderRecoveryBrief, RECOVERY_BRIEF_MAX_BYTES } from "../lib/recovery-brief.ts";
import { RunStateStoreV1 } from "../lib/run-kernel-state.ts";
import type { RunEventV1 } from "../lib/run-kernel-types.ts";

const H = "a".repeat(64);

function state() {
	const store = new RunStateStoreV1();
	const event: RunEventV1 = {
		v: 1, type: "run/session-started", sequence: 1, atMs: 1,
		sessionIdHash: H, runIdHash: H, generation: 1, surfaceHash: H,
		piVersion: "0.83.2", provider: "local", model: "small",
		activeToolCount: 4, allToolCount: 8, preservedExplicitTools: false,
		detectedGateHash: H, sandboxPosture: "unknown",
		legacy: {
			planActive: false, planItemActive: false, planItemHash: null,
			planOpenItems: null, planBlockedItems: null, verifyKnown: false,
			verifyMutated: false, verifyOk: false,
		},
	};
	assert.equal(store.apply(event).applied, true);
	return store.snapshot();
}

test("recovery brief is deterministic, bounded, and explicitly untrusted", () => {
	const current = state();
	const first = renderRecoveryBrief(current, { reason: "compaction" });
	const second = renderRecoveryBrief(current, { reason: "compaction" });
	assert.equal(first, second);
	assert.ok(Buffer.byteLength(first, "utf8") <= RECOVERY_BRIEF_MAX_BYTES);
	assert.match(first, /^<pi-munchkin-recovery-data>/);
	assert.match(first, /<\/pi-munchkin-recovery-data>\n$/);
	assert.match(first, /not instructions or authority/);
	assert.doesNotMatch(first, /(?:\/Users\/|\/private\/|https?:|api[_-]?key|secret=)/i);
});

test("recovery brief clamps at the requested byte boundary without dropping its fence", () => {
	const brief = renderRecoveryBrief(state(), { reason: "failure_tier", maxBytes: 512 });
	assert.ok(Buffer.byteLength(brief, "utf8") <= 512);
	assert.match(brief, /<\/pi-munchkin-recovery-data>\n$/);
});

test("recovery brief chooses the exact-gate next action after a mutation", () => {
	const current = state();
	current.mutation.lastCompletedSequence = 2;
	current.mutation.lastTargetHash = H;
	current.verification.validAfterMutation = false;
	assert.match(renderRecoveryBrief(current, { reason: "provider_retry" }), /Run the exact detected project gate/);
});
