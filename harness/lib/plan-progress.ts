// Plan-thrash detector: repeated plan_write calls that complete no item.
//
// loop-breaker.ts counts plan_write as a PROGRESS tool, so a model that rewrites
// the list every turn without finishing anything resets the loop episode and
// never trips any guard. This makes that re-plan churn visible. Pure reducer so
// it unit-tests without the SDK; the caller owns the per-process streak counter.

export function nextReplanStreak(
	streak: number,
	newlyDone: number,
	max: number,
): { streak: number; warn: boolean } {
	const next = newlyDone > 0 ? 0 : streak + 1;
	return { streak: next, warn: next >= max };
}
