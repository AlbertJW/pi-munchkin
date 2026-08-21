export type VerificationFrontierCounts = {
	passed: number;
	failed: number;
	skipped: number;
	total: number;
};

export type VerificationFrontierSnapshotV1 = {
	v: 1;
	protocol: "node_tap" | "unknown";
	recognizedGates: number;
	current: VerificationFrontierCounts | null;
	best: VerificationFrontierCounts | null;
	lastAdvanced: boolean;
	plateauStreak: number;
	successfulMutationEpochsSinceAdvance: number;
	verificationPlateauOverrun: number;
};

export type VerificationFrontierObservation = {
	snapshot: VerificationFrontierSnapshotV1;
	recognized: boolean;
	advanced: boolean;
};

// `#` is the tap reporter's marker; `\u2139` (i-in-a-circle) is the DEFAULT spec
// reporter's. Only the prefix differs -- the keys, the counts and their semantics
// are identical, because both render the same run summary from the same runner.
// Requiring `#` meant the frontier recognized nothing whenever the gate was a plain
// `node --test`, which is what agents actually run: the exact-gate frontier and the
// entire verification-plateau feature above it were inert in the default case
// (measured on node v26.5.0, 2026-08-21).
const SUMMARY = /^(?:#|\u2139)\s+(tests|pass|fail|skipped|todo|cancelled)\s+(\d+)\s*$/u;

/**
 * Parse Node's terminal run summary. Everything else is unknown.
 *
 * The snapshot calls this protocol `node_tap` for either reporter: the name is the
 * CONTRACT value (row_contract.py pins it), and the two reporters are one
 * instrument -- same runner, same counts, different marker glyph.
 */
export function parseNodeTapSummary(text: string): VerificationFrontierCounts | null {
	const values = new Map<string, number>();
	for (const raw of text.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu, "").split(/\r?\n/u)) {
		// Node's terminal summary is emitted at column zero. Indented summaries
		// belong to nested subtests and must not become the run frontier.
		const match = SUMMARY.exec(raw.trimEnd());
		if (!match) continue;
		if (values.has(match[1])) return null;
		const value = Number.parseInt(match[2], 10);
		if (!Number.isSafeInteger(value) || value < 0) return null;
		values.set(match[1], value);
	}
	for (const required of ["tests", "pass", "fail", "skipped"] as const) {
		if (!values.has(required)) return null;
	}
	const total = values.get("tests")!;
	const passed = values.get("pass")!;
	const failed = values.get("fail")!;
	const skipped = values.get("skipped")!;
	const todo = values.get("todo") ?? 0;
	const cancelled = values.get("cancelled") ?? 0;
	if (passed + failed + skipped + todo + cancelled !== total) return null;
	return { passed, failed, skipped, total };
}

function clone(value: VerificationFrontierCounts | null): VerificationFrontierCounts | null {
	return value ? { ...value } : null;
}

function advances(candidate: VerificationFrontierCounts, best: VerificationFrontierCounts | null): boolean {
	if (!best) return true;
	if (candidate.passed !== best.passed) return candidate.passed > best.passed;
	return candidate.failed < best.failed;
}

export class VerificationFrontierTracker {
	private protocol: VerificationFrontierSnapshotV1["protocol"] = "unknown";
	private recognizedGates = 0;
	private current: VerificationFrontierCounts | null = null;
	private best: VerificationFrontierCounts | null = null;
	private lastAdvanced = false;
	private plateauStreak = 0;
	private successfulMutationEpochsSinceAdvance = 0;
	private verificationPlateauOverrun = 0;

	reset(): void {
		this.protocol = "unknown";
		this.recognizedGates = 0;
		this.current = null;
		this.best = null;
		this.lastAdvanced = false;
		this.plateauStreak = 0;
		this.successfulMutationEpochsSinceAdvance = 0;
		this.verificationPlateauOverrun = 0;
	}

	noteToolCall(): void {
		if (this.plateauStreak >= 3) this.verificationPlateauOverrun += 1;
	}

	noteMutationSettled(succeeded: boolean): void {
		if (succeeded) this.successfulMutationEpochsSinceAdvance += 1;
		this.lastAdvanced = false;
	}

	observeExactGate(input: { text: string; passed: boolean; ordered: boolean }): VerificationFrontierSnapshotV1 {
		return this.observeExactGateDetailed(input).snapshot;
	}

	observeExactGateDetailed(input: { text: string; passed: boolean; ordered: boolean }): VerificationFrontierObservation {
		if (!input.ordered) return { snapshot: this.snapshot(), recognized: false, advanced: false };
		const parsed = parseNodeTapSummary(input.text);
		if (!parsed) return { snapshot: this.snapshot(), recognized: false, advanced: false };
		this.protocol = "node_tap";
		this.recognizedGates += 1;
		this.current = parsed;
		const advanced = advances(parsed, this.best);
		this.lastAdvanced = advanced;
		if (advanced) {
			this.best = parsed;
			this.plateauStreak = 0;
			this.successfulMutationEpochsSinceAdvance = 0;
		} else if (!input.passed) {
			this.plateauStreak += 1;
		}
		if (input.passed) this.plateauStreak = 0;
		return { snapshot: this.snapshot(), recognized: true, advanced };
	}

	snapshot(): VerificationFrontierSnapshotV1 {
		return {
			v: 1,
			protocol: this.protocol,
			recognizedGates: this.recognizedGates,
			current: clone(this.current),
			best: clone(this.best),
			lastAdvanced: this.lastAdvanced,
			plateauStreak: this.plateauStreak,
			successfulMutationEpochsSinceAdvance: this.successfulMutationEpochsSinceAdvance,
			verificationPlateauOverrun: this.verificationPlateauOverrun,
		};
	}
}
