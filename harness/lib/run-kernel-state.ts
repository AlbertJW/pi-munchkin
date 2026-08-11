import type {
	ExecutionReceiptV1, RunEventV1, RunPhase, RunStateV1, RunTransitionV1,
} from "./run-kernel-types.ts";

const MAX_TRANSITIONS = 32;
const SHA256_RE = /^[a-f0-9]{64}$/;

function initialState(): RunStateV1 {
	return {
		v: 1,
		mode: "shadow",
		identity: {
			sessionIdHash: "0".repeat(64), runIdHash: "0".repeat(64), cycleIdHash: null,
			generation: 0, surfaceHash: "0".repeat(64),
		},
		lifecycle: { state: "starting", lastTransitionSequence: 0 },
		workflow: { phase: "intake", previousPhase: null, reason: "initial", history: [] },
		objective: { hash: null, label: null },
		environment: {
			piVersion: "unknown", provider: "unknown", model: "unknown",
			activeToolCount: 0, allToolCount: 0, preservedExplicitTools: false,
			detectedGateHash: null, sandboxPosture: "unknown",
		},
		plan: {
			accepted: false, executionStarted: false, currentItemHash: null,
			openItems: null, blockedItems: null,
		},
		mutation: { count: 0, lastStartedSequence: null, lastCompletedSequence: null, lastTargetHash: null },
		verification: {
			attempts: 0, validGates: 0, lastKind: "none", lastStartedSequence: null,
			lastEndedSequence: null, lastPassed: false, validAfterMutation: false,
		},
		evidence: { facts: [] },
		failures: { count: 0, lastClass: null, activeWalls: 0, exposedEpisodes: 0 },
		capabilities: { activeToolCount: 0, allToolCount: 0, preservedExplicitTools: false },
		control: { boundarySequence: 0, proposals: 0, collisions: 0, lastDecision: null },
		context: { usagePct: null, compactionGeneration: 0 },
		outcome: { status: "active", lastAssistantTextOnly: false },
		counters: { receipts: 0, missingStart: 0, missingResult: 0 },
		legacy: {
			planActive: false, planItemActive: false, planItemHash: null,
			planOpenItems: null, planBlockedItems: null, verifyKnown: false,
			verifyMutated: false, verifyOk: false,
		},
	};
}

function succeeded(receipt: ExecutionReceiptV1): boolean {
	return receipt.status === "succeeded";
}

function phaseForTool(toolName: string): RunPhase | null {
	if (["web_search", "web_read", "research_note", "research_recall"].includes(toolName)) return "external_research";
	if (["read", "grep", "find", "ls", "search_spans", "read_span"].includes(toolName)) return "local_recon";
	return null;
}

export type ApplyRunEventResult = { applied: boolean; transition: RunTransitionV1 | null };

export class RunStateStoreV1 {
	private state = initialState();
	private lastAppliedSequence = -1;
	private restored = false;

	reset(): void {
		this.state = initialState();
		this.lastAppliedSequence = -1;
		this.restored = false;
	}

	restore(candidate: unknown): boolean {
		if (validateRunStateSnapshot(candidate).length > 0) return false;
		this.state = structuredClone(candidate as RunStateV1);
		this.lastAppliedSequence = maxRunStateSequence(this.state);
		this.restored = true;
		return true;
	}

	snapshot(): RunStateV1 {
		return structuredClone(this.state);
	}

