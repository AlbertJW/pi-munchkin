// Pure policy for the /reflect command (fresh-context plan review).
//
// Kept in lib/ with NO runtime imports so it's unit-testable under `tsx --test`
// — same lib/extension split as drift-policy.ts, whose extractFindings guards
// this mirrors (non-"stop" finish → null; empty/CLEAN → null).

// Cap on artifact chars sent to the reviewer, and on findings injected back.
export const MAX_ARTIFACT = 50_000;
export const MAX_FINDINGS_CHARS = 3_000;
export const MAX_ROUNDS = 2;

// The evidence behind this contract (dd1, m6/m7): self-generated prose degrades
// small-model sessions and naive "improve this" loops GROW plans. So the reviewer
// may only flag — blockers, risks, and CUTS — never add scope, and must converge
// to CLEAN. Anti-growth is the load-bearing clause.
export const REFLECT_PROMPT =
	"You are a terse adversarial plan reviewer. Review the plan/answer for MATERIAL defects only: " +
	"(1) BLOCKER — a step that cannot work as written, or a missing step the goal cannot be reached without; " +
	"(2) RISK — an unstated assumption or destructive/irreversible step with no check before it; " +
	"(3) CUT — an item not required for the stated goal (speculative scope, gold-plating, duplicate work); " +
	"(4) VERIFY — a claimed outcome with no verification step. " +
	"You are FORBIDDEN from proposing new features, extra scope, or nice-to-haves — flag additions only as CUT targets in reverse. " +
	"MATERIALITY BAR: a defect counts ONLY if the plan's stated goal fails or causes damage without the fix. " +
	"Taste, style, hypothetical robustness, edge cases outside the stated goal, and process steps the plan " +
	"never claimed (commits, deploys, announcements) are NOT defects. Most competent plans are CLEAN — " +
	"saying CLEAN is the expected common answer, not a failure to do your job. " +
	"Respond with ONLY one of: the single word CLEAN, OR at most 5 lines, each " +
	"exactly '- [BLOCKER|RISK|CUT|VERIFY] <item>: <one concrete edit>'. Every line starts with '- ['. " +
	"No headers, no bold, no prose paragraphs, no reasoning, no preamble — just CLEAN or the list.";

export function extractReflectFindings(
	content: ReadonlyArray<{ type: string; text?: string }>,
	stopReason: string,
): string | null {
	if (stopReason !== "stop") return null;
	const text = content
		.filter((c) => c.type === "text")
		.map((c) => c.text ?? "")
		.join("\n")
		.trim();
	if (!text || /^clean\b/i.test(text)) return null;
	return text.length > MAX_FINDINGS_CHARS ? `${text.slice(0, MAX_FINDINGS_CHARS)}\n…[reflect findings truncated]` : text;
}

// Manual re-invocation is the loop; this only enforces the ceiling.
export function shouldIterate(round: number, findings: string | null): boolean {
	return findings !== null && round < MAX_ROUNDS;
}
