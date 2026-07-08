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

// Parse one legacy TODO.md list line into {title, status}. The checkbox STATE
// is preserved — `[x]`/`[X]` hydrates as done. (The old hydrate stripped the
// checkbox entirely, so completed work resurrected as pending and got redone.)
export function parseTodoLine(line: string): { title: string; status: "pending" | "done" } {
	const m = /^[-*]\s*\[(.)\]\s*/.exec(line);
	const title = line
		.replace(/^[-*]\s*\[.\]\s*/, "")
		.replace(/^TODO\s+\d+:\s*/, "")
		.trim();
	return { title, status: m && m[1].toLowerCase() === "x" ? "done" : "pending" };
}
