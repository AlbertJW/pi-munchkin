import assert from "node:assert/strict";
import test from "node:test";
import { checkCompactionProjection } from "../lib/projection-invariants.ts";
import { RunStateStoreV1 } from "../lib/run-kernel-state.ts";
import type { RunEventV1 } from "../lib/run-kernel-types.ts";

function statePair(): [ReturnType<RunStateStoreV1["snapshot"]>, ReturnType<RunStateStoreV1["snapshot"]>] {
	const store = new RunStateStoreV1();
	const start: RunEventV1 = {
		v: 1, sequence: 1, atMs: 1, type: "run/session-started", sessionIdHash: "a".repeat(64),
		runIdHash: "b".repeat(64), generation: 1, surfaceHash: "c".repeat(64), piVersion: "0.83",
		provider: "local", model: "ling", activeToolCount: 4, allToolCount: 8, preservedExplicitTools: false,
		detectedGateHash: null, sandboxPosture: "unknown", legacy: {
			planActive: true, planItemActive: true, planItemHash: "d".repeat(64), planOpenItems: 1,
			planBlockedItems: 0, verifyKnown: true, verifyMutated: true, verifyOk: false,
		},
	};
	store.apply(start);
	const before = store.snapshot();
	store.apply({ v: 1, sequence: 2, atMs: 2, type: "run/session-compacted" });
	return [before, store.snapshot()];
}

test("compaction projection preserves identity and durable run facts", () => {
	const [before, after] = statePair();
	assert.deepEqual(checkCompactionProjection(before, after), { ok: true, reason: "ok" });
});

test("projection check rejects identity loss", () => {
	const [before, after] = statePair();
	after.identity.surfaceHash = "e".repeat(64);
	assert.deepEqual(checkCompactionProjection(before, after), { ok: false, reason: "identity_changed" });
});
