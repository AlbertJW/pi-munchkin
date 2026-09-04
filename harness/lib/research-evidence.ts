import { createHash } from "node:crypto";

/** Compact, content-addressed evidence metadata. Page bodies never live here. */
export type EvidenceCardV1 = {
	v: 1;
	card_id: string;
	original_url: string;
	content_sha256: string;
	claim_ids: string[];
	truncated: boolean;
	parent_validated: boolean;
	retrieval_method: "ketch" | "jina";
};

export type ClaimObligation = { id: string; text?: string; required?: boolean };
export type GapQuery = { claim_id: string; query: string };
export const RESEARCH_EVIDENCE_CARDS_KEY = "__pi_research_evidence_cards_v1";

const TRACKING = /^(?:utm_[a-z0-9_]+|fbclid|gclid|dclid|msclkid|mc_cid|mc_eid)$/i;
const ID = /^[A-Za-z0-9._:-]{1,96}$/;

/** Canonical identity used for global URL deduplication and citations. */
export function canonicalResearchUrl(raw: string): string {
	if (typeof raw !== "string" || /[\u0000-\u001f\u007f]/.test(raw)) throw new Error("URL is malformed");
	const url = new URL(raw.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("only HTTP(S) URLs are supported");
	if (url.username || url.password) throw new Error("URL credentials are not allowed");
	url.hash = "";
	url.hostname = url.hostname.toLowerCase();
	if ((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443")) url.port = "";
	for (const key of [...url.searchParams.keys()]) if (TRACKING.test(key)) url.searchParams.delete(key);
	// Query order is not semantically meaningful for deduplication in this
	// retrieval layer; sorting gives stable identities without dropping useful
	// non-tracking parameters.
	url.searchParams.sort();
	if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, "");
	return url.toString();
}

function digest(value: string): string { return createHash("sha256").update(value, "utf8").digest("hex"); }

/** Stable opaque obligation id for a claim when a fixture has not supplied IDs. */
export function claimIdForText(claim: string): string { return `claim-${digest(claim.replace(/\s+/g, " ").trim()).slice(0, 24)}`; }

export function makeEvidenceCard(input: {
	original_url: string;
	content: string;
	claim_ids: string[];
	truncated: boolean;
	parent_validated: boolean;
	retrieval_method: "ketch" | "jina";
}): EvidenceCardV1 {
	const original_url = canonicalResearchUrl(input.original_url);
	if (typeof input.content !== "string" || input.content.length === 0) throw new Error("evidence content is required");
	if (!Array.isArray(input.claim_ids) || input.claim_ids.length > 16 || input.claim_ids.some((id) => !ID.test(id))) throw new Error("invalid evidence claim ids");
	const claim_ids = [...new Set(input.claim_ids)].sort();
	const content_sha256 = digest(input.content);
	const card_id = digest(`${original_url}\n${content_sha256}\n${claim_ids.join(",")}`).slice(0, 32);
	return { v: 1, card_id, original_url, content_sha256, claim_ids, truncated: Boolean(input.truncated), parent_validated: Boolean(input.parent_validated), retrieval_method: input.retrieval_method };
}

/** Keep a bounded process-local card index for recall and parent validation. */
export function rememberEvidenceCard(card: EvidenceCardV1): boolean {
	const shared = globalThis as Record<string, unknown>;
	const current = Array.isArray(shared[RESEARCH_EVIDENCE_CARDS_KEY])
		? shared[RESEARCH_EVIDENCE_CARDS_KEY] as EvidenceCardV1[] : [];
	const priorIndex = current.findIndex((entry) => entry.original_url === card.original_url);
	if (priorIndex >= 0) {
		const prior = current[priorIndex];
		if (prior.content_sha256 !== card.content_sha256 || !prior.parent_validated || !card.parent_validated) return false;
		const claim_ids = [...new Set([...prior.claim_ids, ...card.claim_ids])].sort();
		const merged = { ...card, claim_ids, card_id: digest(`${card.original_url}\n${card.content_sha256}\n${claim_ids.join(",")}` ).slice(0, 32) };
		shared[RESEARCH_EVIDENCE_CARDS_KEY] = [...current.slice(0, priorIndex), merged, ...current.slice(priorIndex + 1)];
		return true;
	}
	if (current.some((entry) => entry.card_id === card.card_id)) return false;
	shared[RESEARCH_EVIDENCE_CARDS_KEY] = [...current, card].slice(-32);
	return true;
}

/**
 * Small in-memory coverage index for one run. It deduplicates all queries and
 * URLs across branches, while only parent-validated cards satisfy obligations.
 */
export class ResearchCoverageLedger {
	private readonly obligations = new Map<string, ClaimObligation>();
	private readonly cards = new Map<string, EvidenceCardV1>();
	private readonly queries = new Set<string>();
	private readonly urls = new Set<string>();

	constructor(obligations: readonly ClaimObligation[]) {
		for (const obligation of obligations) {
			if (!ID.test(obligation.id) || this.obligations.has(obligation.id)) throw new Error("invalid or duplicate claim obligation");
			this.obligations.set(obligation.id, { ...obligation });
		}
	}

	addQuery(query: string): boolean {
		const key = query.replace(/\s+/g, " ").trim().toLocaleLowerCase();
		if (!key || key.length > 500 || this.queries.has(key)) return false;
		this.queries.add(key); return true;
	}

	addCard(card: EvidenceCardV1): boolean {
		if (card.v !== 1 || !this.obligations.size || !card.parent_validated || card.truncated || !card.claim_ids.every((id) => this.obligations.has(id))) return false;
		const url = canonicalResearchUrl(card.original_url);
		if (url !== card.original_url || this.cards.has(card.card_id)) return false;
		const prior = [...this.cards.values()].find((entry) => entry.original_url === url);
		if (prior) {
			if (prior.content_sha256 !== card.content_sha256 || !prior.parent_validated || !card.parent_validated) return false;
			const claim_ids = [...new Set([...prior.claim_ids, ...card.claim_ids])].sort();
			this.cards.set(prior.card_id, { ...prior, claim_ids });
			return true;
		}
		this.cards.set(card.card_id, card); this.urls.add(url); return true;
	}

	nextQueries(gaps: readonly GapQuery[]): GapQuery[] {
		const missing = new Set(this.unmetClaimIds());
		const selected: GapQuery[] = [];
		for (const gap of gaps) {
			if (!missing.has(gap.claim_id) || selected.some((item) => item.claim_id === gap.claim_id)) continue;
			if (this.addQuery(gap.query)) selected.push({ claim_id: gap.claim_id, query: gap.query.replace(/\s+/g, " ").trim().slice(0, 500) });
		}
		return selected;
	}

	unmetClaimIds(): string[] {
		const covered = new Set([...this.cards.values()].flatMap((card) => card.claim_ids));
		return [...this.obligations.keys()].filter((id) => !covered.has(id));
	}

	get cardCount(): number { return this.cards.size; }
	get urlCount(): number { return this.urls.size; }
}
