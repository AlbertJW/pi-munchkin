import { createHash } from "node:crypto";
import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { FailureClass } from "./failure-episodes.ts";

export const HARNESS_SIGNAL_CHANNEL = "pi-munchkin/domain-signal/v1";

type SignalBase = { v: 1 };
export type CapabilityName = "plan_go" | "span_tools" | "subagent" | "compact_context" | "web_read";
export type HarnessSignalV1 =
	| (SignalBase & { type: "plan/write"; runIdHash: string; items: number; openItems: number })
	| (SignalBase & { type: "plan/go"; runIdHash: string })
	| (SignalBase & { type: "plan/gate"; runIdHash: string; pass: boolean; fails: number })
	| (SignalBase & { type: "loop/tier"; tier: 1 | 2 | 3; detector: "exact" | "outcome" | "semantic" | "session" })
	| (SignalBase & { type: "failure/episodes"; activeWalls: number; exposedEpisodes: number; lastClass: FailureClass | null })
	| (SignalBase & { type: "recovery/resume-requested"; origin: "run-command" })
	| (SignalBase & { type: "recovery/resumed"; origin: "run-command" | "loop-command"; cleared: number; blocked: number })
	| (SignalBase & { type: "context/receipt"; contextPct: number | null; staleShare: number | null; duplicateShare: number | null })
	| (SignalBase & { type: "context/compacted" })
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
		case "plan/gate":
			return exact("v", "type", "runIdHash", "pass", "fails") && HASH.test(String(item.runIdHash)) && typeof item.pass === "boolean" && integer(item.fails);
		case "loop/tier":
			return exact("v", "type", "tier", "detector") && [1, 2, 3].includes(Number(item.tier)) && ["exact", "outcome", "semantic", "session"].includes(String(item.detector));
		case "failure/episodes":
			return exact("v", "type", "activeWalls", "exposedEpisodes", "lastClass") && integer(item.activeWalls) &&
				integer(item.exposedEpisodes) && (item.lastClass === null || [
					"schema_validation", "policy_rejection", "permission", "not_found", "command_missing",
					"timeout", "provider", "verification_assertion", "compile_or_lint", "edit_conflict", "unknown",
				].includes(String(item.lastClass)));
		case "recovery/resume-requested":
			return exact("v", "type", "origin") && item.origin === "run-command";
		case "recovery/resumed":
			return exact("v", "type", "origin", "cleared", "blocked") &&
				["run-command", "loop-command"].includes(String(item.origin)) && integer(item.cleared) && integer(item.blocked);
		case "context/receipt":
			return exact("v", "type", "contextPct", "staleShare", "duplicateShare") && nullableNumber(item.contextPct) && nullableNumber(item.staleShare) && nullableNumber(item.duplicateShare);
		case "context/compacted":
			return exact("v", "type");
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
