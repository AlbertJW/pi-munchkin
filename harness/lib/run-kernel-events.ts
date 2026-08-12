import type { EventBus } from "@earendil-works/pi-coding-agent";
import type { ExecutionReceiptV1, LegacyRunSnapshotV1, RunEventV1, RunTransitionV1 } from "./run-kernel-types.ts";
import { isControlDecision, isControlProposal } from "./control-proposal.ts";

export const RUN_EVENT_CHANNEL = "pi-munchkin/run-event/v1";

const RUN_EVENT_TYPES = new Set<RunEventV1["type"]>([
	"run/session-started",
	"run/cycle-started",
	"run/objective-observed",
	"run/tool-started",
	"run/tool-finished",
	"run/legacy-observed",
	"run/control-proposed",
	"run/control-decided",
	"run/plan-observed",
	// Was MISSING here while present in the union, the reducer, the dispatcher and
	// the payload switch below — so isRunEventV1 rejected every plan gate before
	// the reducer saw one, and TWO shipped fixes that depended on this path (gate
	// identity, order-independent verification) were inert in production while
	// their reducer-level tests passed. See the union-coverage test in
	// run-kernel-events.test.ts, which now makes this class of drift impossible.
	"run/plan-gate-observed",
	"run/context-observed",
	"run/failure-state-observed",
	"run/recovery-resumed",
	"run/cycle-ended",
	"run/cycle-settled",
	"run/session-compacted",
	"run/session-shutdown",
	"run/phase-changed",
]);

const HASH_RE = /^[a-f0-9]{64}$/;
const SAFE_LABEL_RE = /^[a-zA-Z0-9_.:-]+$/;
const MUTATIONS = new Set(["none", "source", "plan", "state"]);
const VERIFICATIONS = new Set(["project_gate", "generic", "none"]);
const RECEIPT_STATUSES = new Set(["succeeded", "failed", "rejected", "missing_result"]);
const FAILURE_CLASSES = new Set([
	"schema_validation", "policy_rejection", "permission", "not_found", "command_missing",
	"timeout", "provider", "verification_assertion", "compile_or_lint", "edit_conflict", "unknown",
]);
const PHASES = new Set([
	"intake", "local_recon", "external_research", "preflight", "planning", "execution",
	"verification", "recovery", "blocked", "complete",
]);
const COMMON_KEYS = ["v", "type", "sequence", "atMs"] as const;

function record(value: unknown): Record<string, unknown> | null {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : null;
}

function exactKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
	const keys = Object.keys(value);
	return keys.length === allowed.length && keys.every((key) => allowed.includes(key));
}

