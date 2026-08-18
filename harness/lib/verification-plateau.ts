export type VerificationPlateauMode = "off" | "shadow" | "enforce";

export type VerificationPlateauScope = {
	gateHash: string;
	planItemHash: string;
};

export type VerificationPlateauObservation = {
	reached: 3 | 5 | null;
	streak: number;
	advanced: boolean;
};

export type VerificationPlateauSnapshotV1 = {
	v: 1;
	eligibleEpochs: number;
	plateauEvents: number;
	maxStreak: number;
	frontierAdvances: number;
	currentStreak: number;
	pendingSuccessfulMutation: boolean;
};

type PendingMutation = VerificationPlateauScope & { sequence: number };

function sameScope(left: VerificationPlateauScope | null, right: VerificationPlateauScope): boolean {
	return left?.gateHash === right.gateHash && left.planItemHash === right.planItemHash;
}

/**
 * Pair successful source mutations with later recognized exact-gate failures.
 * One gate consumes at most one mutation, so a burst of edits followed by one
 * test run cannot manufacture several plateau epochs.
 */
export class VerificationPlateauTracker {
	private mutationSequence = 0;
	private pending: PendingMutation | null = null;
	private scope: VerificationPlateauScope | null = null;
	private streak = 0;
	private eligibleEpochs = 0;
	private plateauEvents = 0;
	private maxStreak = 0;
	private frontierAdvances = 0;

	reset(): void {
		this.mutationSequence = 0;
		this.pending = null;
		this.scope = null;
		this.streak = 0;
		this.eligibleEpochs = 0;
		this.plateauEvents = 0;
		this.maxStreak = 0;
		this.frontierAdvances = 0;
	}

	noteSuccessfulMutation(scope: VerificationPlateauScope | null): void {
		this.mutationSequence += 1;
		this.pending = scope ? { ...scope, sequence: this.mutationSequence } : null;
	}

	notePlanItem(planItemHash: string | null): void {
		if ((this.scope && this.scope.planItemHash !== planItemHash) ||
			(this.pending && this.pending.planItemHash !== planItemHash)) this.clearEpisode();
	}

	observeExactGate(input: {
		gateHash: string;
		planItemHash: string | null;
		recognized: boolean;
		passed: boolean;
		ordered: boolean;
		advanced: boolean;
	}): VerificationPlateauObservation {
		if (input.passed && input.ordered) {
			this.clearEpisode();
			return { reached: null, streak: 0, advanced: false };
		}
		if (!input.recognized || !input.ordered) return { reached: null, streak: this.streak, advanced: false };
		if (input.advanced) {
			this.frontierAdvances += 1;
			this.clearEpisode();
			return { reached: null, streak: 0, advanced: true };
		}
		const pending = this.pending;
		if (!pending || input.planItemHash === null || input.planItemHash !== pending.planItemHash ||
			!sameScope(pending, { gateHash: input.gateHash, planItemHash: input.planItemHash })) {
			this.clearEpisode();
			return { reached: null, streak: 0, advanced: false };
		}
		this.pending = null;
		const nextScope = { gateHash: input.gateHash, planItemHash: input.planItemHash };
		if (sameScope(this.scope, nextScope)) this.streak += 1;
		else {
			this.scope = nextScope;
			this.streak = 1;
		}
		this.eligibleEpochs += 1;
		this.maxStreak = Math.max(this.maxStreak, this.streak);
		const reached = this.streak === 3 || this.streak === 5 ? this.streak : null;
		if (reached === 3) this.plateauEvents += 1;
		return { reached, streak: this.streak, advanced: false };
	}

	snapshot(): VerificationPlateauSnapshotV1 {
		return {
			v: 1,
			eligibleEpochs: this.eligibleEpochs,
			plateauEvents: this.plateauEvents,
			maxStreak: this.maxStreak,
			frontierAdvances: this.frontierAdvances,
			currentStreak: this.streak,
			pendingSuccessfulMutation: this.pending !== null,
		};
	}

	private clearEpisode(): void {
		this.pending = null;
		this.scope = null;
		this.streak = 0;
	}
}