	apply(event: RunEventV1): ApplyRunEventResult {
		if (event.sequence <= this.lastAppliedSequence && event.type !== "run/session-started") {
			return { applied: false, transition: null };
		}
		if (event.type === "run/session-started") {
			const recovered = this.restored;
			if (!recovered) this.state = initialState();
			this.state.identity = {
				sessionIdHash: event.sessionIdHash,
				runIdHash: event.runIdHash,
				cycleIdHash: null,
				generation: event.generation,
				surfaceHash: event.surfaceHash,
			};
			this.state.environment = {
				piVersion: event.piVersion,
				provider: event.provider,
				model: event.model,
				activeToolCount: event.activeToolCount,
				allToolCount: event.allToolCount,
				preservedExplicitTools: event.preservedExplicitTools,
				detectedGateHash: event.detectedGateHash,
				sandboxPosture: event.sandboxPosture,
			};
			this.state.capabilities = {
				activeToolCount: event.activeToolCount,
				allToolCount: event.allToolCount,
				preservedExplicitTools: event.preservedExplicitTools,
			};
			this.state.legacy = { ...event.legacy };
			if (!recovered) {
				this.state.plan.accepted = event.legacy.planActive;
				this.state.plan.currentItemHash = event.legacy.planItemHash;
				this.state.plan.openItems = event.legacy.planOpenItems;
				this.state.plan.blockedItems = event.legacy.planBlockedItems;
			}
			this.restored = false;
		}
		this.lastAppliedSequence = event.sequence;
		this.state.control.boundarySequence = event.sequence;
		let transition: RunTransitionV1 | null = null;

		switch (event.type) {
			case "run/session-started":
				this.state.lifecycle = { state: "starting", lastTransitionSequence: event.sequence };
				if ((this.state.plan.blockedItems ?? 0) > 0) {
					transition = this.transition("blocked", "resumed-plan-blocked", event.sequence, event.atMs);
				} else if (this.state.plan.accepted && this.state.plan.openItems !== 0) {
					transition = this.transition("planning", "resumed-plan", event.sequence, event.atMs);
				}
				break;
			case "run/cycle-started":
				if (event.runIdHash) this.resetRun(event.runIdHash);
				this.state.identity.cycleIdHash = event.cycleIdHash;
				this.state.lifecycle = { state: "active", lastTransitionSequence: event.sequence };
				this.state.outcome.status = "active";
				this.state.outcome.lastAssistantTextOnly = false;
				break;
			case "run/objective-observed":
				if (event.runIdHash) this.resetRun(event.runIdHash);
				this.state.objective.hash = event.objectiveHash;
				this.state.objective.label = null;
				break;
			case "run/cycle-ended":
				this.state.lifecycle = { state: "settling", lastTransitionSequence: event.sequence };
				this.state.outcome.lastAssistantTextOnly = event.textOnly;
				break;
			case "run/cycle-settled":
				this.state.lifecycle = { state: "idle", lastTransitionSequence: event.sequence };
				transition = this.settle(event.sequence, event.atMs);
				break;
			case "run/tool-started": {
				const receipt = event.receipt;
				if (receipt.mutation === "source") this.state.mutation.lastStartedSequence = receipt.startedSequence;
				if (receipt.verification !== "none") {
					transition = this.transition("verification", "verification-started", event.sequence, event.atMs);
				} else {
					const inferred = phaseForTool(receipt.toolName);
					if (inferred) transition = this.transition(inferred, `${inferred}-tool`, event.sequence, event.atMs);
				}
				break;
			}
			case "run/tool-finished":
				transition = this.applyReceipt(event.receipt, event.sequence, event.atMs);
				break;
			case "run/session-compacted":
				this.state.context.compactionGeneration += 1;
				transition = this.transition("recovery", "session-compacted", event.sequence, event.atMs);
				break;
			case "run/legacy-observed":
				this.state.legacy = { ...event.legacy };
				this.state.plan.currentItemHash = event.legacy.planItemHash;
				this.state.plan.openItems = event.legacy.planOpenItems;
				this.state.plan.blockedItems = event.legacy.planBlockedItems;
				if ((event.legacy.planBlockedItems ?? 0) > 0) {
					transition = this.transition("blocked", "plan-item-blocked", event.sequence, event.atMs);
				}
				break;
			case "run/control-proposed":
				this.state.control.proposals += 1;
				this.state.control.boundarySequence = Math.max(
					this.state.control.boundarySequence,
					event.proposal.boundarySequence,
				);
				break;
			case "run/control-decided":
				this.state.control.collisions += event.decision.collisionCount;
				this.state.control.boundarySequence = Math.max(
					this.state.control.boundarySequence,
					event.decision.boundarySequence,
				);
				this.state.control.lastDecision = event.decision.winner ? {
					kind: event.decision.winner.kind,
					reason: event.decision.winner.reason,
					source: event.decision.winner.source,
					priority: event.decision.winner.priority,
					mode: event.decision.mode,
				} : null;
				break;
			case "run/plan-observed":
				this.state.plan.accepted = event.accepted;
				this.state.plan.executionStarted = event.executionStarted || this.state.plan.executionStarted;
				this.state.plan.openItems = event.openItems;
				break;
			case "run/plan-gate-observed":
				// A plan gate is real verification the kernel cannot see as a receipt:
				// plan-runner runs it internally (runReadonlyGate), not through pi's
				// tool pipeline. Without this input every plan-gated run emitted a
				// verify_ok "legacy disagreement" that was a kernel blind spot rather
				// than a legacy defect — and those rows are about to be used as
				// evidence. A later source mutation resets validAfterMutation as usual,
				// so gate-then-edit still reads as unverified.
				this.state.verification.attempts += 1;
				this.state.verification.lastPassed = event.pass;
				this.state.verification.validAfterMutation = event.pass;
				if (event.pass) this.state.verification.validGates += 1;
				break;
			case "run/context-observed":
				// Clamp to the range the snapshot contract allows. Context usage is
				// reported over 100% when a run exceeds its budget, and one such
				// reading used to make validateRunStateSnapshot reject the whole
				// state — silently killing the snapshot channel for the rest of the
				// run, which is exactly when the evidence matters most.
				this.state.context.usagePct = event.usagePct === null
					? null
					: Math.max(0, Math.min(100, event.usagePct));
				break;
			case "run/failure-state-observed":
				this.state.failures.activeWalls = event.activeWalls;
				this.state.failures.exposedEpisodes = event.exposedEpisodes;
				if (event.lastClass) this.state.failures.lastClass = event.lastClass;
				break;
			case "run/recovery-resumed":
				this.state.failures.activeWalls = 0;
				this.state.failures.exposedEpisodes = 0;
				this.state.outcome.status = "active";
				transition = this.forceTransition("recovery", "manual-resume", event.sequence, event.atMs);
				break;
			case "run/session-shutdown":
				this.state.lifecycle = { state: "shutdown", lastTransitionSequence: event.sequence };
				break;
			case "run/phase-changed":
				break;
		}
		return { applied: true, transition };
	}