function integer(value: unknown): boolean {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function finiteNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function hash(value: unknown): boolean {
	return typeof value === "string" && HASH_RE.test(value);
}

function nullableHash(value: unknown): boolean {
	return value === null || hash(value);
}

function safeLabel(value: unknown, max = 96): boolean {
	return typeof value === "string" && value.length > 0 && value.length <= max && SAFE_LABEL_RE.test(value);
}

function isLegacy(value: unknown): value is LegacyRunSnapshotV1 {
	const item = record(value);
	if (!item || !exactKeys(item, [
		"planActive", "planItemActive", "planItemHash", "planOpenItems", "planBlockedItems",
		"verifyKnown", "verifyMutated", "verifyOk",
	])) return false;
	return typeof item.planActive === "boolean" && typeof item.planItemActive === "boolean" &&
		nullableHash(item.planItemHash) && (item.planOpenItems === null || integer(item.planOpenItems)) &&
		(item.planBlockedItems === null || integer(item.planBlockedItems)) && typeof item.verifyKnown === "boolean" &&
		typeof item.verifyMutated === "boolean" && typeof item.verifyOk === "boolean";
}

const START_KEYS = [
	"toolCallIdHash", "toolName", "toolFamily", "targetHash", "planItemHash", "startedSequence",
	"startedAtMs", "mutation", "verification", "surfaceHash",
] as const;

function isReceiptStart(value: unknown): boolean {
	const item = record(value);
	if (!item || !exactKeys(item, START_KEYS)) return false;
	return hash(item.toolCallIdHash) && safeLabel(item.toolName, 64) && safeLabel(item.toolFamily, 64) &&
		hash(item.targetHash) && hash(item.planItemHash) && integer(item.startedSequence) &&
		finiteNumber(item.startedAtMs) && MUTATIONS.has(String(item.mutation)) &&
		VERIFICATIONS.has(String(item.verification)) && hash(item.surfaceHash);
}

function isReceipt(value: unknown): value is ExecutionReceiptV1 {
	const item = record(value);
	if (!item || !exactKeys(item, [
		"v", ...START_KEYS, "endedSequence", "endedAtMs", "status", "isError", "failureClass",
		"resultBytes", "hadStart", "hadToolResult",
	])) return false;
	return item.v === 1 && isReceiptStart(Object.fromEntries(START_KEYS.map((key) => [key, item[key]]))) &&
		integer(item.endedSequence) && finiteNumber(item.endedAtMs) &&
		(item.endedSequence as number) >= (item.startedSequence as number) &&
		(item.endedAtMs as number) >= (item.startedAtMs as number) &&
		RECEIPT_STATUSES.has(String(item.status)) && typeof item.isError === "boolean" &&
		(item.failureClass === null || FAILURE_CLASSES.has(String(item.failureClass))) && integer(item.resultBytes) &&
		typeof item.hadStart === "boolean" && typeof item.hadToolResult === "boolean";
}

function isTransition(value: unknown): value is RunTransitionV1 {
	const item = record(value);
	if (!item || !exactKeys(item, ["sequence", "atMs", "from", "to", "reason"])) return false;
	return integer(item.sequence) && finiteNumber(item.atMs) && PHASES.has(String(item.from)) &&
		PHASES.has(String(item.to)) && safeLabel(item.reason, 64);
}

export function isRunEventV1(value: unknown): value is RunEventV1 {
	const event = record(value);
	if (!event || event.v !== 1 || typeof event.type !== "string" ||
		!RUN_EVENT_TYPES.has(event.type as RunEventV1["type"]) || !integer(event.sequence) || !finiteNumber(event.atMs)) return false;
	const base = [...COMMON_KEYS];
	switch (event.type) {
		case "run/session-started":
			return exactKeys(event, [...base, "sessionIdHash", "runIdHash", "generation", "surfaceHash", "piVersion",
				"provider", "model", "activeToolCount", "allToolCount", "preservedExplicitTools", "detectedGateHash", "sandboxPosture", "legacy"]) &&
				hash(event.sessionIdHash) && hash(event.runIdHash) && integer(event.generation) && hash(event.surfaceHash) &&
				safeLabel(event.piVersion) && safeLabel(event.provider) && safeLabel(event.model) && integer(event.activeToolCount) &&
				integer(event.allToolCount) && typeof event.preservedExplicitTools === "boolean" &&
				nullableHash(event.detectedGateHash) && ["declared", "host", "unknown"].includes(String(event.sandboxPosture)) && isLegacy(event.legacy);
		case "run/cycle-started":
			return exactKeys(event, [...base, "cycleIdHash", "runIdHash"]) && hash(event.cycleIdHash) && nullableHash(event.runIdHash);
		case "run/objective-observed":
			return exactKeys(event, [...base, "objectiveHash", "runIdHash"]) && hash(event.objectiveHash) && nullableHash(event.runIdHash);
		case "run/cycle-ended":
			return exactKeys(event, [...base, "textOnly"]) && typeof event.textOnly === "boolean";
		case "run/cycle-settled":
		case "run/session-compacted":
		case "run/session-shutdown":
			return exactKeys(event, base);
		case "run/tool-started":
			return exactKeys(event, [...base, "receipt"]) && isReceiptStart(event.receipt);
		case "run/tool-finished":
			return exactKeys(event, [...base, "receipt"]) && isReceipt(event.receipt);
		case "run/legacy-observed":
			return exactKeys(event, [...base, "legacy"]) && isLegacy(event.legacy);
		case "run/control-proposed":
			return exactKeys(event, [...base, "proposal"]) && isControlProposal(event.proposal);
		case "run/control-decided":
			return exactKeys(event, [...base, "decision"]) && isControlDecision(event.decision);
		case "run/plan-observed":
			return exactKeys(event, [...base, "runIdHash", "accepted", "executionStarted", "openItems"]) &&
				hash(event.runIdHash) && typeof event.accepted === "boolean" && typeof event.executionStarted === "boolean" &&
				(event.openItems === null || integer(event.openItems));
		case "run/plan-gate-observed":
			return exactKeys(event, [...base, "runIdHash", "pass", "fails", "gateHash"]) &&
				hash(event.runIdHash) && typeof event.pass === "boolean" && integer(event.fails) &&
				(event.gateHash === null || hash(event.gateHash));
		case "run/context-observed":
			return exactKeys(event, [...base, "usagePct"]) && (event.usagePct === null || finiteNumber(event.usagePct));
		case "run/failure-state-observed":
			return exactKeys(event, [...base, "activeWalls", "exposedEpisodes", "lastClass"]) &&
				integer(event.activeWalls) && integer(event.exposedEpisodes) &&
				(event.lastClass === null || FAILURE_CLASSES.has(String(event.lastClass)));
		case "run/recovery-resumed":
			return exactKeys(event, [...base, "cleared", "blocked"]) && integer(event.cleared) && integer(event.blocked);
		case "run/phase-changed":
			return exactKeys(event, [...base, "transition"]) && isTransition(event.transition);
		default:
			return false;
	}
}

export function emitRunEvent(bus: EventBus, event: RunEventV1): void {
	bus.emit(RUN_EVENT_CHANNEL, event);
}

export function onRunEvent(
	bus: EventBus,
	handler: (event: RunEventV1) => void | Promise<void>,
): () => void {
	return bus.on(RUN_EVENT_CHANNEL, (value) => {
		if (!isRunEventV1(value)) return;
		return handler(value);
	});
}
