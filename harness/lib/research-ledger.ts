import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// research-ledger: the deterministic half of the deep-research pipeline.
//
// The model PROPOSES a citation (claim + url + quote); this code DISPOSES: the
// quote must verbatim-match (modulo whitespace) a page this session actually
// fetched, or the note is refused with the exact reason. Hallucinated citations
// become structurally impossible to RECORD — the research analogue of
// verify-gate's "no done-claim without evidence". Design grounds and the
// literature trail are in the 2026-08-05 deep-research plan (Marco
// DeepResearch's verification-centric scaffolding; Step-DeepResearch's
// provenance-survives-compression requirement — here provenance lives in a
// FILE, so compaction cannot lose it).
//
// Nothing here does model judgment. Paraphrase-level alignment is the advisory
// verifier subagent's job (skill step), and it only ever annotates.

export type CachedPage = { text: string; sha256: string; fetchedAt: string };

export const MAX_CACHED_PAGES = 20;
export const MAX_CACHE_BYTES = 2 * 1024 * 1024;

// The skill's nominal budgets (skills/deep-research/SKILL.md). Rendered in the
// budget footer so they are VISIBLE; never enforced — refusing a call on budget
// would be blocking-class, and blocking ships dark (project doctrine).
export const SKILL_BUDGET = { searches: 3, reads: 5 } as const;

export function sha256Hex(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

/** Session-scoped page cache: url -> fetched text. LRU on access, bounded by
 *  count AND total bytes. Backs quote verification, free re-reads, and the
 *  verifier pass — none of which should cost a refetch. */
export class PageCache {
	private pages = new Map<string, CachedPage>();
	private totalBytes = 0;

	put(url: string, text: string, now = new Date().toISOString()): void {
		if (!url || !text) return;
		const existing = this.pages.get(url);
		if (existing) {
			this.totalBytes -= Buffer.byteLength(existing.text);
			this.pages.delete(url);
		}
		this.pages.set(url, { text, sha256: sha256Hex(text), fetchedAt: now });
		this.totalBytes += Buffer.byteLength(text);
		this.evict();
	}

	/** LRU touch: re-insert on read so eviction drops the least recently USED. */
	get(url: string): CachedPage | undefined {
		const page = this.pages.get(url);
		if (!page) return undefined;
		this.pages.delete(url);
		this.pages.set(url, page);
		return page;
	}

	has(url: string): boolean {
		return this.pages.has(url);
	}

	size(): number {
		return this.pages.size;
	}

	bytes(): number {
		return this.totalBytes;
	}

	clear(): void {
		this.pages.clear();
		this.totalBytes = 0;
	}

	private evict(): void {
		while (this.pages.size > MAX_CACHED_PAGES || this.totalBytes > MAX_CACHE_BYTES) {
			const oldest = this.pages.keys().next().value as string | undefined;
			if (oldest === undefined) return;
			const page = this.pages.get(oldest);
			if (page) this.totalBytes -= Buffer.byteLength(page.text);
			this.pages.delete(oldest);
		}
	}
}

/** Whitespace-insensitive but otherwise VERBATIM: case, punctuation and
 *  wording must match the source exactly. Anything looser is paraphrase, and
 *  paraphrase is the advisory verifier's territory, not this check's. */
export function normalizeForContainment(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export function quoteContained(quote: string, pageText: string): boolean {
	const needle = normalizeForContainment(quote);
	if (needle.length === 0) return false;
	return normalizeForContainment(pageText).includes(needle);
}

export type NoteRejection = "url_not_read" | "quote_not_found";

export function checkNote(
	cache: PageCache,
	url: string,
	quote: string,
): { ok: true; page: CachedPage } | { ok: false; reason: NoteRejection } {
	const page = cache.get(url);
	if (!page) return { ok: false, reason: "url_not_read" };
	if (!quoteContained(quote, page.text)) return { ok: false, reason: "quote_not_found" };
	return { ok: true, page };
}

export function ledgerPath(cwd: string, startedAt: Date): string {
	const stamp = startedAt.toISOString().replace(/[:.]/g, "-").slice(0, 19);
	return join(cwd, ".pi", "research", `${stamp}.md`);
}

export function renderNoteLine(
	n: number,
	claim: string,
	url: string,
	quote: string,
	page: CachedPage,
): string {
	// One entry per line-group; quotes kept verbatim inside a fence so page text
	// can never forge the ledger's own line-oriented structure.
	return [
		`### #${n} ${claim.replace(/\s+/g, " ").trim()}`,
		`- source: ${url}`,
		`- retrieved: ${page.fetchedAt} (sha256:${page.sha256.slice(0, 12)})`,
		"```quote",
		quote.trim(),
		"```",
		"",
	].join("\n");
}

/** Append via read + tmp + rename — same crash-safety idiom as plan-runner's
 *  atomicWrite. Ledger files are small (bounded by note count × ≤1.3 KB). */
export function appendToLedger(path: string, chunk: string, header?: string): void {
	mkdirSync(dirname(path), { recursive: true });
	let existing = "";
	try {
		existing = readFileSync(path, "utf8");
	} catch {
		existing = header ?? "";
	}
	const tmp = `${path}.${process.pid}.tmp`;
	writeFileSync(tmp, existing + chunk, "utf8");
	renameSync(tmp, path);
}