	private applyReceipt(receipt: ExecutionReceiptV1, sequence: number, atMs: number): RunTransitionV1 | null {
		this.state.counters.receipts += 1;
		if (!receipt.hadStart) this.state.counters.missingStart += 1;
		if (!receipt.hadToolResult) this.state.counters.missingResult += 1;
		if (receipt.failureClass) {
			this.state.failures.count += 1;
			this.state.failures.lastClass = receipt.failureClass;
		}

		let transition: RunTransitionV1 | null = null;
		if (receipt.mutation === "source" && succeeded(receipt)) {
			this.state.mutation.count += 1;
			this.state.mutation.lastCompletedSequence = receipt.endedSequence;
			this.state.mutation.lastTargetHash = receipt.targetHash;
			this.state.verification.validAfterMutation = false;
			this.state.verification.lastPassed = false;
			transition = this.transition("execution", "source-mutation-succeeded", sequence, atMs);
		}
		if (receipt.toolName === "plan_write" && succeeded(receipt)) {
			this.state.plan.accepted = true;
			transition = this.transition("planning", "plan-accepted", sequence, atMs) ?? transition;
		}
		if (receipt.toolName === "plan_go" && succeeded(receipt)) {
			this.state.plan.executionStarted = true;
			transition = this.transition("execution", "plan-execution-started", sequence, atMs) ?? transition;
		}
		if (receipt.verification !== "none") {
			this.state.verification.attempts += 1;
			this.state.verification.lastKind = receipt.verification;
			this.state.verification.lastStartedSequence = receipt.startedSequence;
			this.state.verification.lastEndedSequence = receipt.endedSequence;
			this.state.verification.lastPassed = succeeded(receipt);
			const mutationEnd = this.state.mutation.lastCompletedSequence;
			const valid = succeeded(receipt) && (mutationEnd == null || receipt.startedSequence > mutationEnd);
			this.state.verification.validAfterMutation = valid;
			if (valid) this.state.verification.validGates += 1;
			transition = this.transition("verification", valid ? "verification-valid" : "verification-not-valid", sequence, atMs) ?? transition;
		}
		if (receipt.failureClass) {
			transition = this.transition("recovery", "tool-failure", sequence, atMs) ?? transition;
		}
		return transition;
	}

