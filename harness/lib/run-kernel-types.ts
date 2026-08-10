import type { FailureClass } from "./failure-episodes.ts";

export type RunKernelMode = "shadow" | "off";
export type RunLifecycle = "starting" | "active" | "settling" | "idle" | "shutdown";
export type RunPhase =
	| "intake"
	| "local_recon"
	| "external_research"
	| "preflight"
	| "planning"
	| "execution"
	| "verification"
	| "recovery"
	| "blocked"
	| "complete";
export type RunOutcome = "active" | "complete" | "blocked" | "paused" | "unverified";
export type ReceiptStatus = "succeeded" | "failed" | "rejected" | "missing_result";
export type MutationKind = "none" | "source" | "plan" | "state";
export type VerificationKind = "project_gate" | "generic" | "none";

export interface ExecutionReceiptV1 {
	v: 1;
	toolCallIdHash: string;
	toolName: string;
	toolFamily: string;
	targetHash: string;
	planItemHash: string;
	startedSequence: number;
	endedSequence: number;
	startedAtMs: number;
	endedAtMs: number;
	status: ReceiptStatus;
	isError: boolean;
	mutation: MutationKind;
	verification: VerificationKind;
	failureClass: FailureClass | null;
	resultBytes: number;
	hadStart: boolean;
	hadToolResult: boolean;
	surfaceHash: string;
}

export interface LegacyRunSnapshotV1 {
	planActive: boolean;
	planItemActive: boolean;
	planItemHash: string | null;
	planOpenItems: number | null;
	planBlockedItems: number | null;
	verifyKnown: boolean;
	verifyMutated: boolean;
	verifyOk: boolean;
}

export interface RunTransitionV1 {
	sequence: number;
	atMs: number;
	from: RunPhase;
	to: RunPhase;
	reason: string;
}

export interface RunStateV1 {
	v: 1;
	mode: "shadow";
	identity: {
		sessionIdHash: string;
		runIdHash: string;
		cycleIdHash: string | null;
		generation: number;
		surfaceHash: string;
	};
	lifecycle: {
		state: RunLifecycle;
		lastTransitionSequence: number;
	};
	workflow: {
		phase: RunPhase;
		previousPhase: RunPhase | null;
		reason: string;
		history: RunTransitionV1[];
	};
	objective: { hash: string | null; label: string | null };
	environment: {
		piVersion: string;
		provider: string;
		model: string;
		activeToolCount: number;
		allToolCount: number;
		preservedExplicitTools: boolean;
		detectedGateHash: string | null;
	};
	plan: {
		accepted: boolean;
		executionStarted: boolean;
		currentItemHash: string | null;
		openItems: number | null;
		blockedItems: number | null;
	};
	mutation: {
		count: number;
		lastStartedSequence: number | null;
		lastCompletedSequence: number | null;
		lastTargetHash: string | null;
	};
	verification: {
		attempts: number;
		validGates: number;
		lastKind: VerificationKind;
		lastStartedSequence: number | null;
		lastEndedSequence: number | null;
		lastPassed: boolean;
		validAfterMutation: boolean;
	};
	failures: {
		count: number;
		lastClass: FailureClass | null;
	};
	capabilities: {
		activeToolCount: number;
		allToolCount: number;
		preservedExplicitTools: boolean;
	};
	control: { boundarySequence: number; lastDecision: null };
	context: { compactionGeneration: number };
	outcome: {
		status: RunOutcome;
		lastAssistantTextOnly: boolean;
	};
	counters: {
		receipts: number;
		missingStart: number;
		missingResult: number;
	};
	legacy: LegacyRunSnapshotV1;
}

interface RunEventBase {
	v: 1;
	sequence: number;
	atMs: number;
}

export type RunEventV1 =
	| (RunEventBase & {
		type: "run/session-started";
		sessionIdHash: string;
		runIdHash: string;
		generation: number;
		surfaceHash: string;
		piVersion: string;
		provider: string;
		model: string;
		activeToolCount: number;
		allToolCount: number;
		preservedExplicitTools: boolean;
		detectedGateHash: string | null;
		legacy: LegacyRunSnapshotV1;
	})
	| (RunEventBase & { type: "run/cycle-started"; cycleIdHash: string; runIdHash: string | null })
	| (RunEventBase & { type: "run/objective-observed"; objectiveHash: string; runIdHash: string | null })
	| (RunEventBase & { type: "run/cycle-ended"; textOnly: boolean })
	| (RunEventBase & { type: "run/cycle-settled" })
	| (RunEventBase & { type: "run/tool-started"; receipt: Pick<ExecutionReceiptV1,
		"toolCallIdHash" | "toolName" | "toolFamily" | "targetHash" | "planItemHash" |
		"startedSequence" | "startedAtMs" | "mutation" | "verification" | "surfaceHash"> })
	| (RunEventBase & { type: "run/tool-finished"; receipt: ExecutionReceiptV1 })
	| (RunEventBase & { type: "run/session-compacted" })
	| (RunEventBase & { type: "run/legacy-observed"; legacy: LegacyRunSnapshotV1 })
	| (RunEventBase & { type: "run/session-shutdown" })
	| (RunEventBase & { type: "run/phase-changed"; transition: RunTransitionV1 });
