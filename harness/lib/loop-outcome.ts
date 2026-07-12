// Outcome-loop escalation ladder. Seen live (lc-on, 2026-07-12): the detector
// fingerprinted 23-48 IDENTICAL edit failures correctly, steered at T1 and 2×T1,
// then watched silently forever — outcome loops had no tier-3 equivalent.
// Ladder: steer at T1, steer at 2×T1, escalate at 3×T1, then stay silent.
export type OutcomeAction = "steer" | "escalate" | "none";

export function decideOutcomeAction(n: number, fired: number, t1: number): OutcomeAction {
	if ((n >= t1 && fired === 0) || (n >= t1 * 2 && fired === 1)) return "steer";
	if (n >= t1 * 3 && fired === 2) return "escalate";
	return "none";
}