	private settle(sequence: number, atMs: number): RunTransitionV1 | null {
		if (this.state.workflow.phase === "blocked") {
			this.state.outcome.status = "blocked";
			return null;
		}
		if (this.state.failures.activeWalls > 0) {
			this.state.outcome.status = "paused";
			return this.transition("recovery", "active-failure-wall", sequence, atMs);
		}
		const hasMutation = this.state.mutation.lastCompletedSequence != null;
		if (hasMutation && !this.state.verification.validAfterMutation) {
			this.state.outcome.status = "unverified";
			return null;
		}
		if (this.state.plan.accepted) {
			if (this.state.plan.openItems === 0) {
				this.state.outcome.status = "complete";
				return this.transition("complete", "settled-plan-complete", sequence, atMs);
			}
			this.state.outcome.status = "paused";
			return null;
		}
		if (this.state.outcome.lastAssistantTextOnly && (!hasMutation || this.state.verification.validAfterMutation)) {
			this.state.outcome.status = "complete";
			return this.transition("complete", "settled-complete", sequence, atMs);
		}
		this.state.outcome.status = "paused";
		return null;
	}

	private transition(to: RunPhase, reason: string, sequence: number, atMs: number): RunTransitionV1 | null {
		const from = this.state.workflow.phase;
		if (from === to) {
			this.state.workflow.reason = reason;
			return null;
		}
		const transition = { sequence, atMs, from, to, reason } satisfies RunTransitionV1;
		this.state.workflow.previousPhase = from;
		this.state.workflow.phase = to;
		this.state.workflow.reason = reason;
		this.state.workflow.history.push(transition);
		if (this.state.workflow.history.length > MAX_TRANSITIONS) this.state.workflow.history.shift();
		return transition;
	}

	private forceTransition(to: RunPhase, reason: string, sequence: number, atMs: number): RunTransitionV1 {
		const from = this.state.workflow.phase;
		const transition = { sequence, atMs, from, to, reason } satisfies RunTransitionV1;
		this.state.workflow.previousPhase = from;
		this.state.workflow.phase = to;
		this.state.workflow.reason = reason;
		this.state.workflow.history.push(transition);
		if (this.state.workflow.history.length > MAX_TRANSITIONS) this.state.workflow.history.shift();
		return transition;
	}

	private resetRun(runIdHash: string): void {
		const preserved = {
			identity: { ...this.state.identity, runIdHash, cycleIdHash: null },
			environment: structuredClone(this.state.environment),
			capabilities: structuredClone(this.state.capabilities),
			legacy: structuredClone(this.state.legacy),
			generation: this.state.identity.generation,
		};
		this.state = initialState();
		this.state.identity = preserved.identity;
		this.state.identity.generation = preserved.generation;
		this.state.environment = preserved.environment;
		this.state.capabilities = preserved.capabilities;
		this.state.legacy = preserved.legacy;
	}
}

