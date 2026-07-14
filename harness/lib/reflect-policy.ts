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

// ---------- reasoning methods (prompt strategies, not proxy infra) ----------

// /reflect <method>. Each method = sampling shape + merge rule (+ optional
// prompt override) over the findings contract. `sc` exists because of a
// measured pathology: single reviews invent defects on clean plans, but
// hallucinated nitpicks don't recur across independent samples while real
// flaws do — consistency voting is the prompt-level cure. `premortem`
// (stunspot collection, adapted) reviews PROSPECTIVELY: imagine the executed
// plan failed spectacularly, work backward to preventative edits — a different
// failure-detection axis than the retrospective defect scan.
export type ReflectMethod = { samples: number; temperature: number; minVotes: number; prompt?: string; blurb: string };

export const PREMORTEM_PROMPT =
	"Assume the plan/answer below was executed and FAILED SPECTACULARLY. Work backward from that failure. " +
	"MATERIALITY BAR: a risk counts ONLY if it plausibly causes the stated goal to fail or causes damage — " +
	"taste, style, and process steps the plan never claimed are NOT risks. You are FORBIDDEN from proposing " +
	"new features or extra scope; preventative edits must shrink or guard the plan, not grow it. " +
	"Respond with ONLY one of: the single word CLEAN (no plausible spectacular failure), OR at most 5 lines, each " +
	"exactly '- [RISK] <failure headline>: <principal cause> — <one concrete preventative edit>'. " +
	"No headers, no bold, no prose paragraphs, no reasoning — just CLEAN or the list.";

export const METHODS: Record<string, ReflectMethod> = {
	default: { samples: 1, temperature: 0.3, minVotes: 1, blurb: "one adversarial defect scan (fast; may invent findings on clean plans)" },
	sc: { samples: 3, temperature: 0.8, minVotes: 2, blurb: "3-sample self-consistency vote (reliable CLEAN; 3x cost)" },
	premortem: { samples: 1, temperature: 0.5, minVotes: 1, prompt: PREMORTEM_PROMPT, blurb: "prospective failure imagination -> preventative edits (stunspot pre-mortem, contract-adapted)" },
};

// Normalize a finding line for cross-sample voting: tag + lowercased alnum
// words. Different phrasings of the same flaw vote together if they share the
// tag and enough content words (Jaccard >= 0.5 against an existing bucket).
export function findingKeyWords(line: string): { tag: string; words: Set<string>; steps: Set<string> } {
	const tag = (line.match(/\[(BLOCKER|RISK|CUT|VERIFY)\]/i)?.[1] ?? "?").toUpperCase();
	// The strongest identity for a plan finding is WHICH ITEM it points at —
	// phrasings of the same flaw diverge wildly, its step reference doesn't.
	const steps = new Set(Array.from(line.matchAll(/(?:step|item|#)\s*(\d+)/gi), (m) => m[1]));
	const words = new Set(
		line
			.toLowerCase()
			.replace(/\[[a-z]+\]/g, "")
			.split(/[^a-z0-9]+/)
			.filter((w) => w.length > 3),
	);
	return { tag, words, steps };
}

// Overlap coefficient (intersection over the SMALLER set), not Jaccard: a
// verbose prose finding is a superset of its terse dashed twin — Jaccard
// punishes the size difference and splits votes for the same flaw.
function similar(a: Set<string>, b: Set<string>): boolean {
	let inter = 0;
	for (const w of a) if (b.has(w)) inter++;
	const smaller = Math.min(a.size, b.size);
	return smaller > 0 && inter / smaller >= 0.5;
}

// Vote across samples: null samples (CLEAN) contribute no findings. Returns the
// surviving findings (first-seen wording) or null when nothing reaches minVotes.
export function voteFindings(samples: Array<string | null>, minVotes: number): string | null {
	// voters = which SAMPLES contributed: a sample repeating the same finding twice
	// is one vote, not two — votes must be independent across samples, or a single
	// rambling review can self-certify its own hallucination past the quorum.
	type Bucket = { tag: string; words: Set<string>; steps: Set<string>; line: string; voters: Set<number> };
	const buckets: Bucket[] = [];
	// A finding line in ANY of the model's observed formats: "- x", "* x", "1. x",
	// "**x**". Small local reviewers ignore the dash contract often enough that a
	// dash-only parser zeroes out REAL findings and votes a flawed plan CLEAN.
	const findingLine = /^\s*(?:[-*]|\d+\.|\*\*)/;
	for (let si = 0; si < samples.length; si++) {
		const s = samples[si];
		if (!s) continue;
		for (const line of s.split("\n")) {
			if (!findingLine.test(line) || line.trim().length < 20) continue;
			const { tag, words, steps } = findingKeyWords(line);
			// Identity: same step reference wins outright; otherwise tag-compatible
			// ("?" = untagged prose matches any) + word overlap. Small reviewers
			// drop the [TAG] and the dash as often as they keep them.
			const hit = buckets.find((b) => {
				const stepHit = steps.size > 0 && b.steps.size > 0 && [...steps].some((n) => b.steps.has(n));
				const tagOk = b.tag === tag || b.tag === "?" || tag === "?";
				return stepHit || (tagOk && similar(b.words, words));
			});
			if (hit) hit.voters.add(si);
			else buckets.push({ tag, words, steps, line: line.trim(), voters: new Set([si]) });
		}
	}
	const kept = buckets.filter((b) => b.voters.size >= minVotes).map((b) => b.line);
	return kept.length ? kept.join("\n") : null;
}
