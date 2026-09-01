import { createHash } from "node:crypto";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import { validateBranchReport, validatePlanContext, type BranchReportV1, type PlanContextV1 } from "./branch-report.ts";
import type { FailureClass } from "./failure-episodes.ts";

export const HARNESS_SIGNAL_CHANNEL = "pi-munchkin/domain-signal/v1";

type SignalBase = { v: 1 };
export type CapabilityName = "plan_go" | "span_tools" | "subagent" | "compact_context" | "web_read";
export type HarnessSignalV1 =
	| (SignalBase & { type: "plan/write"; runIdHash: string; items: number; openItems: number })
	| (SignalBase & { type: "plan/go"; runIdHash: string })
	| (SignalBase & { type: "tool/prevented"; toolCallId: string; failureClass: "policy_rejection" })
	| (SignalBase & { type: "loop/tier"; tier: 1 | 2 | 3; detector: "exact" | "outcome" | "semantic" | "session" })
	| (SignalBase & { type: "failure/episodes"; activeWalls: number; exposedEpisodes: number; lastClass: FailureClass | null })
	| (SignalBase & { type: "recovery/resume-requested"; origin: "run-command" })
	// An EXPLICIT run boundary. The kernel rotates run identity only on a
	// `complete` outcome, so a new unrelated objective after an abandoned,
	// paused or unverified run inherits the old run's identity and its
	// settlement rows report the previous objective's counters. Auto-rotating
	// per prompt is NOT the fix: `before_agent_start` fires once per user
	// prompt, so it would sever the cross-turn mutation→verification link
	// inside settle() and manufacture false `complete` outcomes.
	| (SignalBase & { type: "run/abandoned"; origin: "run-command" })
	| (SignalBase & { type: "recovery/resumed"; origin: "run-command" | "loop-command"; cleared: number; blocked: number })
	| (SignalBase & { type: "context/receipt"; contextPct: number | null; staleShare: number | null; duplicateShare: number | null })
	| (SignalBase & { type: "context/compacted" })
	| (SignalBase & { type: "capsule/identity" })
	// Emitted once per session, AFTER the capsule-identity rebind has actually read
	// the plan from disk. Under the shipped defaults (PLAN_STORAGE=capsule) plan state
	// is unreadable during session_start, because the capsule identity it needs is
	// published by run-capsule at manifest index 26 — twenty slots after plan-runner
	// and four after tool-activation. Every consumer that wants to know "is there a
	// live plan?" therefore has to learn it here, not at session_start.
	| (SignalBase & { type: "plan/rebound"; openItems: number; interrupted: boolean })
	| (SignalBase & { type: "goal/active" })
	| (SignalBase & { type: "plan/branch-result"; context: PlanContextV1; report: BranchReportV1 | null; failureClass: "missing_report" | "invalid_report" | "child_failed" | null })
	| (SignalBase & { type: "capability/need"; capability: CapabilityName; reason: "accepted-plan" | "large-file" | "inlet-refusal" | "selected-search-result" | "deep-research" | "recovery" });

const HASH = /^[a-f0-9]{64}$/;

export function signalRunId(runId: string): string {
	return createHash("sha256").update(`plan-run:${runId}`).digest("hex");
}

export function isHarnessSignal(value: unknown): value is HarnessSignalV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	if (item.v !== 1 || typeof item.type !== "string") return false;
	const integer = (candidate: unknown) => Number.isSafeInteger(candidate) && Number(candidate) >= 0;
	const nullableNumber = (candidate: unknown) => candidate === null ||
		(typeof candidate === "number" && Number.isFinite(candidate) && candidate >= 0);
	const exact = (...keys: string[]) => Object.keys(item).length === keys.length && Object.keys(item).every((key) => keys.includes(key));
	switch (item.type) {
		case "plan/write":
			return exact("v", "type", "runIdHash", "items", "openItems") && HASH.test(String(item.runIdHash)) && integer(item.items) && integer(item.openItems);
		case "plan/go":
			return exact("v", "type", "runIdHash") && HASH.test(String(item.runIdHash));
		case "tool/prevented":
			return exact("v", "type", "toolCallId", "failureClass") &&
				typeof item.toolCallId === "string" && item.toolCallId.length > 0 && item.toolCallId.length <= 128 &&
				item.failureClass === "policy_rejection";
		case "loop/tier":
			return exact("v", "type", "tier", "detector") && [1, 2, 3].includes(Number(item.tier)) && ["exact", "outcome", "semantic", "session"].includes(String(item.detector));
		case "failure/episodes":
			return exact("v", "type", "activeWalls", "exposedEpisodes", "lastClass") && integer(item.activeWalls) &&
				integer(item.exposedEpisodes) && (item.lastClass === null || [
					"schema_validation", "policy_rejection", "permission", "not_found", "command_missing",
					"timeout", "provider", "verification_assertion", "compile_or_lint", "edit_conflict", "unknown",
				].includes(String(item.lastClass)));
		case "recovery/resume-requested":
		case "run/abandoned":
			return exact("v", "type", "origin") && item.origin === "run-command";
		case "recovery/resumed":
			return exact("v", "type", "origin", "cleared", "blocked") &&
				["run-command", "loop-command"].includes(String(item.origin)) && integer(item.cleared) && integer(item.blocked);
		case "context/receipt":
			return exact("v", "type", "contextPct", "staleShare", "duplicateShare") && nullableNumber(item.contextPct) && nullableNumber(item.staleShare) && nullableNumber(item.duplicateShare);
		case "context/compacted":
			return exact("v", "type");
		case "plan/rebound":
			return exact("v", "type", "openItems", "interrupted") && integer(item.openItems) && typeof item.interrupted === "boolean";
		case "goal/active":
			return exact("v", "type");
		case "capsule/identity":
			// Payload-free: the identity itself stays in the run-capsule global.
			// Consumers (plan-runner's adaptive rebind) re-read it on delivery.
			return exact("v", "type");
		case "plan/branch-result":
			return exact("v", "type", "context", "report", "failureClass") && validatePlanContext(item.context) &&
			(item.report === null ? ["missing_report", "invalid_report", "child_failed"].includes(String(item.failureClass)) :
				item.failureClass === null && validateBranchReport(item.report, item.context, true));
		case "capability/need":
			return exact("v", "type", "capability", "reason") &&
				["plan_go", "span_tools", "subagent", "compact_context", "web_read"].includes(String(item.capability)) &&
				["accepted-plan", "large-file", "inlet-refusal", "selected-search-result", "deep-research", "recovery"].includes(String(item.reason));
		default:
			return false;
	}
}

export function emitHarnessSignal(bus: EventBus, signal: HarnessSignalV1): void {
	if (isHarnessSignal(signal)) bus.emit(HARNESS_SIGNAL_CHANNEL, signal);
}

export function onHarnessSignal(bus: EventBus, handler: (signal: HarnessSignalV1) => void): () => void {
	return bus.on(HARNESS_SIGNAL_CHANNEL, (value) => {
		if (isHarnessSignal(value)) handler(value);
	});
}