const FORBIDDEN_FIELD = /^(?:args?|arguments?|command|output|content|error|errors|url|urls|path|paths|endpoint|credential|credentials|secret|secrets|apiKey)$/i;
const ABSOLUTE_PRIVATE_PATH = /^(?:\/(?:Users|home|private|var|tmp)\/|[A-Za-z]:[\\/])/;
const SENSITIVE_VALUE = /(?:\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b|\b(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+|https?:\/\/\S*[?#]\S*)/i;
const SAFE_LABEL = /^[a-zA-Z0-9_.:-]+$/;
const PHASES = new Set(["intake", "local_recon", "external_research", "preflight", "planning", "execution", "verification", "recovery", "blocked", "complete"]);
const LIFECYCLES = new Set(["starting", "active", "settling", "idle", "shutdown"]);
const OUTCOMES = new Set(["active", "complete", "blocked", "paused", "unverified"]);
const VERIFICATIONS = new Set(["project_gate", "generic", "none"]);
const FAILURE_CLASSES = new Set(["schema_validation", "policy_rejection", "permission", "not_found", "command_missing", "timeout", "provider", "verification_assertion", "compile_or_lint", "edit_conflict", "unknown"]);
const PROVENANCE = new Set(["user", "filesystem", "gate", "delegated_unverified", "web_parent_verified"]);
const CONTROL_KINDS = new Set(["safety_consequence", "safe_abort", "verification_required", "failure_recovery", "plan_resolution", "tool_rescue", "context_hint"]);
const CONTROL_REASONS = new Set(["policy_rejection", "compile_or_lint", "code_quality", "loop_hard_stop", "semantic_tier", "outcome_repeat", "session_repeat", "exact_gate_missing", "loop_strategy_change", "plan_blocked", "pseudo_tool_call", "research_unverified", "state_lens"]);
const CONTROL_SOURCES = new Set(["loop-breaker", "verify-gate", "tool-call-rescue", "session-blackboard", "plan-runner", "ketch", "context-dedup", "micro-gate"]);
const CONTROL_MODES = new Set(["shadow", "enforce", "off"]);

export function maxRunStateSequence(state: RunStateV1): number {
	const candidates = [
		state.lifecycle.lastTransitionSequence,
		state.control.boundarySequence,
		state.mutation.lastStartedSequence ?? 0,
		state.mutation.lastCompletedSequence ?? 0,
		state.verification.lastStartedSequence ?? 0,
		state.verification.lastEndedSequence ?? 0,
		...state.workflow.history.map((entry) => entry.sequence),
	];
	return Math.max(0, ...candidates);
}

/** Closed, non-echoing validator for the private persistence boundary. */
export function validateRunStateSnapshot(state: unknown): string[] {
	const errors: string[] = [];
	const object = (value: unknown): Record<string, unknown> | null =>
		value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
	const exact = (name: string, value: unknown, keys: string[]): Record<string, unknown> | null => {
		const item = object(value);
		if (!item) { errors.push(`${name}: object required`); return null; }
		const actual = Object.keys(item);
		if (actual.length !== keys.length || !actual.every((key) => keys.includes(key))) errors.push(`${name}: invalid shape`);
		return item;
	};
	const integer = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0;
	const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0;
	const hash = (value: unknown) => typeof value === "string" && SHA256_RE.test(value);
	const nullableHash = (value: unknown) => value === null || hash(value);
	const nullableInt = (value: unknown) => value === null || integer(value);
	const bool = (value: unknown) => typeof value === "boolean";
	const assert = (ok: boolean, code: string) => { if (!ok) errors.push(code); };

	const visit = (value: unknown, key = "root", depth = 0): void => {
		if (depth > 12) { errors.push(`${key}: depth exceeded`); return; }
		if (typeof value === "string") {
			if (value.length > 256) errors.push(`${key}: string too long`);
			if (ABSOLUTE_PRIVATE_PATH.test(value)) errors.push(`${key}: absolute private path`);
			if (SENSITIVE_VALUE.test(value)) errors.push(`${key}: sensitive value`);
			if (/Hash$/i.test(key) && !SHA256_RE.test(value)) errors.push(`${key}: invalid hash`);
			return;
		}
		if (value === null || typeof value !== "object") return;
		if (Array.isArray(value)) {
			if (value.length > 64) errors.push(`${key}: array too long`);
			value.forEach((entry, index) => visit(entry, `${key}[${index}]`, depth + 1));
			return;
		}
		for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
			if (FORBIDDEN_FIELD.test(childKey)) errors.push(`${key}.${childKey}: forbidden field`);
			visit(child, childKey, depth + 1);
		}
	};
	visit(state);
	const root = exact("root", state, ["v", "mode", "identity", "lifecycle", "workflow", "objective", "environment", "plan", "mutation", "verification", "evidence", "failures", "capabilities", "control", "context", "outcome", "counters", "legacy"]);
	if (!root) return errors;
	assert(root.v === 1 && root.mode === "shadow", "root: invalid version or mode");

	const identity = exact("identity", root.identity, ["sessionIdHash", "runIdHash", "cycleIdHash", "generation", "surfaceHash"]);
	if (identity) {
		assert(hash(identity.sessionIdHash) && hash(identity.runIdHash) && nullableHash(identity.cycleIdHash) && integer(identity.generation) && hash(identity.surfaceHash), "identity: invalid value");
	}
	const lifecycle = exact("lifecycle", root.lifecycle, ["state", "lastTransitionSequence"]);
	if (lifecycle) assert(LIFECYCLES.has(String(lifecycle.state)) && integer(lifecycle.lastTransitionSequence), "lifecycle: invalid value");
	const workflow = exact("workflow", root.workflow, ["phase", "previousPhase", "reason", "history"]);
	if (workflow) {
		assert(PHASES.has(String(workflow.phase)) && (workflow.previousPhase === null || PHASES.has(String(workflow.previousPhase))) && typeof workflow.reason === "string" && SAFE_LABEL.test(workflow.reason) && workflow.reason.length <= 64, "workflow: invalid value");
		assert(Array.isArray(workflow.history) && workflow.history.length <= MAX_TRANSITIONS, "workflow.history: invalid length");
		for (const [index, raw] of (Array.isArray(workflow.history) ? workflow.history : []).entries()) {
			const entry = exact(`workflow.history[${index}]`, raw, ["sequence", "atMs", "from", "to", "reason"]);
			if (entry) assert(integer(entry.sequence) && finite(entry.atMs) && PHASES.has(String(entry.from)) && PHASES.has(String(entry.to)) && typeof entry.reason === "string" && SAFE_LABEL.test(entry.reason) && entry.reason.length <= 64, `workflow.history[${index}]: invalid value`);
		}
	}
	const objective = exact("objective", root.objective, ["hash", "label"]);
	if (objective) assert(nullableHash(objective.hash) && (objective.label === null || (typeof objective.label === "string" && objective.label.length <= 160 && !/[\r\n`]/.test(objective.label))), "objective: invalid value");
	const environment = exact("environment", root.environment, ["piVersion", "provider", "model", "activeToolCount", "allToolCount", "preservedExplicitTools", "detectedGateHash", "sandboxPosture"]);
	if (environment) assert([environment.piVersion, environment.provider, environment.model].every((value) => typeof value === "string" && value.length > 0 && value.length <= 96 && SAFE_LABEL.test(value)) && integer(environment.activeToolCount) && integer(environment.allToolCount) && Number(environment.activeToolCount) <= Number(environment.allToolCount) && bool(environment.preservedExplicitTools) && nullableHash(environment.detectedGateHash) && ["declared", "host", "unknown"].includes(String(environment.sandboxPosture)), "environment: invalid value");
	const plan = exact("plan", root.plan, ["accepted", "executionStarted", "currentItemHash", "openItems", "blockedItems"]);
	if (plan) assert(bool(plan.accepted) && bool(plan.executionStarted) && nullableHash(plan.currentItemHash) && nullableInt(plan.openItems) && nullableInt(plan.blockedItems), "plan: invalid value");
	const mutation = exact("mutation", root.mutation, ["count", "lastStartedSequence", "lastCompletedSequence", "lastTargetHash"]);
	if (mutation) assert(integer(mutation.count) && nullableInt(mutation.lastStartedSequence) && nullableInt(mutation.lastCompletedSequence) && nullableHash(mutation.lastTargetHash), "mutation: invalid value");
	const verification = exact("verification", root.verification, ["attempts", "validGates", "lastKind", "lastStartedSequence", "lastEndedSequence", "lastPassed", "validAfterMutation"]);
	if (verification) assert(integer(verification.attempts) && integer(verification.validGates) && VERIFICATIONS.has(String(verification.lastKind)) && nullableInt(verification.lastStartedSequence) && nullableInt(verification.lastEndedSequence) && bool(verification.lastPassed) && bool(verification.validAfterMutation), "verification: invalid value");
	const evidence = exact("evidence", root.evidence, ["facts"]);
	if (evidence) {
		assert(Array.isArray(evidence.facts) && evidence.facts.length <= 32, "evidence: invalid length");
		for (const [index, raw] of (Array.isArray(evidence.facts) ? evidence.facts : []).entries()) {
			const fact = exact(`evidence.facts[${index}]`, raw, ["hash", "provenance"]);
			if (fact) assert(hash(fact.hash) && PROVENANCE.has(String(fact.provenance)), `evidence.facts[${index}]: invalid value`);
		}
	}
	const failures = exact("failures", root.failures, ["count", "lastClass", "activeWalls", "exposedEpisodes"]);
	if (failures) assert(integer(failures.count) && (failures.lastClass === null || FAILURE_CLASSES.has(String(failures.lastClass))) && integer(failures.activeWalls) && integer(failures.exposedEpisodes), "failures: invalid value");
	const capabilities = exact("capabilities", root.capabilities, ["activeToolCount", "allToolCount", "preservedExplicitTools"]);
	if (capabilities) assert(integer(capabilities.activeToolCount) && integer(capabilities.allToolCount) && Number(capabilities.activeToolCount) <= Number(capabilities.allToolCount) && bool(capabilities.preservedExplicitTools), "capabilities: invalid value");
	const control = exact("control", root.control, ["boundarySequence", "proposals", "collisions", "lastDecision"]);
	if (control) {
		assert(integer(control.boundarySequence) && integer(control.proposals) && integer(control.collisions), "control: invalid counts");
		if (control.lastDecision !== null) {
			const decision = exact("control.lastDecision", control.lastDecision, ["kind", "reason", "source", "priority", "mode"]);
			if (decision) assert(CONTROL_KINDS.has(String(decision.kind)) && CONTROL_REASONS.has(String(decision.reason)) && CONTROL_SOURCES.has(String(decision.source)) && CONTROL_MODES.has(String(decision.mode)) && integer(decision.priority), "control.lastDecision: invalid value");
		}
	}
	const context = exact("context", root.context, ["usagePct", "compactionGeneration"]);
	if (context) assert((context.usagePct === null || (finite(context.usagePct) && Number(context.usagePct) <= 100)) && integer(context.compactionGeneration), "context: invalid value");
	const outcome = exact("outcome", root.outcome, ["status", "lastAssistantTextOnly"]);
	if (outcome) assert(OUTCOMES.has(String(outcome.status)) && bool(outcome.lastAssistantTextOnly), "outcome: invalid value");
	const counters = exact("counters", root.counters, ["receipts", "missingStart", "missingResult"]);
	if (counters) assert(integer(counters.receipts) && integer(counters.missingStart) && integer(counters.missingResult), "counters: invalid value");
	const legacy = exact("legacy", root.legacy, ["planActive", "planItemActive", "planItemHash", "planOpenItems", "planBlockedItems", "verifyKnown", "verifyMutated", "verifyOk"]);
	if (legacy) assert(bool(legacy.planActive) && bool(legacy.planItemActive) && nullableHash(legacy.planItemHash) && nullableInt(legacy.planOpenItems) && nullableInt(legacy.planBlockedItems) && bool(legacy.verifyKnown) && bool(legacy.verifyMutated) && bool(legacy.verifyOk), "legacy: invalid value");
	return errors;
}
