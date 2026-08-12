export type LoopActionDetector = "exact_outcome" | "exact_call" | "semantic_episode" | "cumulative_session";
export type LoopActionEffect = "steer" | "block" | "abort" | "shutdown";

export type LoopActionCandidate = {
	tier: 1 | 2 | 3;
	detector: LoopActionDetector;
	effect: LoopActionEffect;
};

const DETECTOR_PRIORITY: Record<LoopActionDetector, number> = {
	exact_outcome: 4,
	exact_call: 3,
	semantic_episode: 2,
	cumulative_session: 1,
};

function actionPriority(candidate: LoopActionCandidate): [number, number, number] {
	const abortPriority = candidate.effect === "abort" || candidate.effect === "shutdown" ? 1 : 0;
	return [candidate.tier, abortPriority, DETECTOR_PRIORITY[candidate.detector]];
}

/** Pure one-action reducer. Stable ties preserve emission order. */
export function selectHighestLoopAction<T extends LoopActionCandidate>(candidates: readonly T[]): T | null {
	let winner: T | null = null;
	let winnerPriority: [number, number, number] | null = null;
	for (const candidate of candidates) {
		const priority = actionPriority(candidate);
		let better = winnerPriority === null;
		if (winnerPriority) {
			for (let index = 0; index < priority.length; index += 1) {
				if (priority[index] === winnerPriority[index]) continue;
				better = priority[index] > winnerPriority[index];
				break;
			}
		}
		if (better) {
			winner = candidate;
			winnerPriority = priority;
		}
	}
	return winner;
}
