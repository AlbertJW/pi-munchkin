// Lexical role-routing vocabulary: a model-free approximation of "which
// subagent role does this prompt sound like". A role's frontmatter
// `description` is its entire trigger surface — the two real routing bugs are
// (a) a description missing the words users actually say and (b) two roles'
// vocabularies colliding so the wrong one outranks. Both are catchable with
// token overlap, for zero tokens, in CI (role-routing.test.ts) and pi-health.

const STOPWORDS = new Set([
	"a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
	"to", "of", "in", "on", "for", "and", "or", "not", "no", "it", "its",
	"this", "that", "these", "those", "with", "as", "at", "by", "from",
	"you", "your", "i", "we", "they", "so", "if", "then", "than", "but",
	"about", "into", "over", "under", "up", "down", "out", "off", "may",
	"can", "will", "would", "should", "do", "does", "has", "have", "had",
]);

export function tokenizeStem(text: string): string[] {
	const tokens = text.toLowerCase().match(/[a-z0-9][a-z0-9-]*/g) ?? [];
	return tokens.map((token) => {
		// naive suffix stemmer — enough to map "searches"→"search", "editing"→"edit"
		if (token.length > 5 && token.endsWith("ing")) return token.slice(0, -3);
		if (token.length > 4 && token.endsWith("ed")) return token.slice(0, -2);
		if (token.length > 3 && token.endsWith("es")) return token.slice(0, -2);
		if (token.length > 3 && token.endsWith("s")) return token.slice(0, -1);
		return token;
	});
}

export function contentWords(text: string): Set<string> {
	return new Set(tokenizeStem(text).filter((token) => !STOPWORDS.has(token)));
}

// Shared-stem count between a prompt and a role's vocabulary.
export function overlapScore(promptTokens: readonly string[], roleWords: ReadonlySet<string>): number {
	let score = 0;
	for (const token of new Set(promptTokens)) if (roleWords.has(token)) score += 1;
	return score;
}

export type RoleVocabulary = { name: string; words: Set<string> };

export function roleVocabulary(name: string, description: string): RoleVocabulary {
	const words = contentWords(description);
	words.add(name.toLowerCase()); // the role's own name is part of its trigger surface
	return { name, words };
}

// Route a prompt to the highest-overlap role. margin = winner minus runner-up
// score; a margin of 0 means the routing is ambiguous.
export function routeByOverlap(prompt: string, roles: readonly RoleVocabulary[]): { winner: string | null; score: number; margin: number } {
	const promptTokens = tokenizeStem(prompt).filter((token) => !STOPWORDS.has(token));
	const scored = roles
		.map((role) => ({ name: role.name, score: overlapScore(promptTokens, role.words) }))
		.sort((a, b) => b.score - a.score || (a.name < b.name ? -1 : 1));
	if (scored.length === 0 || scored[0].score === 0) return { winner: null, score: 0, margin: 0 };
	const runnerUp = scored[1]?.score ?? 0;
	return { winner: scored[0].name, score: scored[0].score, margin: scored[0].score - runnerUp };
}

// Pairwise vocabulary collision: Jaccard over content words. Two role
// descriptions sharing more than half their vocabulary cannot be told apart
// lexically — the over-broad one will steal the other's prompts.
export function vocabularyJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
	let shared = 0;
	for (const word of a) if (b.has(word)) shared += 1;
	const union = a.size + b.size - shared;
	return union === 0 ? 0 : shared / union;
}
