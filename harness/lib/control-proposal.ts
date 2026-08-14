import { createHash, randomUUID } from "node:crypto";
import type { EventBus } from "@earendil-works/pi-coding-agent";

export const CONTROL_PROPOSAL_CHANNEL = "pi-munchkin/control-proposal/v1";
export const CONTROL_DECISION_CHANNEL = "pi-munchkin/control-decision/v1";

export type ControlArbiterMode = "shadow" | "enforce" | "off";
export type ControlKind =
	| "safe_abort"
	| "verification_required"
	| "failure_recovery"
	| "plan_resolution"
	| "tool_rescue"
	| "context_hint";
export type ControlReason =
	| "policy_rejection"
	| "compile_or_lint"
	| "loop_hard_stop"
	| "semantic_tier"
	| "outcome_repeat"
	| "session_repeat"
	| "exact_gate_missing"
	| "loop_strategy_change"
	| "plan_blocked"
	| "pseudo_tool_call"
	| "research_unverified"
	| "state_lens";
export type ControlSource =
	| "loop-breaker"
	| "verify-gate"
	| "tool-call-rescue"
	| "session-blackboard"
	| "plan-runner"
	| "ketch";
export type ControlEffect = "message" | "abort" | "shutdown";
export type MessageFactoryId =
	| "loop-semantic"
	| "loop-outcome"
	| "loop-session"
	| "loop-tier"
	| "verify-wrap"
	| "tool-rescue"
	| "state-lens"
	| "plan-hold"
	| "research-wrap";

export interface ControlProposalV1 {
	v: 1;
	proposalIdHash: string;
	boundarySequence: number;
	kind: ControlKind;
	priority: number;
	reason: ControlReason;
	source: ControlSource;
	cooldownKeyHash: string;
	messageFactory: MessageFactoryId;
	effect: ControlEffect;
	legacyActed: boolean;
}

export interface ControlDelivery {
	message?: string;
	abort?: () => void;
	shutdown?: () => void;
}

export interface ControlProposalEnvelope {
	proposal: ControlProposalV1;
	delivery: ControlDelivery;
}

export interface ControlDecisionV1 {
	v: 1;
	boundarySequence: number;
	mode: ControlArbiterMode;
	proposalCount: number;
	collisionCount: number;
	legacyActionCount: number;
	winner: ControlProposalV1 | null;
}

const PRIORITY: Record<ControlKind, number> = {
	safe_abort: 700,
	failure_recovery: 600,
	verification_required: 500,
	plan_resolution: 300,
	tool_rescue: 200,
	context_hint: 100,
};
const KINDS = new Set(Object.keys(PRIORITY));
const REASONS = new Set<ControlReason>([
	"policy_rejection", "compile_or_lint", "loop_hard_stop", "semantic_tier", "outcome_repeat", "session_repeat",
	"exact_gate_missing", "loop_strategy_change", "plan_blocked", "pseudo_tool_call", "research_unverified", "state_lens",
]);
const SOURCES = new Set<ControlSource>([
	"loop-breaker", "verify-gate", "tool-call-rescue", "session-blackboard", "plan-runner", "ketch",
]);
const FACTORIES = new Set<MessageFactoryId>([
	"loop-semantic", "loop-outcome", "loop-session", "loop-tier", "verify-wrap", "tool-rescue",
	"state-lens", "plan-hold", "research-wrap",
]);
const EFFECTS = new Set<ControlEffect>(["message", "abort", "shutdown"]);
const HASH = /^[a-f0-9]{64}$/;
const ACTIVE_ARBITERS_KEY = "__pi_control_arbiter_buses_v1";
export const CONTROL_ARBITER_DEFAULT: ControlArbiterMode = "enforce";

function activeArbiters(): WeakSet<object> {
	const global = globalThis as Record<string, unknown>;
	if (!(global[ACTIVE_ARBITERS_KEY] instanceof WeakSet)) global[ACTIVE_ARBITERS_KEY] = new WeakSet<object>();
	return global[ACTIVE_ARBITERS_KEY] as WeakSet<object>;
}

export function controlArbiterMode(
	env: NodeJS.ProcessEnv = process.env,
	defaultMode: ControlArbiterMode = CONTROL_ARBITER_DEFAULT,
): ControlArbiterMode {
	if (env.CONTROL_ARBITER === "enforce" || env.CONTROL_ARBITER === "shadow" || env.CONTROL_ARBITER === "off") return env.CONTROL_ARBITER;
	return defaultMode;
}

export function setControlArbiterActive(bus: EventBus, active: boolean): void {
	if (active) activeArbiters().add(bus as object); else activeArbiters().delete(bus as object);
}

