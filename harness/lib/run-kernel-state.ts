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
			detectedGateHash: null,
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
		failures: { count: 0, lastClass: null },
		capabilities: { activeToolCount: 0, allToolCount: 0, preservedExplicitTools: false },
		control: { boundarySequence: 0, lastDecision: null },
		context: { compactionGeneration: 0 },
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

	reset(): void {
		this.state = initialState();
		this.lastAppliedSequence = -1;
	}

	snapshot(): RunStateV1 {
		return structuredClone(this.state);
	}

	apply(event: RunEventV1): ApplyRunEventResult {
		if (event.sequence <= this.lastAppliedSequence && event.type !== "run/session-started") {
			return { applied: false, transition: null };
		}
		if (event.type === "run/session-started") {
			this.state = initialState();
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
			};
			this.state.capabilities = {
				activeToolCount: event.activeToolCount,
				allToolCount: event.allToolCount,
				preservedExplicitTools: event.preservedExplicitTools,
			};
			this.state.legacy = { ...event.legacy };
			this.state.plan.accepted = event.legacy.planActive;
			this.state.plan.currentItemHash = event.legacy.planItemHash;
			this.state.plan.openItems = event.legacy.planOpenItems;
			this.state.plan.blockedItems = event.legacy.planBlockedItems;
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
		const hasMutation = this.state.mutation.lastCompletedSequence != null;
		if (hasMutation && !this.state.verification.validAfterMutation) {
			this.state.outcome.status = "unverified";
			return null;
		}
		if (this.state.plan.accepted && this.state.plan.openItems !== 0) {
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

/** Defense-in-depth validator for the future persistence boundary. PR 1 does
 * not persist RunState, but unsafe fields are rejected before later PRs can. */
export function validateRunStateSnapshot(state: RunStateV1): string[] {
	const errors: string[] = [];
	const visit = (value: unknown, key = "root", depth = 0): void => {
		if (depth > 12) { errors.push(`${key}: depth exceeded`); return; }
		if (typeof value === "string") {
			if (value.length > 256) errors.push(`${key}: string too long`);
			if (ABSOLUTE_PRIVATE_PATH.test(value)) errors.push(`${key}: absolute private path`);
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
	if (state.workflow.history.length > MAX_TRANSITIONS) errors.push("workflow.history: too many transitions");
	return errors;
}
