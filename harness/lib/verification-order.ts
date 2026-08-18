export type OrderedCallKind = "source_mutation" | "verification" | "other";

export type OrderedCallStart = {
	callId: string;
	kind: OrderedCallKind;
};

export type OrderedCallFinish = {
	callId: string;
	succeeded: boolean;
	/** A plan_write can carry a separately executed aggregate gate receipt. */
	verificationOverride?: "passed" | "failed" | "none";
};

export type OrderedCallOutcome = {
	kind: OrderedCallKind;
	startedSequence: number;
	endedSequence: number;
	mutationAttempted: boolean;
	mutationSettled: boolean;
	verificationAttempted: boolean;
	verificationPassed: boolean;
	verificationOrdered: boolean;
	verificationValid: boolean;
};

type Pending = { kind: OrderedCallKind; startedSequence: number };

/**
 * Minimal execution clock for the authoritative verification gate.
 *
 * Pi can execute tool calls from one assistant message concurrently, so their
 * transcript order is not evidence of filesystem order. This clock consumes
 * tool_execution_start/end and accepts a green verifier only when its start is
 * strictly after the latest successful source mutation end.
 */
export class VerificationOrderClock {
	private sequence = 0;
	private latestMutationBoundary: number | null = null;
	private pendingMutations = 0;
	private readonly pending = new Map<string, Pending>();
	private readonly completed = new Set<string>();

	reset(): void {
		this.sequence = 0;
		this.latestMutationBoundary = null;
		this.pendingMutations = 0;
		this.pending.clear();
		this.completed.clear();
	}

	start(call: OrderedCallStart): number | null {
		if (this.pending.has(call.callId) || this.completed.has(call.callId)) return null;
		const startedSequence = ++this.sequence;
		this.pending.set(call.callId, { kind: call.kind, startedSequence });
		if (call.kind === "source_mutation") {
			// A mutation attempt invalidates earlier green evidence immediately. A
			// shell command can partially write before it fails, and a built-in tool
			// may fail after touching the filesystem.
			this.latestMutationBoundary = startedSequence;
			this.pendingMutations += 1;
		}
		this.trim(this.pending, 512);
		return startedSequence;
	}

	kindFor(callId: string): OrderedCallKind | null {
		return this.pending.get(callId)?.kind ?? null;
	}

	finish(call: OrderedCallFinish): OrderedCallOutcome | null {
		const pending = this.pending.get(call.callId);
		if (!pending || this.completed.has(call.callId)) return null;
		this.pending.delete(call.callId);
		this.completed.add(call.callId);
		this.trim(this.completed, 2048);
		const endedSequence = ++this.sequence;

		const mutationAttempted = pending.kind === "source_mutation";
		const mutationSettled = mutationAttempted;
		if (mutationAttempted) {
			this.pendingMutations = Math.max(0, this.pendingMutations - 1);
			this.latestMutationBoundary = endedSequence;
		}

		const override = call.verificationOverride ?? "none";
		const verificationAttempted = pending.kind === "verification" || override !== "none";
		const verificationPassed = verificationAttempted &&
			(override === "passed" || (override === "none" && call.succeeded));
		const verificationOrdered = verificationAttempted &&
			this.pendingMutations === 0 &&
			(this.latestMutationBoundary === null || pending.startedSequence > this.latestMutationBoundary);
		const verificationValid = verificationPassed && verificationOrdered;

		return {
			kind: pending.kind,
			startedSequence: pending.startedSequence,
			endedSequence,
			mutationAttempted,
			mutationSettled,
			verificationAttempted,
			verificationPassed,
			verificationOrdered,
			verificationValid,
		};
	}

	hasCompleted(callId: string): boolean {
		return this.completed.has(callId);
	}

	private trim<T>(collection: Map<string, T> | Set<string>, max: number): void {
		while (collection.size > max) {
			const oldest = collection.keys().next().value as string | undefined;
			if (oldest === undefined) break;
			collection.delete(oldest);
		}
	}
}
