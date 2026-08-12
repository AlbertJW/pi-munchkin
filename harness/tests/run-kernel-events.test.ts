// Structural guard for the run-event channel.
//
// Why this file exists: `run/plan-gate-observed` lived in the RunEventV1 union,
// the reducer, the dispatcher AND this validator's payload switch — but not in
// RUN_EVENT_TYPES, the set that admits an event in the first place. So
// isRunEventV1() rejected every plan gate before the reducer ever saw one, and
// two shipped fixes that depend on that path (gate identity; order-independent
// verification) were inert in production for days while their tests passed —
// because those tests called the reducer DIRECTLY, bypassing the channel.
//
// The lesson is not "add the missing string". It is that a TypeScript union and
// its runtime validator are two representations of one schema with nothing tying
// them together, and types vanish at runtime so no compiler check spans them.
// This file ties them together: the union is parsed from source, and every member
// must both be admitted AND accept a real sample payload. Adding a union member
// without wiring it fails here.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { isRunEventV1 } from "../lib/run-kernel-events.ts";
import type { RunEventV1 } from "../lib/run-kernel-types.ts";

const H = "a".repeat(64);
const base = { v: 1 as const, sequence: 3, atMs: 3 };

const start = {
	toolCallIdHash: H, toolName: "edit", toolFamily: "edit", targetHash: H, planItemHash: H,
	startedSequence: 1, startedAtMs: 1, mutation: "source", verification: "none", surfaceHash: H,
};
const legacy = {
	planActive: true, planItemActive: true, planItemHash: H, planOpenItems: 2, planBlockedItems: 0,
	verifyKnown: true, verifyMutated: false, verifyOk: true,
};

// One VALID sample per union member, matching each case's exact key set. The
// coverage test below proves this table is exhaustive, so a new event type
// cannot be added without landing here.
const SAMPLES: Record<string, RunEventV1> = {
	"run/session-started": { ...base, type: "run/session-started", sessionIdHash: H, runIdHash: H, generation: 0,
		surfaceHash: H, piVersion: "0.84.1", provider: "llama", model: "qwen36-35b-iq3s", activeToolCount: 9,
		allToolCount: 11, preservedExplicitTools: false, detectedGateHash: H, sandboxPosture: "host", legacy },
	"run/cycle-started": { ...base, type: "run/cycle-started", cycleIdHash: H, runIdHash: H },
	"run/objective-observed": { ...base, type: "run/objective-observed", objectiveHash: H, runIdHash: H },
	"run/tool-started": { ...base, type: "run/tool-started", receipt: start },
	"run/tool-finished": { ...base, type: "run/tool-finished", receipt: { v: 1, ...start, endedSequence: 2,
		endedAtMs: 2, status: "succeeded", isError: false, failureClass: null, resultBytes: 12,
		hadStart: true, hadToolResult: true } },
	"run/legacy-observed": { ...base, type: "run/legacy-observed", legacy },
	"run/control-proposed": { ...base, type: "run/control-proposed", proposal: { v: 1, proposalIdHash: H,
		boundarySequence: 4, kind: "verification_required", priority: 500, reason: "exact_gate_missing",
		source: "verify-gate", cooldownKeyHash: H, messageFactory: "verify-wrap", effect: "message", legacyActed: true } },
	// proposalCount 0 <=> winner null is a cross-field invariant in isControlDecision.
	"run/control-decided": { ...base, type: "run/control-decided", decision: { v: 1, boundarySequence: 4,
		mode: "shadow", proposalCount: 0, collisionCount: 0, legacyActionCount: 0, winner: null } },
	"run/plan-observed": { ...base, type: "run/plan-observed", runIdHash: H, accepted: true, executionStarted: false, openItems: 2 },
	"run/plan-gate-observed": { ...base, type: "run/plan-gate-observed", runIdHash: H, pass: true, fails: 0, gateHash: H },
	"run/context-observed": { ...base, type: "run/context-observed", usagePct: 42 },
	"run/failure-state-observed": { ...base, type: "run/failure-state-observed", activeWalls: 1, exposedEpisodes: 1, lastClass: "verification_assertion" },
	"run/recovery-resumed": { ...base, type: "run/recovery-resumed", cleared: 1, blocked: 0 },
	"run/cycle-ended": { ...base, type: "run/cycle-ended", textOnly: false },
	"run/cycle-settled": { ...base, type: "run/cycle-settled" },
	"run/session-compacted": { ...base, type: "run/session-compacted" },
	"run/session-shutdown": { ...base, type: "run/session-shutdown" },
	"run/phase-changed": { ...base, type: "run/phase-changed", transition: { sequence: 3, atMs: 3, from: "planning", to: "execution", reason: "plan_go" } },
} as unknown as Record<string, RunEventV1>;

function unionMembersFromSource(): string[] {
	// The union is the SOURCE OF TRUTH and it is erased at runtime, so parse it.
	const source = readFileSync(resolve(import.meta.dirname, "../lib/run-kernel-types.ts"), "utf8");
	const found = new Set<string>();
	for (const match of source.matchAll(/type:\s*"(run\/[a-z-]+)"/g)) found.add(match[1]);
	return [...found].sort();
}

test("every RunEventV1 union member is ADMITTED by the validator", () => {
	const union = unionMembersFromSource();
	assert.ok(union.length >= 15, `parsed only ${union.length} union members — the parser drifted, fix it`);
	const rejected = union.filter((type) => !isRunEventV1({ ...SAMPLES[type] ?? { ...base, type } }));
	assert.deepEqual(rejected, [],
		"these event types exist in the union but the validator drops them — they can never reach the reducer in production");
});

test("the sample table is exhaustive — a new event type cannot skip this file", () => {
	const union = unionMembersFromSource();
	assert.deepEqual(union.filter((type) => !(type in SAMPLES)), [],
		"add a valid sample for each new event type; a type with no sample is a type nobody proved can be dispatched");
	assert.deepEqual(Object.keys(SAMPLES).filter((type) => !union.includes(type)), [],
		"this sample names an event type that no longer exists in the union");
});

test("the validator still REJECTS malformed and unknown events (guard not widened)", () => {
	assert.equal(isRunEventV1({ ...base, type: "run/not-a-real-event" }), false);
	assert.equal(isRunEventV1({ ...SAMPLES["run/plan-gate-observed"], gateHash: "not-a-hash" }), false, "payload shape is still enforced");
	assert.equal(isRunEventV1({ ...SAMPLES["run/plan-gate-observed"], pass: "yes" }), false);
	assert.equal(isRunEventV1({ ...SAMPLES["run/objective-observed"], objectiveHash: 42 }), false);
	assert.equal(isRunEventV1({ v: 2, type: "run/cycle-started", sequence: 1, atMs: 1 }), false, "wrong envelope version");
	assert.equal(isRunEventV1(null), false);
	assert.equal(isRunEventV1("run/cycle-started"), false);
	// gateHash: null is legitimate (a gate whose identity could not be computed).
	assert.equal(isRunEventV1({ ...SAMPLES["run/plan-gate-observed"], gateHash: null }), true);
});
