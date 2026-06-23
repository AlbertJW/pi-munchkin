// Pure detection + diff-shaping logic for the drift-scanner extension.
//
// Kept in lib/ with NO runtime imports so it's unit-testable under `tsx --test`
// (the extension itself value-imports @earendil-works/pi-ai, which only resolves
// under the harness's jiti alias, not under tsx). Mirrors the lib/extension split
// used by command-policy.ts.

// Match `commit` as the git SUBCOMMAND: `git [flags/args]* commit`. The lazy
// token hop `(?:\s+\S+)*?` handles forms like `git -C path commit` and
// `git add -A && git commit`; the `(?=\s|$)` lookahead requires a real space
// before `commit` and excludes plumbing (`commit-tree`, `commit-graph`) and
// incidental matches like `git log --grep=commit`.
const COMMIT_RE = /\bgit\b(?:\s+\S+)*?\s+commit(?=\s|$)/i;
const AMEND_RE = /\s--amend\b/;

// Cap on staged-diff chars sent to the reviewer — bounds model context + latency.
export const MAX_DIFF = 12_000;

// Review NEW commits only. `--amend` rewrites an already-reviewed commit and is
// often the fixup made in response to a finding → skipping avoids a
// review→fixup→review loop.
export function isReviewableCommit(command: string): boolean {
	return COMMIT_RE.test(command) && !AMEND_RE.test(command);
}

export function buildTruncatedDiff(diff: string): { text: string; truncated: boolean } {
	if (diff.length <= MAX_DIFF) return { text: diff, truncated: false };
	return { text: diff.slice(0, MAX_DIFF), truncated: true };
}

// Turn a reviewer AssistantMessage into postable findings, or null (nothing to
// surface). Pure so the three risky decisions are unit-tested in one place:
//   - non-"stop" finish (error/aborted/length) → null, so a truncated or errored
//     review is never posted as if complete.
//   - text-only content; empty (e.g. a reasoning model that emitted no final text)
//     or the "CLEAN" sentinel → null (zero noise on a clean diff).
export function extractFindings(
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
	return text;
}

// Terse, single-purpose: only drift the diff INTRODUCED, sentinel "CLEAN" when none.
// The hard "no reasoning/preamble" clause + the extension's reasoning:"minimal"
// (which diverts chain-of-thought to a thinking block) keep the answer channel to
// just the list or CLEAN — a small local model otherwise rambles its deliberation.
export const REVIEW_PROMPT =
	"You are a terse code reviewer. Review the git diff for drift it introduces: " +
	"(1) dead references — calls or imports to symbols the diff removed or renamed; " +
	"(2) orphaned definitions — functions, vars, or files the diff leaves with no remaining " +
	"caller; (3) comments or docs the diff makes inaccurate. Judge ONLY what is visible in " +
	"the diff; ignore style, naming, logic, and tests. Respond with ONLY one of: the single " +
	"word CLEAN (no drift), OR a short markdown bullet list, one finding per line as " +
	"'- <file>: <issue>'. No reasoning, no preamble, no analysis — just CLEAN or the list.";