export function controlEnforces(bus: EventBus, env: NodeJS.ProcessEnv = process.env): boolean {
	return controlArbiterMode(env) === "enforce" && activeArbiters().has(bus as object);
}

function hash(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function buildControlProposal(input: {
	boundarySequence: number;
	kind: ControlKind;
	reason: ControlReason;
	source: ControlSource;
	cooldownKey: string;
	messageFactory: MessageFactoryId;
	effect?: ControlEffect;
	legacyActed?: boolean;
}): ControlProposalV1 {
	return {
		v: 1,
		proposalIdHash: hash(`proposal:${randomUUID()}`),
		boundarySequence: Math.max(0, Math.trunc(input.boundarySequence)),
		kind: input.kind,
		priority: PRIORITY[input.kind],
		reason: input.reason,
		source: input.source,
		cooldownKeyHash: hash(`cooldown:${input.cooldownKey}`),
		messageFactory: input.messageFactory,
		effect: input.effect ?? "message",
		legacyActed: input.legacyActed === true,
	};
}

export function isControlProposal(value: unknown): value is ControlProposalV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	const keys = Object.keys(item);
	const expected = [
		"v", "proposalIdHash", "boundarySequence", "kind", "priority", "reason", "source",
		"cooldownKeyHash", "messageFactory", "effect", "legacyActed",
	];
	if (keys.length !== expected.length || !keys.every((key) => expected.includes(key))) return false;
	const kind = String(item.kind) as ControlKind;
	return item.v === 1 && HASH.test(String(item.proposalIdHash)) && HASH.test(String(item.cooldownKeyHash)) &&
		Number.isSafeInteger(item.boundarySequence) && Number(item.boundarySequence) >= 0 && KINDS.has(kind) &&
		item.priority === PRIORITY[kind] && REASONS.has(item.reason as ControlReason) &&
		SOURCES.has(item.source as ControlSource) && FACTORIES.has(item.messageFactory as MessageFactoryId) &&
		EFFECTS.has(item.effect as ControlEffect) && typeof item.legacyActed === "boolean";
}

export function emitControlProposal(bus: EventBus, proposal: ControlProposalV1, delivery: ControlDelivery): void {
	if (!isControlProposal(proposal)) return;
	bus.emit(CONTROL_PROPOSAL_CHANNEL, { proposal, delivery } satisfies ControlProposalEnvelope);
}

export function onControlProposal(bus: EventBus, handler: (event: ControlProposalEnvelope) => void): () => void {
	return bus.on(CONTROL_PROPOSAL_CHANNEL, (value) => {
		if (!value || typeof value !== "object") return;
		const envelope = value as Partial<ControlProposalEnvelope>;
		if (!isControlProposal(envelope.proposal) || !envelope.delivery || typeof envelope.delivery !== "object") return;
		handler(envelope as ControlProposalEnvelope);
	});
}

export function emitControlDecision(bus: EventBus, decision: ControlDecisionV1): void {
	if (isControlDecision(decision)) bus.emit(CONTROL_DECISION_CHANNEL, decision);
}

export function isControlDecision(value: unknown): value is ControlDecisionV1 {
	if (!value || typeof value !== "object") return false;
	const item = value as Partial<ControlDecisionV1>;
	const keys = Object.keys(item);
	const expected = ["v", "boundarySequence", "mode", "proposalCount", "collisionCount", "legacyActionCount", "winner"];
	return keys.length === expected.length && keys.every((key) => expected.includes(key)) &&
		item.v === 1 && Number.isSafeInteger(item.boundarySequence) && Number(item.boundarySequence) >= 0 &&
		(["shadow", "enforce", "off"] as unknown[]).includes(item.mode) &&
		Number.isSafeInteger(item.proposalCount) && Number(item.proposalCount) >= 0 &&
		Number.isSafeInteger(item.collisionCount) && Number(item.collisionCount) >= 0 &&
		Number.isSafeInteger(item.legacyActionCount) && Number(item.legacyActionCount) >= 0 &&
		Number(item.collisionCount) === Math.max(0, Number(item.proposalCount) - 1) &&
		Number(item.legacyActionCount) <= Number(item.proposalCount) &&
		(Number(item.proposalCount) === 0 ? item.winner === null : isControlProposal(item.winner));
}

export function onControlDecision(bus: EventBus, handler: (decision: ControlDecisionV1) => void): () => void {
	return bus.on(CONTROL_DECISION_CHANNEL, (value) => {
		if (isControlDecision(value)) handler(value);
	});
}
