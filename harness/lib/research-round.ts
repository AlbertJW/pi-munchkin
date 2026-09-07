import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdir, open, readFile, stat, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentDir } from "./agent-dir.ts";
import { atomicWriteFile } from "./private-artifact.ts";
import { canonicalResearchUrl, type EvidenceCardV1 } from "./research-evidence.ts";
import { PLAN_DEFER_FIELD_MAX_BYTES } from "./plan-limits.ts";

/**
 * Parent-owned, evidence-first research-round state.
 *
 * The model may propose queries, leads, and the next action, but this module
 * derives budget consumption and claim coverage from bounded receipts. Page
 * bodies and quotes never enter this record. A child report is useful routing
 * data only; a parent-validated evidence card is the only thing that can
 * satisfy a claim obligation.
 */

export const RESEARCH_ROUND_SCHEMA = "pi.research-round/v1" as const;
export const RESEARCH_ROUND_LEDGER_SCHEMA = "pi.research-round-ledger/v1" as const;
export const RESEARCH_ROUND_MAX_ROUNDS = 32;
export const RESEARCH_ROUND_MAX_OBLIGATIONS = 16;
export const RESEARCH_ROUND_MAX_GAPS = 24;
export const RESEARCH_ROUND_MAX_QUERIES = 3;
export const RESEARCH_ROUND_MAX_READS = 5;
export const RESEARCH_ROUND_MAX_VALIDATION_READS = 5;
export const RESEARCH_ROUND_MAX_LEADS = 16;
export const RESEARCH_ROUND_MAX_CARDS = 32;
export const RESEARCH_ROUND_MAX_CHILD_REPORTS = 24;

const ID = /^[A-Za-z0-9._:-]{1,96}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const CARD_ID = /^[a-f0-9]{32}$/;
const SAFE_RUN = /^[A-Za-z0-9._:-]{1,200}$/;
const MAX_NOTE_BYTES = 500;
const LEDGER_LOCK_TIMEOUT_MS = 10_000;
const LEDGER_LOCK_RETRY_MS = 25;
const LEDGER_LOCK_STALE_MS = 60_000;

export type ResearchGapStatus = "open" | "resolved" | "blocked" | "deferred";
export type ResearchRoundStatus = "recorded" | "blocked" | "deferred" | "ready";
export type ResearchNextAction = "search" | "read" | "validate" | "synthesize" | "stop" | "escalate";
export type ResearchRoundPhase = "discovery" | "parent_validation";
export type ResearchReceiptOutcome = "completed" | "failed" | "truncated" | "blocked";
export type ResearchBudgetEnvelope = { searches: number; reads: number; validation_reads: number };
export type ResearchBudgetConsumption = ResearchBudgetEnvelope;

export type ClaimObligationV1 = {
	claim_id: string;
	text: string;
	required: boolean;
	status: ResearchGapStatus;
	missing: string;
	why: string;
	next_action: string;
};

export type EvidenceGapV1 = {
	gap_id: string;
	claim_id: string;
	missing: string;
	why: string;
	next_action: string;
	status: ResearchGapStatus;
};

export type QueryProposalV1 = {
	query_id: string;
	claim_id: string;
	query: string;
	disposition: "accepted" | "duplicate" | "rejected";
	reason?: "duplicate" | "budget_exhausted" | "unknown_claim";
};

export type SourceLeadV1 = {
	lead_id: string;
	url: string;
	claim_ids: string[];
	triage: "selected" | "rejected" | "duplicate";
	reason?: string;
};

export type ReadReceiptV1 = {
	url: string;
	phase: ResearchRoundPhase;
	method: "ketch" | "jina";
	outcome: ResearchReceiptOutcome;
	truncated: boolean;
	parent_validated: boolean;
	disposition: "accepted" | "duplicate" | "rejected";
	reason?: "duplicate" | "budget_exhausted" | "unknown_source";
};

export type EvidenceCardRefV1 = {
	card_id: string;
	original_url: string;
	content_sha256: string;
	claim_ids: string[];
	truncated: boolean;
	parent_validated: boolean;
	retrieval_method: "ketch" | "jina";
};

export type ResearchConflictV1 = {
	conflict_id: string;
	claim_id: string;
	card_ids: string[];
	status: "open" | "resolved" | "deferred";
	note?: string;
};

export type ResearchRoundProposalV1 = {
	schema: typeof RESEARCH_ROUND_SCHEMA;
	run_id: string;
	parent_item_id?: string;
	round_id: string;
	selected_gaps: string[];
	queries: Array<Pick<QueryProposalV1, "query_id" | "claim_id" | "query">>;
	source_leads: Array<Pick<SourceLeadV1, "lead_id" | "url" | "claim_ids" | "triage"> & { reason?: string }>;
	reads: Array<Pick<ReadReceiptV1, "url" | "phase" | "method" | "outcome" | "truncated" | "parent_validated">>;
	evidence_cards: EvidenceCardRefV1[];
	conflicts: ResearchConflictV1[];
	gaps: EvidenceGapV1[];
	proposed_next_action: ResearchNextAction;
	note?: string;
};

export type ResearchRoundV1 = {
	schema: typeof RESEARCH_ROUND_SCHEMA;
	run_id: string;
	parent_item_id?: string;
	round_id: string;
	created_at: string;
	selected_gaps: string[];
	queries: QueryProposalV1[];
	source_leads: SourceLeadV1[];
	reads: ReadReceiptV1[];
	evidence_cards: EvidenceCardRefV1[];
	conflicts: ResearchConflictV1[];
	gaps: EvidenceGapV1[];
	consumed: ResearchBudgetConsumption;
	budget_before: ResearchBudgetEnvelope;
	budget_after: ResearchBudgetEnvelope;
	duplicate_count: number;
	next_action: ResearchNextAction;
	status: ResearchRoundStatus;
	note?: string;
	digest: string;
};

export type ChildResearchReportV1 = {
	report_id: string;
	run_id: string;
	parent_item_id?: string;
	owner_ref: string;
	status: "done" | "blocked" | "deferred";
	allocated: ResearchBudgetConsumption;
	consumed: ResearchBudgetConsumption;
	source_leads: Array<{ url: string; claim_ids: string[] }>;
	evidence_cards?: EvidenceCardRefV1[];
	gaps: EvidenceGapV1[];
	failure_class?: "child_failed" | "interrupted" | "invalid_report";
};

export type ChildReservationV1 = {
	owner_ref: string;
	allocated: ResearchBudgetConsumption;
	reserved_at: string;
};

export type ChildReportReceiptV1 = {
	report_id: string;
	owner_ref: string;
	digest: string;
	status: ChildResearchReportV1["status"];
	charged: ResearchBudgetConsumption;
	merged_at: string;
};

export type ResearchDeferralV1 = { claim_id: string; value: string; risk: string; rationale: string };

export type ResearchRoundLedgerStateV1 = {
	schema: typeof RESEARCH_ROUND_LEDGER_SCHEMA;
	run_id: string;
	budget: { allocated: ResearchBudgetEnvelope; consumed: ResearchBudgetEnvelope; reserved: ResearchBudgetEnvelope };
	obligations: ClaimObligationV1[];
	gaps: EvidenceGapV1[];
	conflicts: ResearchConflictV1[];
	evidence_cards: EvidenceCardRefV1[];
	rounds: ResearchRoundV1[];
	reserved_queries: string[];
	reserved_discovery_urls: string[];
	reserved_validation_urls: string[];
	child_reservations: ChildReservationV1[];
	child_reports: ChildReportReceiptV1[];
	deferrals: ResearchDeferralV1[];
	status: "active" | "ready" | "settled" | "blocked";
	terminal_reason?: string;
};

export type SettlementCheck = {
	ready: boolean;
	reasons: string[];
	open_required: string[];
	open_optional: string[];
	unresolved_gaps: EvidenceGapV1[];
	remaining: ResearchBudgetEnvelope;
	next_action: ResearchNextAction;
};

export type ResearchRoundLedgerOptions = {
	run_id: string;
	obligations: readonly ClaimObligationV1[];
	budget?: Partial<ResearchBudgetEnvelope>;
	state?: ResearchRoundLedgerStateV1;
};

function stable(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stable);
	if (value && typeof value === "object") {
		// Locale-sensitive ordering differs across hosts and would make digests
		// (and duplicate detection) non-portable. Use code-point ordering.
		return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
	}
	return value;
}

function canonical(value: unknown): string { return JSON.stringify(stable(value)); }

function digest(value: unknown): string { return createHash("sha256").update(canonical(value), "utf8").digest("hex"); }

function now(): string { return new Date().toISOString(); }

function text(value: unknown, maximum = MAX_NOTE_BYTES): string {
	if (typeof value !== "string" || !value.trim() || Buffer.byteLength(value, "utf8") > maximum || /[\u0000-\u001f\u007f-\u009f\r]/u.test(value)) throw new ResearchRoundError("bounded text is invalid");
	return value.trim();
}

function optionalText(value: unknown, maximum = MAX_NOTE_BYTES): string | undefined {
	if (value === undefined) return undefined;
	return text(value, maximum);
}

function id(value: unknown, name: string): string {
	if (typeof value !== "string" || !ID.test(value)) throw new ResearchRoundError(`${name} is invalid`);
	return value;
}

function nonNegative(value: unknown, name: string, maximum = 100): number {
	if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) throw new ResearchRoundError(`${name} is invalid`);
	return Number(value);
}

function envelope(value: unknown, name: string): ResearchBudgetEnvelope {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError(`${name} is invalid`);
	const item = value as Record<string, unknown>;
	if (Object.keys(item).length !== 3) throw new ResearchRoundError(`${name} is invalid`);
	return {
		searches: nonNegative(item.searches, `${name}.searches`, 3),
		reads: nonNegative(item.reads, `${name}.reads`, 5),
		validation_reads: nonNegative(item.validation_reads, `${name}.validation_reads`, 5),
	};
}

function budgetZero(): ResearchBudgetEnvelope { return { searches: 0, reads: 0, validation_reads: 0 }; }
function add(a: ResearchBudgetEnvelope, b: ResearchBudgetEnvelope): ResearchBudgetEnvelope {
	return { searches: a.searches + b.searches, reads: a.reads + b.reads, validation_reads: a.validation_reads + b.validation_reads };
}
function subtract(a: ResearchBudgetEnvelope, b: ResearchBudgetEnvelope): ResearchBudgetEnvelope {
	return { searches: Math.max(0, a.searches - b.searches), reads: Math.max(0, a.reads - b.reads), validation_reads: Math.max(0, a.validation_reads - b.validation_reads) };
}
function within(value: ResearchBudgetEnvelope, ceiling: ResearchBudgetEnvelope): boolean {
	return value.searches <= ceiling.searches && value.reads <= ceiling.reads && value.validation_reads <= ceiling.validation_reads;
}
function equal(a: ResearchBudgetEnvelope, b: ResearchBudgetEnvelope): boolean {
	return a.searches === b.searches && a.reads === b.reads && a.validation_reads === b.validation_reads;
}
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }

function utf8Prefix(value: string, maxBytes: number): string {
	let end = Math.min(value.length, Math.max(0, maxBytes));
	while (end > 0 && Buffer.byteLength(value.slice(0, end), "utf8") > maxBytes) end -= 1;
	return value.slice(0, end);
}

export class ResearchRoundError extends Error {
	constructor(message: string) { super(message); this.name = "ResearchRoundError"; }
}

function validTimestamp(value: unknown): value is string {
	return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
}

function validUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 1_999) return false;
	try { return canonicalResearchUrl(value) === value; } catch { return false; }
}

function validateObligation(value: unknown, name: string): ClaimObligationV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError(`${name} is invalid`);
	const item = value as Record<string, unknown>;
	if (Object.keys(item).length !== 7) throw new ResearchRoundError(`${name} has unknown fields`);
	return {
		claim_id: id(item.claim_id, `${name}.claim_id`), text: text(item.text, 500), required: item.required === true,
		status: item.status === "open" || item.status === "resolved" || item.status === "blocked" || item.status === "deferred" ? item.status : (() => { throw new ResearchRoundError(`${name}.status is invalid`); })(),
		missing: text(item.missing, 300), why: text(item.why, 300), next_action: text(item.next_action, 300),
	};
}

function validateGap(value: unknown, name: string, claims: ReadonlySet<string>): EvidenceGapV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError(`${name} is invalid`);
	const item = value as Record<string, unknown>;
	if (Object.keys(item).length !== 6) throw new ResearchRoundError(`${name} has unknown fields`);
	const result: EvidenceGapV1 = {
		gap_id: id(item.gap_id, `${name}.gap_id`), claim_id: id(item.claim_id, `${name}.claim_id`), missing: text(item.missing, 300),
		why: text(item.why, 300), next_action: text(item.next_action, 300),
		status: item.status === "open" || item.status === "resolved" || item.status === "blocked" || item.status === "deferred" ? item.status : (() => { throw new ResearchRoundError(`${name}.status is invalid`); })(),
	};
	if (!claims.has(result.claim_id)) throw new ResearchRoundError(`${name}.claim_id is unknown`);
	return result;
}

function validateCard(value: unknown, name: string, claims: ReadonlySet<string>): EvidenceCardRefV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError(`${name} is invalid`);
	const item = value as Record<string, unknown>;
	if (Object.keys(item).length !== 7) throw new ResearchRoundError(`${name} has unknown fields`);
	if (typeof item.card_id !== "string" || !CARD_ID.test(item.card_id)) throw new ResearchRoundError(`${name}.card_id is invalid`);
	if (!validUrl(item.original_url)) throw new ResearchRoundError(`${name}.original_url is not canonical`);
	if (typeof item.content_sha256 !== "string" || !SHA256.test(item.content_sha256)) throw new ResearchRoundError(`${name}.content_sha256 is invalid`);
	if (!Array.isArray(item.claim_ids) || item.claim_ids.length < 1 || item.claim_ids.length > 16 || new Set(item.claim_ids).size !== item.claim_ids.length || item.claim_ids.some((claim) => typeof claim !== "string" || !claims.has(claim))) throw new ResearchRoundError(`${name}.claim_ids are invalid`);
	if (typeof item.truncated !== "boolean" || typeof item.parent_validated !== "boolean" || (item.retrieval_method !== "ketch" && item.retrieval_method !== "jina")) throw new ResearchRoundError(`${name} metadata is invalid`);
	return { card_id: item.card_id, original_url: item.original_url, content_sha256: item.content_sha256, claim_ids: [...item.claim_ids].sort() as string[], truncated: item.truncated, parent_validated: item.parent_validated, retrieval_method: item.retrieval_method };
}

function validateConflict(value: unknown, name: string, claims: ReadonlySet<string>): ResearchConflictV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError(`${name} is invalid`);
	const item = value as Record<string, unknown>;
	if (Object.keys(item).length < 4 || Object.keys(item).length > 5) throw new ResearchRoundError(`${name} has unknown fields`);
	const claimId = id(item.claim_id, `${name}.claim_id`);
	if (!claims.has(claimId) || !Array.isArray(item.card_ids) || item.card_ids.length < 2 || item.card_ids.length > 8 || item.card_ids.some((card) => typeof card !== "string" || !CARD_ID.test(card))) throw new ResearchRoundError(`${name} is invalid`);
	if (item.status !== "open" && item.status !== "resolved" && item.status !== "deferred") throw new ResearchRoundError(`${name}.status is invalid`);
	return { conflict_id: id(item.conflict_id, `${name}.conflict_id`), claim_id: claimId, card_ids: [...new Set(item.card_ids)].sort() as string[], status: item.status, ...(item.note === undefined ? {} : { note: text(item.note, 300) }) };
}

function validateChildReportShape(value: unknown, name: string, claims: ReadonlySet<string>): ChildResearchReportV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError(`${name} is invalid`);
	const item = value as Record<string, unknown>;
	const fields = ["report_id", "run_id", "parent_item_id", "owner_ref", "status", "allocated", "consumed", "source_leads", "evidence_cards", "gaps", "failure_class"];
	if (Object.keys(item).some((key) => !fields.includes(key))) throw new ResearchRoundError(`${name} has unknown fields`);
	const reportId = id(item.report_id, `${name}.report_id`); const runId = text(item.run_id, 200); const owner = id(item.owner_ref, `${name}.owner_ref`);
	const parentItemId = item.parent_item_id === undefined ? undefined : id(item.parent_item_id, `${name}.parent_item_id`);
	if (item.status !== "done" && item.status !== "blocked" && item.status !== "deferred") throw new ResearchRoundError(`${name}.status is invalid`);
	const allocated = envelope(item.allocated, `${name}.allocated`); const consumed = envelope(item.consumed, `${name}.consumed`);
	if (allocated.validation_reads !== 0 || consumed.validation_reads !== 0 || !within(consumed, allocated)) throw new ResearchRoundError(`${name} budget is invalid`);
	if (!Array.isArray(item.source_leads) || item.source_leads.length > RESEARCH_ROUND_MAX_LEADS) throw new ResearchRoundError(`${name}.source_leads is invalid`);
	const sourceLeads = item.source_leads.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ResearchRoundError(`${name}.source_leads[${index}] is invalid`);
		const row = raw as Record<string, unknown>;
		if (Object.keys(row).length !== 2 || !validUrl(row.url) || !Array.isArray(row.claim_ids) || row.claim_ids.length < 1 || row.claim_ids.length > 16 || row.claim_ids.some((claim) => typeof claim !== "string" || !claims.has(claim))) throw new ResearchRoundError(`${name}.source_leads[${index}] is invalid`);
		return { url: canonicalResearchUrl(row.url as string), claim_ids: [...new Set(row.claim_ids as string[])].sort() };
	});
	const rawCards = item.evidence_cards === undefined ? [] : item.evidence_cards;
	if (!Array.isArray(rawCards) || rawCards.length > RESEARCH_ROUND_MAX_CARDS) throw new ResearchRoundError(`${name}.evidence_cards is invalid`);
	const evidenceCards = rawCards.map((card, index) => validateCard(card, `${name}.evidence_cards[${index}]`, claims));
	if (new Set(evidenceCards.map((card) => card.card_id)).size !== evidenceCards.length) throw new ResearchRoundError(`${name}.evidence_cards contain duplicates`);
	if (!Array.isArray(item.gaps) || item.gaps.length > RESEARCH_ROUND_MAX_GAPS) throw new ResearchRoundError(`${name}.gaps is invalid`);
	const gaps = item.gaps.map((gap, index) => validateGap(gap, `${name}.gaps[${index}]`, claims));
	if (new Set(gaps.map((gap) => gap.gap_id)).size !== gaps.length) throw new ResearchRoundError(`${name}.gaps contain duplicates`);
	if (item.failure_class !== undefined && item.failure_class !== "child_failed" && item.failure_class !== "interrupted" && item.failure_class !== "invalid_report") throw new ResearchRoundError(`${name}.failure_class is invalid`);
	return {
		report_id: reportId, run_id: runId, ...(parentItemId === undefined ? {} : { parent_item_id: parentItemId }), owner_ref: owner, status: item.status,
		allocated, consumed, source_leads: sourceLeads, evidence_cards: evidenceCards, gaps,
		...(item.failure_class === undefined ? {} : { failure_class: item.failure_class }),
	};
}

function validateProposalShape(value: unknown): ResearchRoundProposalV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError("research round proposal is invalid");
	const item = value as Record<string, unknown>;
	const required = ["schema", "run_id", "round_id", "selected_gaps", "queries", "source_leads", "reads", "evidence_cards", "conflicts", "gaps", "proposed_next_action"];
	if (!required.every((key) => key in item) || Object.keys(item).some((key) => !required.includes(key) && key !== "parent_item_id" && key !== "note")) throw new ResearchRoundError("research round proposal has unknown or missing fields");
	if (item.schema !== RESEARCH_ROUND_SCHEMA) throw new ResearchRoundError("research round schema is invalid");
	const runId = text(item.run_id, 200); const roundId = id(item.round_id, "round_id");
	if (item.parent_item_id !== undefined) id(item.parent_item_id, "parent_item_id");
	if (!Array.isArray(item.selected_gaps) || item.selected_gaps.length > RESEARCH_ROUND_MAX_GAPS || new Set(item.selected_gaps).size !== item.selected_gaps.length || item.selected_gaps.some((gap) => typeof gap !== "string" || !ID.test(gap))) throw new ResearchRoundError("selected_gaps are invalid");
	if (!Array.isArray(item.queries) || item.queries.length > RESEARCH_ROUND_MAX_QUERIES) throw new ResearchRoundError("queries are invalid");
	const queries = item.queries.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw as object).length !== 3) throw new ResearchRoundError(`queries[${index}] is invalid`);
		const row = raw as Record<string, unknown>; return { query_id: id(row.query_id, `queries[${index}].query_id`), claim_id: id(row.claim_id, `queries[${index}].claim_id`), query: text(row.query, 500) };
	});
	if (new Set(queries.map((query) => query.query_id)).size !== queries.length) throw new ResearchRoundError("query IDs must be unique");
	if (!Array.isArray(item.source_leads) || item.source_leads.length > RESEARCH_ROUND_MAX_LEADS) throw new ResearchRoundError("source_leads are invalid");
	const sourceLeads = item.source_leads.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ResearchRoundError(`source_leads[${index}] is invalid`);
		const row = raw as Record<string, unknown>;
		if (Object.keys(row).some((key) => !["lead_id", "url", "claim_ids", "triage", "reason"].includes(key))) throw new ResearchRoundError(`source_leads[${index}] has unknown fields`);
		if (!validUrl(row.url)) throw new ResearchRoundError(`source_leads[${index}].url is not canonical`);
		if (!Array.isArray(row.claim_ids) || row.claim_ids.length < 1 || row.claim_ids.length > 16 || row.claim_ids.some((claim) => typeof claim !== "string" || !ID.test(claim))) throw new ResearchRoundError(`source_leads[${index}].claim_ids are invalid`);
		if (row.triage !== "selected" && row.triage !== "rejected" && row.triage !== "duplicate") throw new ResearchRoundError(`source_leads[${index}].triage is invalid`);
		return { lead_id: id(row.lead_id, `source_leads[${index}].lead_id`), url: row.url as string, claim_ids: [...new Set(row.claim_ids)].sort() as string[], triage: row.triage as SourceLeadV1["triage"], ...(row.reason === undefined ? {} : { reason: text(row.reason, 300) }) };
	});
	if (new Set(sourceLeads.map((lead) => lead.lead_id)).size !== sourceLeads.length) throw new ResearchRoundError("source lead IDs must be unique");
	if (!Array.isArray(item.reads) || item.reads.length > RESEARCH_ROUND_MAX_READS + RESEARCH_ROUND_MAX_VALIDATION_READS) throw new ResearchRoundError("reads are invalid");
	const reads = item.reads.map((raw, index) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ResearchRoundError(`reads[${index}] is invalid`);
		const row = raw as Record<string, unknown>;
		if (Object.keys(row).length !== 6 || !validUrl(row.url) || (row.phase !== "discovery" && row.phase !== "parent_validation") || (row.method !== "ketch" && row.method !== "jina") || !["completed", "failed", "truncated", "blocked"].includes(String(row.outcome)) || typeof row.truncated !== "boolean" || typeof row.parent_validated !== "boolean") throw new ResearchRoundError(`reads[${index}] is invalid`);
		return { url: row.url, phase: row.phase, method: row.method, outcome: row.outcome, truncated: row.truncated, parent_validated: row.parent_validated } as ReadReceiptV1;
	});
	if (!Array.isArray(item.evidence_cards) || item.evidence_cards.length > RESEARCH_ROUND_MAX_CARDS) throw new ResearchRoundError("evidence_cards are invalid");
	if (!Array.isArray(item.conflicts) || item.conflicts.length > 12) throw new ResearchRoundError("conflicts are invalid");
	if (!Array.isArray(item.gaps) || item.gaps.length > RESEARCH_ROUND_MAX_GAPS) throw new ResearchRoundError("gaps are invalid");
	if (!["search", "read", "validate", "synthesize", "stop", "escalate"].includes(String(item.proposed_next_action))) throw new ResearchRoundError("proposed_next_action is invalid");
	return {
		schema: RESEARCH_ROUND_SCHEMA, run_id: runId, ...(item.parent_item_id === undefined ? {} : { parent_item_id: id(item.parent_item_id, "parent_item_id") }), round_id: roundId,
		selected_gaps: [...new Set(item.selected_gaps as string[])], queries, source_leads: sourceLeads, reads, evidence_cards: item.evidence_cards as EvidenceCardRefV1[], conflicts: item.conflicts as ResearchConflictV1[], gaps: item.gaps as EvidenceGapV1[], proposed_next_action: item.proposed_next_action as ResearchNextAction, ...(item.note === undefined ? {} : { note: text(item.note, 500) }),
	};
}

/** Validate the model-facing proposal without mutating any budget or state. */
export function validateResearchRoundProposal(value: unknown): value is ResearchRoundProposalV1 {
	try { validateProposalShape(value); return true; } catch { return false; }
}

/** Validate an already-recorded round, including computed budget fields. */
export function validateResearchRound(value: unknown, allowedClaims?: ReadonlySet<string>): value is ResearchRoundV1 {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError("round is invalid");
		const item = value as Record<string, unknown>;
		const fields = ["schema", "run_id", "round_id", "created_at", "selected_gaps", "queries", "source_leads", "reads", "evidence_cards", "conflicts", "gaps", "consumed", "budget_before", "budget_after", "duplicate_count", "next_action", "status", "digest"];
		if (Object.keys(item).some((key) => !fields.includes(key) && key !== "parent_item_id" && key !== "note") || !fields.every((key) => key in item)) throw new ResearchRoundError("round has unknown or missing fields");
		if (item.schema !== RESEARCH_ROUND_SCHEMA || !validTimestamp(item.created_at) || typeof item.digest !== "string" || !SHA256.test(item.digest)) throw new ResearchRoundError("round identity is invalid");
		text(item.run_id, 200); id(item.round_id, "round_id");
		if (item.parent_item_id !== undefined) id(item.parent_item_id, "parent_item_id");
		if (!Array.isArray(item.selected_gaps) || item.selected_gaps.length > RESEARCH_ROUND_MAX_GAPS || new Set(item.selected_gaps).size !== item.selected_gaps.length || item.selected_gaps.some((gap) => typeof gap !== "string" || !ID.test(gap))) throw new ResearchRoundError("round gaps are invalid");
		if (!Array.isArray(item.queries) || item.queries.length > RESEARCH_ROUND_MAX_QUERIES || !Array.isArray(item.source_leads) || item.source_leads.length > RESEARCH_ROUND_MAX_LEADS || !Array.isArray(item.reads) || item.reads.length > RESEARCH_ROUND_MAX_READS + RESEARCH_ROUND_MAX_VALIDATION_READS || !Array.isArray(item.evidence_cards) || item.evidence_cards.length > RESEARCH_ROUND_MAX_CARDS || !Array.isArray(item.conflicts) || item.conflicts.length > 12 || !Array.isArray(item.gaps) || item.gaps.length > RESEARCH_ROUND_MAX_GAPS) throw new ResearchRoundError("round arrays are invalid");
		const roundClaims = new Set<string>(allowedClaims ?? []);
		for (const [index, query] of (item.queries as unknown[]).entries()) {
			if (!query || typeof query !== "object" || Array.isArray(query)) throw new ResearchRoundError(`round query ${index} is invalid`);
			const row = query as Record<string, unknown>; if (Object.keys(row).some((key) => !["query_id", "claim_id", "query", "disposition", "reason"].includes(key)) || Object.keys(row).length < 4 || Object.keys(row).length > 5) throw new ResearchRoundError(`round query ${index} has unknown fields`);
			id(row.query_id, `round query ${index}.query_id`); const claimId = id(row.claim_id, `round query ${index}.claim_id`); text(row.query, 500); if (!["accepted", "duplicate", "rejected"].includes(String(row.disposition))) throw new ResearchRoundError(`round query ${index}.disposition is invalid`); if (row.reason !== undefined && !["duplicate", "budget_exhausted", "unknown_claim"].includes(String(row.reason))) throw new ResearchRoundError(`round query ${index}.reason is invalid`); roundClaims.add(claimId);
		}
		if (new Set((item.queries as Array<Record<string, unknown>>).map((query) => query.query_id)).size !== item.queries.length) throw new ResearchRoundError("round query IDs are not unique");
	for (const [index, lead] of (item.source_leads as unknown[]).entries()) {
			if (!lead || typeof lead !== "object" || Array.isArray(lead)) throw new ResearchRoundError(`round source lead ${index} is invalid`);
			const row = lead as Record<string, unknown>; if (Object.keys(row).some((key) => !["lead_id", "url", "claim_ids", "triage", "reason"].includes(key))) throw new ResearchRoundError(`round source lead ${index} has unknown fields`); id(row.lead_id, `round source lead ${index}.lead_id`); if (!validUrl(row.url) || !Array.isArray(row.claim_ids) || row.claim_ids.length < 1 || row.claim_ids.length > 16 || row.claim_ids.some((claim) => typeof claim !== "string" || !ID.test(claim))) throw new ResearchRoundError(`round source lead ${index} is invalid`); if (!["selected", "rejected", "duplicate"].includes(String(row.triage))) throw new ResearchRoundError(`round source lead ${index}.triage is invalid`); for (const claim of row.claim_ids as string[]) roundClaims.add(claim);
		}
		if (new Set((item.source_leads as Array<Record<string, unknown>>).map((lead) => lead.lead_id)).size !== item.source_leads.length) throw new ResearchRoundError("round source lead IDs are not unique");
		for (const [index, read] of (item.reads as unknown[]).entries()) {
			if (!read || typeof read !== "object" || Array.isArray(read)) throw new ResearchRoundError(`round read ${index} is invalid`);
			const row = read as Record<string, unknown>; if (Object.keys(row).some((key) => !["url", "phase", "method", "outcome", "truncated", "parent_validated", "disposition", "reason"].includes(key)) || Object.keys(row).length < 7 || Object.keys(row).length > 8 || !validUrl(row.url) || !["discovery", "parent_validation"].includes(String(row.phase)) || !["ketch", "jina"].includes(String(row.method)) || !["completed", "failed", "truncated", "blocked"].includes(String(row.outcome)) || typeof row.truncated !== "boolean" || typeof row.parent_validated !== "boolean" || !["accepted", "duplicate", "rejected"].includes(String(row.disposition))) throw new ResearchRoundError(`round read ${index} is invalid`); if (row.reason !== undefined && !["duplicate", "budget_exhausted", "unknown_source"].includes(String(row.reason))) throw new ResearchRoundError(`round read ${index}.reason is invalid`);
		}
		// Parent-validation rounds may contain no new query or lead. Their gap
		// claims still provide the round-local claim vocabulary; cards must match
		// that vocabulary rather than introducing arbitrary obligations.
		for (const [index, gap] of (item.gaps as unknown[]).entries()) {
			if (!gap || typeof gap !== "object" || Array.isArray(gap)) throw new ResearchRoundError(`round gap ${index} is invalid`);
			const claim = (gap as Record<string, unknown>).claim_id;
			if (typeof claim === "string" && ID.test(claim)) roundClaims.add(claim);
		}
		for (const [index, card] of (item.evidence_cards as unknown[]).entries()) validateCard(card, `round evidence card ${index}`, roundClaims);
		for (const [index, conflict] of (item.conflicts as unknown[]).entries()) validateConflict(conflict, `round conflict ${index}`, roundClaims);
		for (const [index, gap] of (item.gaps as unknown[]).entries()) validateGap(gap, `round gap ${index}`, roundClaims);
		envelope(item.consumed, "round.consumed"); envelope(item.budget_before, "round.budget_before"); envelope(item.budget_after, "round.budget_after");
		nonNegative(item.duplicate_count, "round.duplicate_count", 100); if (!["search", "read", "validate", "synthesize", "stop", "escalate"].includes(String(item.next_action))) throw new ResearchRoundError("round next action is invalid");
		if (!["recorded", "blocked", "deferred", "ready"].includes(String(item.status))) throw new ResearchRoundError("round status is invalid");
		if (item.note !== undefined) optionalText(item.note, 500);
		const { digest: suppliedDigest, ...withoutDigest } = item;
		if (suppliedDigest !== digest(withoutDigest)) throw new ResearchRoundError("round digest does not match content");
		return true;
	} catch { return false; }
}

function defaultBudget(input?: Partial<ResearchBudgetEnvelope>): ResearchBudgetEnvelope {
	const value = { searches: input?.searches ?? 3, reads: input?.reads ?? 5, validation_reads: input?.validation_reads ?? 5 };
	return envelope(value, "research budget");
}

function claimCoverage(cards: readonly EvidenceCardRefV1[]): Set<string> {
	return new Set(cards.filter((card) => card.parent_validated && !card.truncated).flatMap((card) => card.claim_ids));
}

function gapForClaim(claim: ClaimObligationV1, status: ResearchGapStatus = "open"): EvidenceGapV1 {
	return { gap_id: `gap-${claim.claim_id}`, claim_id: claim.claim_id, missing: claim.missing, why: claim.why, next_action: claim.next_action, status };
}

function proposalComparable(value: ResearchRoundProposalV1 | ResearchRoundV1): unknown {
	return {
		schema: value.schema, run_id: value.run_id, ...(value.parent_item_id === undefined ? {} : { parent_item_id: value.parent_item_id }), round_id: value.round_id,
		selected_gaps: value.selected_gaps,
		queries: value.queries.map((query) => ({ query_id: query.query_id, claim_id: query.claim_id, query: query.query })),
		source_leads: value.source_leads.map((lead) => ({ lead_id: lead.lead_id, url: lead.url, claim_ids: lead.claim_ids, triage: lead.triage, ...(lead.reason === undefined ? {} : { reason: lead.reason }) })),
		reads: value.reads.map((read) => ({ url: read.url, phase: read.phase, method: read.method, outcome: read.outcome, truncated: read.truncated, parent_validated: read.parent_validated })),
		evidence_cards: value.evidence_cards, conflicts: value.conflicts, gaps: value.gaps,
		...(value.note === undefined ? {} : { note: value.note }),
	};
}

export class ResearchRoundLedger {
	private current: ResearchRoundLedgerStateV1;

	constructor(options: ResearchRoundLedgerOptions) {
		if (options.state) {
			if (!validateResearchRoundLedger(options.state)) throw new ResearchRoundError("research round ledger state is invalid");
			if (options.state.run_id !== options.run_id) throw new ResearchRoundError("research round ledger run identity mismatch");
			this.current = clone(options.state);
			return;
		}
		const obligations = options.obligations.map((value, index) => validateObligation(value, `obligations[${index}]`));
		if (obligations.length < 1 || obligations.length > RESEARCH_ROUND_MAX_OBLIGATIONS || new Set(obligations.map((item) => item.claim_id)).size !== obligations.length) throw new ResearchRoundError("research obligations must be unique and bounded");
		const allocated = defaultBudget(options.budget);
		this.current = {
			schema: RESEARCH_ROUND_LEDGER_SCHEMA, run_id: text(options.run_id, 200), budget: { allocated, consumed: budgetZero(), reserved: budgetZero() },
			obligations, gaps: obligations.filter((item) => item.status !== "resolved").map((item) => gapForClaim(item, item.status)), conflicts: [], evidence_cards: [], rounds: [], reserved_queries: [], reserved_discovery_urls: [], reserved_validation_urls: [], child_reservations: [], child_reports: [], deferrals: [], status: "active",
		};
	}

	static fromState(state: ResearchRoundLedgerStateV1): ResearchRoundLedger { return new ResearchRoundLedger({ run_id: state.run_id, obligations: state.obligations, state }); }

	get state(): ResearchRoundLedgerStateV1 { return clone(this.current); }
	get runId(): string { return this.current.run_id; }

	remaining(): ResearchBudgetEnvelope {
		return subtract(this.current.budget.allocated, add(this.current.budget.consumed, this.current.budget.reserved));
	}

	openGaps(): EvidenceGapV1[] { return clone(this.current.gaps.filter((gap) => gap.status === "open" || gap.status === "blocked" || gap.status === "deferred")); }
	validatedClaimIds(): string[] { return [...claimCoverage(this.current.evidence_cards)].sort(); }

	/** Reserve one child allocation before launching its process. */
	reserveChild(ownerRef: string, allocated: ResearchBudgetEnvelope): ChildReservationV1 {
		if (this.current.status === "settled") throw new ResearchRoundError("research round ledger is settled and immutable");
		id(ownerRef, "owner_ref"); envelope(allocated, "child allocation");
		const existing = this.current.child_reservations.find((item) => item.owner_ref === ownerRef);
		if (existing) {
			if (!equal(existing.allocated, allocated)) throw new ResearchRoundError("child allocation conflicts with an existing reservation");
			return clone(existing);
		}
		if (this.current.child_reports.some((item) => item.owner_ref === ownerRef)) throw new ResearchRoundError("child owner already has a terminal report");
		const nextReserved = add(this.current.budget.reserved, allocated);
		if (!within(add(this.current.budget.consumed, nextReserved), this.current.budget.allocated)) throw new ResearchRoundError("research budget exhausted before child dispatch");
		const reservation = { owner_ref: ownerRef, allocated: clone(allocated), reserved_at: now() };
		this.current.child_reservations.push(reservation);
		this.current.budget.reserved = nextReserved;
		return clone(reservation);
	}

	/** Merge one child report exactly once. Late reports cannot reopen a settled ledger. */
	mergeChildReport(report: ChildResearchReportV1): { merged: boolean; reason: "merged" | "duplicate" | "settled" } {
		if (this.current.status === "settled") return { merged: false, reason: "settled" };
		const claims = new Set(this.current.obligations.map((item) => item.claim_id));
		const parsed = validateChildReportShape(report, "child report", claims);
		if (parsed.run_id !== this.current.run_id) throw new ResearchRoundError("child report run identity mismatch");
		const reportId = parsed.report_id; const reportDigest = digest(parsed);
		const prior = this.current.child_reports.find((item) => item.report_id === reportId);
		if (prior) {
			if (prior.digest !== reportDigest) throw new ResearchRoundError("duplicate child report conflicts with prior content");
			return { merged: false, reason: "duplicate" };
		}
		if (this.current.child_reports.length >= RESEARCH_ROUND_MAX_CHILD_REPORTS) throw new ResearchRoundError("child report capacity reached");
		const reservationIndex = this.current.child_reservations.findIndex((item) => item.owner_ref === parsed.owner_ref);
		const reservation = reservationIndex >= 0 ? this.current.child_reservations[reservationIndex] : undefined;
		if (!reservation) throw new ResearchRoundError("child report has no prior budget reservation");
		if (!equal(reservation.allocated, parsed.allocated)) throw new ResearchRoundError("child report allocation does not match reservation");
		const charged = parsed.failure_class || parsed.status === "blocked" ? clone(parsed.allocated) : clone(parsed.consumed);
		const nextConsumed = add(this.current.budget.consumed, charged);
		if (!within(nextConsumed, this.current.budget.allocated)) throw new ResearchRoundError("child report would exceed global budget");
		// Apply only on a clone. A malformed report must not burn a reservation or
		// otherwise mutate the parent ledger before the complete shape is accepted.
		const working = clone(this.current);
		working.budget.reserved = subtract(working.budget.reserved, reservation.allocated);
		working.budget.consumed = nextConsumed;
		working.child_reservations.splice(reservationIndex, 1);
		const gaps = parsed.gaps;
		for (const gap of gaps) {
			const priorGap = working.gaps.findIndex((item) => item.gap_id === gap.gap_id);
			if (priorGap >= 0) working.gaps[priorGap] = gap; else working.gaps.push(gap);
		}
		// Child cards are intentionally recorded as unverified metadata. Even if a
		// child lies about parent_validated, its report cannot satisfy coverage.
		for (const checked of parsed.evidence_cards ?? []) {
			if (!working.evidence_cards.some((item) => item.card_id === checked.card_id)) working.evidence_cards.push({ ...checked, parent_validated: false });
		}
		if (parsed.failure_class || parsed.status === "blocked") working.status = "blocked";
		working.child_reports.push({ report_id: reportId, owner_ref: parsed.owner_ref, digest: reportDigest, status: parsed.status, charged, merged_at: now() });
		this.current = working;
		return { merged: true, reason: "merged" };
	}

	/**
	 * Record one parent-owned research round. Reservations and computed usage are
	 * applied transactionally: malformed or over-budget proposals leave state
	 * unchanged.
	 */
	recordRound(proposal: ResearchRoundProposalV1): ResearchRoundV1 {
		if (this.current.status === "settled") throw new ResearchRoundError("research round ledger is settled and immutable");
		const parsed = validateProposalShape(proposal);
		if (parsed.run_id !== this.current.run_id) throw new ResearchRoundError("research round run identity mismatch");
		const prior = this.current.rounds.find((round) => round.round_id === parsed.round_id);
		if (prior) {
			if (digest(proposalComparable(prior)) !== digest(proposalComparable(parsed))) throw new ResearchRoundError("duplicate round conflicts with prior content");
			return clone(prior);
		}
		if (this.current.rounds.length >= RESEARCH_ROUND_MAX_ROUNDS) throw new ResearchRoundError("research round capacity reached");
		const working = clone(this.current);
		const claims = new Set(working.obligations.map((item) => item.claim_id));
		const gapIds = new Set(working.gaps.filter((gap) => gap.status !== "resolved").map((gap) => gap.gap_id));
		for (const gapId of parsed.selected_gaps) if (!gapIds.has(gapId)) throw new ResearchRoundError(`selected gap is unknown or already resolved: ${gapId}`);
		const selectedClaims = new Set(parsed.selected_gaps.flatMap((gapId) => working.gaps.filter((gap) => gap.gap_id === gapId).map((gap) => gap.claim_id)));
		for (const query of parsed.queries) if (!claims.has(query.claim_id) || (selectedClaims.size > 0 && !selectedClaims.has(query.claim_id))) throw new ResearchRoundError("query must target a selected claim obligation");
		const queries: QueryProposalV1[] = [];
		let duplicateCount = 0;
		let used: ResearchBudgetEnvelope = budgetZero();
		for (const query of parsed.queries) {
			const normalized = query.query.replace(/\s+/g, " ").trim().toLocaleLowerCase();
			if (working.reserved_queries.includes(normalized)) { queries.push({ ...query, disposition: "duplicate", reason: "duplicate" }); duplicateCount += 1; continue; }
			if (working.budget.consumed.searches + working.budget.reserved.searches + used.searches >= working.budget.allocated.searches) { queries.push({ ...query, disposition: "rejected", reason: "budget_exhausted" }); continue; }
			working.reserved_queries.push(normalized); used.searches += 1; queries.push({ ...query, disposition: "accepted" });
		}
		const sourceLeads: SourceLeadV1[] = [];
		for (const lead of parsed.source_leads) {
			if (lead.claim_ids.some((claimId) => !claims.has(claimId))) throw new ResearchRoundError("source lead references an unknown claim");
			const canonicalUrl = canonicalResearchUrl(lead.url);
			if (lead.triage !== "selected") { sourceLeads.push({ ...lead, url: canonicalUrl }); continue; }
			if (working.reserved_discovery_urls.includes(canonicalUrl)) { sourceLeads.push({ ...lead, url: canonicalUrl, triage: "duplicate", reason: "duplicate" }); duplicateCount += 1; continue; }
			working.reserved_discovery_urls.push(canonicalUrl); sourceLeads.push({ ...lead, url: canonicalUrl });
		}
		const reads: ReadReceiptV1[] = [];
		for (const read of parsed.reads) {
			const url = canonicalResearchUrl(read.url);
			const reservation = read.phase === "discovery" ? working.reserved_discovery_urls : working.reserved_validation_urls;
			const key = url;
			if (reservation.includes(key)) {
				const alreadyInRound = reads.some((item) => item.phase === read.phase && item.url === url && item.disposition === "accepted");
				const alreadyRecorded = working.rounds.some((round) => round.reads.some((item) => item.phase === read.phase && item.url === url && item.disposition === "accepted"));
				if (alreadyInRound || alreadyRecorded) {
					reads.push({ ...read, url, disposition: "duplicate", reason: "duplicate" }); duplicateCount += 1; continue;
				}
			}
			if (read.phase === "discovery") {
				if (used.reads + working.budget.consumed.reads + working.budget.reserved.reads >= working.budget.allocated.reads) { reads.push({ ...read, url, disposition: "rejected", reason: "budget_exhausted" }); continue; }
				if (!working.reserved_discovery_urls.includes(url)) working.reserved_discovery_urls.push(url);
				used.reads += 1;
			} else {
				if (used.validation_reads + working.budget.consumed.validation_reads + working.budget.reserved.validation_reads >= working.budget.allocated.validation_reads) { reads.push({ ...read, url, disposition: "rejected", reason: "budget_exhausted" }); continue; }
				if (!working.reserved_validation_urls.includes(url)) working.reserved_validation_urls.push(url);
				used.validation_reads += 1;
			}
			reads.push({ ...read, url, disposition: "accepted" });
		}
		const checkedCards = parsed.evidence_cards.map((card, index) => validateCard(card, `evidence_cards[${index}]`, claims));
		const validatedReads = new Map<string, Set<"ketch" | "jina">>();
		for (const priorRound of working.rounds) for (const read of priorRound.reads) if (read.phase === "parent_validation" && read.disposition === "accepted" && read.outcome === "completed" && !read.truncated && read.parent_validated) {
			const methods = validatedReads.get(read.url) ?? new Set<"ketch" | "jina">(); methods.add(read.method); validatedReads.set(read.url, methods);
		}
		for (const read of reads) if (read.phase === "parent_validation" && read.disposition === "accepted" && read.outcome === "completed" && !read.truncated && read.parent_validated) {
			const methods = validatedReads.get(read.url) ?? new Set<"ketch" | "jina">(); methods.add(read.method); validatedReads.set(read.url, methods);
		}
		for (const card of checkedCards) if (card.parent_validated && !card.truncated && !validatedReads.get(card.original_url)?.has(card.retrieval_method)) throw new ResearchRoundError("parent-validated evidence cards require a matching completed parent-validation read");
		for (const card of checkedCards) {
			const priorCard = working.evidence_cards.find((item) => item.card_id === card.card_id);
			if (priorCard) { if (digest(priorCard) !== digest(card)) throw new ResearchRoundError("evidence card identity conflicts"); continue; }
			working.evidence_cards.push(card);
		}
		const checkedConflicts = parsed.conflicts.map((conflict, index) => validateConflict(conflict, `conflicts[${index}]`, claims));
		for (const conflict of checkedConflicts) {
			if (conflict.card_ids.some((cardId) => !working.evidence_cards.some((card) => card.card_id === cardId))) throw new ResearchRoundError("conflict references an unknown evidence card");
			const priorConflict = working.conflicts.findIndex((item) => item.conflict_id === conflict.conflict_id);
			if (priorConflict >= 0) working.conflicts[priorConflict] = conflict; else working.conflicts.push(conflict);
		}
		const checkedGaps = parsed.gaps.map((gap, index) => validateGap(gap, `gaps[${index}]`, claims));
		for (const gap of checkedGaps) {
			const priorGap = working.gaps.findIndex((item) => item.gap_id === gap.gap_id);
			if (priorGap >= 0) working.gaps[priorGap] = gap; else working.gaps.push(gap);
		}
		const covered = claimCoverage(working.evidence_cards);
		for (const obligation of working.obligations) {
			if (covered.has(obligation.claim_id) && !working.conflicts.some((conflict) => conflict.claim_id === obligation.claim_id && conflict.status === "open")) obligation.status = "resolved";
		}
		for (const gap of working.gaps) if (covered.has(gap.claim_id) && !working.conflicts.some((conflict) => conflict.claim_id === gap.claim_id && conflict.status === "open")) gap.status = "resolved";
		const before = subtract(working.budget.allocated, add(working.budget.consumed, working.budget.reserved));
		const after = subtract(before, used);
		working.budget.consumed = add(working.budget.consumed, used);
		const unresolvedRequired = working.obligations.filter((item) => item.required && item.status !== "resolved");
		// Parent-validation reads are a separate, still-useful allowance. Exhausting
		// discovery must not make a claim terminally blocked while a parent can
		// reread an already-discovered lead and validate it.
		const noBudget = after.searches === 0 && after.reads === 0 && after.validation_reads === 0;
		if (unresolvedRequired.length > 0 && noBudget) {
			for (const claim of unresolvedRequired) {
				const index = working.gaps.findIndex((gap) => gap.claim_id === claim.claim_id && gap.status !== "resolved");
				const missing = `${claim.missing} Research budget exhausted before required evidence was obtained.`.slice(0, 300);
				if (index >= 0) working.gaps[index] = { ...working.gaps[index], status: "blocked", missing };
				else working.gaps.push({ ...gapForClaim(claim, "blocked"), missing });
			}
		}
		const openConflicts = working.conflicts.filter((conflict) => conflict.status === "open");
		const finalUnresolved = working.gaps.filter((gap) => gap.status === "open" || gap.status === "blocked" || gap.status === "deferred");
		const status: ResearchRoundStatus = unresolvedRequired.length === 0 && openConflicts.length === 0 ? "ready" : (noBudget ? "blocked" : parsed.proposed_next_action === "escalate" ? "deferred" : "recorded");
		const nextAction: ResearchNextAction = unresolvedRequired.length === 0 && openConflicts.length === 0 ? "synthesize" : openConflicts.length > 0 && after.validation_reads > 0 ? "validate" : after.reads > 0 ? "read" : after.searches > 0 ? "search" : after.validation_reads > 0 ? "validate" : "escalate";
		const roundWithoutDigest: Omit<ResearchRoundV1, "digest"> = {
			schema: RESEARCH_ROUND_SCHEMA, run_id: parsed.run_id, ...(parsed.parent_item_id === undefined ? {} : { parent_item_id: parsed.parent_item_id }), round_id: parsed.round_id, created_at: now(), selected_gaps: parsed.selected_gaps, queries, source_leads: sourceLeads, reads, evidence_cards: checkedCards, conflicts: checkedConflicts, gaps: checkedGaps, consumed: used, budget_before: before, budget_after: after, duplicate_count: duplicateCount, next_action: nextAction, status, ...(parsed.note === undefined ? {} : { note: parsed.note }),
		};
		const round: ResearchRoundV1 = { ...roundWithoutDigest, digest: digest(roundWithoutDigest) };
		if (!validateResearchRound(round, claims)) throw new ResearchRoundError("computed research round failed validation");
		working.rounds.push(round);
		working.status = status === "ready" ? "ready" : status === "blocked" ? "blocked" : "active";
		this.current = working;
		return clone(round);
	}

	settlementCheck(input: { graph_terminal: boolean; optional_deferrals?: Array<{ claim_id: string; value: string; risk: string; rationale: string }>; }): SettlementCheck {
		const covered = claimCoverage(this.current.evidence_cards);
		const openRequired = this.current.obligations.filter((item) => item.required && !covered.has(item.claim_id)).map((item) => item.claim_id);
		const openOptional = this.current.obligations.filter((item) => !item.required && !covered.has(item.claim_id)).map((item) => item.claim_id);
		const gaps = this.current.gaps.filter((gap) => gap.status !== "resolved");
		const reasons: string[] = [];
		if (!input.graph_terminal) reasons.push("graph_open");
		if (openRequired.length) reasons.push("required_claims_unresolved");
		if (this.current.conflicts.some((conflict) => conflict.status === "open")) reasons.push("conflicting_sources_unresolved");
		if (this.current.child_reservations.length) reasons.push("child_dispatch_in_flight");
		const deferrals = input.optional_deferrals ?? this.current.deferrals;
		for (const claimId of openOptional) {
			const item = deferrals.find((entry) => entry.claim_id === claimId);
			if (!item || !item.value.trim() || !item.risk.trim() || !item.rationale.trim()) reasons.push(`optional_deferral_missing:${claimId}`);
		}
		const remaining = this.remaining();
		if (openRequired.length && (remaining.searches > 0 || remaining.reads > 0 || remaining.validation_reads > 0)) reasons.push("remaining_budget_has_unresolved_claim");
		const nextAction: ResearchNextAction = reasons.length ? (remaining.searches > 0 ? "search" : remaining.validation_reads > 0 ? "validate" : "escalate") : "synthesize";
		return { ready: reasons.length === 0, reasons, open_required: openRequired, open_optional: openOptional, unresolved_gaps: clone(gaps), remaining, next_action: nextAction };
	}

	settle(input: { graph_terminal: boolean; optional_deferrals?: Array<{ claim_id: string; value: string; risk: string; rationale: string }>; reason: string }): ResearchRoundLedgerStateV1 {
		if (this.current.status === "settled") throw new ResearchRoundError("research round ledger is already settled");
		const check = this.settlementCheck(input);
		if (!check.ready) throw new ResearchRoundError(`research settlement rejected: ${check.reasons.join(", ")}`);
		const deferrals = input.optional_deferrals ?? [];
		const covered = claimCoverage(this.current.evidence_cards);
		const claims = new Set(this.current.obligations.filter((item) => !item.required && !covered.has(item.claim_id)).map((item) => item.claim_id));
		if (new Set(deferrals.map((entry) => entry.claim_id)).size !== deferrals.length || deferrals.some((entry) => !claims.has(entry.claim_id))) throw new ResearchRoundError("optional deferrals must name unique unresolved optional claims");
		for (const [index, entry] of deferrals.entries()) { id(entry.claim_id, `optional_deferrals[${index}].claim_id`); text(entry.value, 200); text(entry.risk, 200); text(entry.rationale, PLAN_DEFER_FIELD_MAX_BYTES); }
		this.current.deferrals = clone(deferrals);
		this.current.status = "settled"; this.current.terminal_reason = text(input.reason, 300);
		return this.state;
	}

	renderSummary(maxBytes = 8_000): string {
		if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new ResearchRoundError("summary byte limit is invalid");
		const check = this.settlementCheck({ graph_terminal: false });
		const summary = {
			schema: "pi.research-round-summary/v1", run_id: this.current.run_id, status: this.current.status,
			budget_remaining: check.remaining, rounds: this.current.rounds.length, validated_claims: this.validatedClaimIds(),
			gaps: this.openGaps().map((gap) => ({ gap_id: gap.gap_id, claim_id: gap.claim_id, missing: gap.missing, why: gap.why, next_action: gap.next_action, status: gap.status })),
			open_conflicts: this.current.conflicts.filter((conflict) => conflict.status === "open").map((conflict) => ({ conflict_id: conflict.conflict_id, claim_id: conflict.claim_id, card_ids: conflict.card_ids })), deferrals: this.current.deferrals, next_action: check.next_action,
		};
		let textValue = JSON.stringify(summary);
		if (Buffer.byteLength(textValue) <= maxBytes) return textValue;
		const bounded = { ...summary, validated_claims: summary.validated_claims.slice(0, 8), gaps: summary.gaps.slice(0, 4), open_conflicts: summary.open_conflicts.slice(0, 4), deferrals: summary.deferrals.slice(0, 4), truncated: true };
		textValue = JSON.stringify(bounded);
		while (Buffer.byteLength(textValue) > maxBytes && (bounded.gaps.length || bounded.open_conflicts.length || bounded.deferrals.length || bounded.validated_claims.length)) {
			if (bounded.gaps.length) bounded.gaps.pop();
			else if (bounded.open_conflicts.length) bounded.open_conflicts.pop();
			else if (bounded.deferrals.length) bounded.deferrals.pop();
			else bounded.validated_claims.pop();
			textValue = JSON.stringify(bounded);
		}
		if (Buffer.byteLength(textValue) <= maxBytes) return textValue;
		const minimal = JSON.stringify({ schema: "pi.research-round-summary/v1", status: this.current.status, truncated: true });
		return Buffer.byteLength(minimal) <= maxBytes ? minimal : utf8Prefix(minimal, maxBytes);
	}
}

function validateLedgerArray(value: unknown, name: string, max: number): void {
	if (!Array.isArray(value) || value.length > max) throw new ResearchRoundError(`${name} is invalid`);
}

export function validateResearchRoundLedger(value: unknown): value is ResearchRoundLedgerStateV1 {
	try {
		if (!value || typeof value !== "object" || Array.isArray(value)) throw new ResearchRoundError("ledger is invalid");
		const item = value as Record<string, unknown>;
		const fields = ["schema", "run_id", "budget", "obligations", "gaps", "conflicts", "evidence_cards", "rounds", "reserved_queries", "reserved_discovery_urls", "reserved_validation_urls", "child_reservations", "child_reports", "deferrals", "status"];
		if (Object.keys(item).some((key) => !fields.includes(key) && key !== "terminal_reason") || !fields.every((key) => key in item)) throw new ResearchRoundError("ledger has unknown or missing fields");
		if (item.schema !== RESEARCH_ROUND_LEDGER_SCHEMA) throw new ResearchRoundError("ledger schema is invalid");
		text(item.run_id, 200); if (item.terminal_reason !== undefined) text(item.terminal_reason, 300);
		if (!item.budget || typeof item.budget !== "object" || Array.isArray(item.budget)) throw new ResearchRoundError("ledger budget is invalid");
		const budget = item.budget as Record<string, unknown>; envelope(budget.allocated, "ledger budget.allocated"); envelope(budget.consumed, "ledger budget.consumed"); envelope(budget.reserved, "ledger budget.reserved");
		if (!within(add(budget.consumed as ResearchBudgetEnvelope, budget.reserved as ResearchBudgetEnvelope), budget.allocated as ResearchBudgetEnvelope)) throw new ResearchRoundError("ledger budget exceeds allocation");
		validateLedgerArray(item.obligations, "ledger obligations", RESEARCH_ROUND_MAX_OBLIGATIONS); const claims = new Set<string>(); for (const [index, obligation] of (item.obligations as unknown[]).entries()) { const parsed = validateObligation(obligation, `ledger obligations[${index}]`); if (claims.has(parsed.claim_id)) throw new ResearchRoundError("duplicate ledger obligation"); claims.add(parsed.claim_id); }
		validateLedgerArray(item.gaps, "ledger gaps", RESEARCH_ROUND_MAX_GAPS); const gapIds = new Set<string>(); for (const [index, gap] of (item.gaps as unknown[]).entries()) { const parsed = validateGap(gap, `ledger gaps[${index}]`, claims); if (gapIds.has(parsed.gap_id)) throw new ResearchRoundError("duplicate ledger gap"); gapIds.add(parsed.gap_id); }
		validateLedgerArray(item.conflicts, "ledger conflicts", 12); const conflictRows = (item.conflicts as unknown[]).map((conflict, index) => validateConflict(conflict, `ledger conflicts[${index}]`, claims));
		if (new Set(conflictRows.map((conflict) => conflict.conflict_id)).size !== conflictRows.length) throw new ResearchRoundError("duplicate ledger conflict");
		validateLedgerArray(item.evidence_cards, "ledger evidence cards", RESEARCH_ROUND_MAX_CARDS); const cards = (item.evidence_cards as unknown[]).map((card, index) => validateCard(card, `ledger evidence_cards[${index}]`, claims));
		const cardIds = new Set(cards.map((card) => card.card_id));
		if (cardIds.size !== cards.length) throw new ResearchRoundError("duplicate ledger evidence card");
		if (conflictRows.some((conflict) => conflict.card_ids.some((cardId) => !cardIds.has(cardId)))) throw new ResearchRoundError("ledger conflict references an unknown evidence card");
		validateLedgerArray(item.rounds, "ledger rounds", RESEARCH_ROUND_MAX_ROUNDS);
		const roundIds = new Set<string>();
		const roundUsage = budgetZero();
		for (const round of item.rounds as unknown[]) {
			if (!validateResearchRound(round, claims)) throw new ResearchRoundError("ledger contains an invalid round");
			const parsed = round as ResearchRoundV1;
			if (parsed.run_id !== item.run_id || roundIds.has(parsed.round_id)) throw new ResearchRoundError("ledger round identity is invalid");
			if (parsed.selected_gaps.some((gapId) => !gapIds.has(gapId))) throw new ResearchRoundError("ledger round references an unknown gap");
			const roundClaimIds = [
				...parsed.queries.map((query) => query.claim_id),
				...parsed.source_leads.flatMap((lead) => lead.claim_ids),
				...parsed.evidence_cards.flatMap((card) => card.claim_ids),
				...parsed.conflicts.map((conflict) => conflict.claim_id),
				...parsed.gaps.map((gap) => gap.claim_id),
			];
			if (roundClaimIds.some((claimId) => !claims.has(claimId))) throw new ResearchRoundError("ledger round references an unknown claim obligation");
			roundIds.add(parsed.round_id);
			roundUsage.searches += parsed.consumed.searches;
			roundUsage.reads += parsed.consumed.reads;
			roundUsage.validation_reads += parsed.consumed.validation_reads;
		}
		for (const name of ["reserved_queries", "reserved_discovery_urls", "reserved_validation_urls"] as const) { validateLedgerArray(item[name], `ledger ${name}`, 128); if ((item[name] as unknown[]).some((entry) => typeof entry !== "string" || entry.length > 2_000)) throw new ResearchRoundError(`ledger ${name} is invalid`); }
		validateLedgerArray(item.child_reservations, "ledger child reservations", RESEARCH_ROUND_MAX_CHILD_REPORTS);
		const owners = new Set<string>();
		let reservedUsage = budgetZero();
		for (const reservation of item.child_reservations as unknown[]) {
			if (!reservation || typeof reservation !== "object" || Object.keys(reservation).length !== 3) throw new ResearchRoundError("ledger child reservation is invalid");
			const row = reservation as Record<string, unknown>; const owner = id(row.owner_ref, "child reservation owner_ref");
			if (owners.has(owner)) throw new ResearchRoundError("duplicate child reservation owner"); owners.add(owner);
			const allocated = envelope(row.allocated, "child reservation allocated"); reservedUsage = add(reservedUsage, allocated);
			if (!validTimestamp(row.reserved_at)) throw new ResearchRoundError("child reservation timestamp is invalid");
		}
		validateLedgerArray(item.child_reports, "ledger child reports", RESEARCH_ROUND_MAX_CHILD_REPORTS);
		const reportIds = new Set<string>(); const reportOwners = new Set<string>();
		let childUsage = budgetZero();
		for (const receipt of item.child_reports as unknown[]) {
			if (!receipt || typeof receipt !== "object" || Object.keys(receipt).length !== 6) throw new ResearchRoundError("ledger child receipt is invalid");
			const row = receipt as Record<string, unknown>; const reportId = id(row.report_id, "child receipt report_id"); const owner = id(row.owner_ref, "child receipt owner_ref");
			if (reportIds.has(reportId) || owners.has(owner) || reportOwners.has(owner)) throw new ResearchRoundError("duplicate child receipt identity"); reportIds.add(reportId); reportOwners.add(owner);
			if (!SHA256.test(String(row.digest)) || !validTimestamp(row.merged_at)) throw new ResearchRoundError("child receipt identity is invalid");
			const charged = envelope(row.charged, "child receipt charged"); childUsage = add(childUsage, charged);
		}
		if (!equal(budget.consumed as ResearchBudgetEnvelope, add(roundUsage, childUsage))) throw new ResearchRoundError("ledger budget consumption does not match its rounds and child reports");
		if (!equal(budget.reserved as ResearchBudgetEnvelope, reservedUsage)) throw new ResearchRoundError("ledger budget reservations do not match child reservations");
		validateLedgerArray(item.deferrals, "ledger deferrals", RESEARCH_ROUND_MAX_OBLIGATIONS);
		const deferredClaims = new Set<string>();
		const coveredClaims = new Set(cards.filter((card) => card.parent_validated && !card.truncated).flatMap((card) => card.claim_ids));
		for (const [index, deferral] of (item.deferrals as unknown[]).entries()) {
			if (!deferral || typeof deferral !== "object" || Object.keys(deferral).length !== 4) throw new ResearchRoundError("ledger deferral is invalid");
			const row = deferral as Record<string, unknown>; const claimId = id(row.claim_id, `ledger deferrals[${index}].claim_id`);
			const obligation = (item.obligations as ClaimObligationV1[]).find((entry) => entry.claim_id === claimId);
			if (!obligation || obligation.required || coveredClaims.has(claimId) || deferredClaims.has(claimId)) throw new ResearchRoundError("ledger deferral claim is invalid");
			text(row.value, 200); text(row.risk, 200); text(row.rationale, PLAN_DEFER_FIELD_MAX_BYTES); deferredClaims.add(claimId);
		}
		if (!["active", "ready", "settled", "blocked"].includes(String(item.status))) throw new ResearchRoundError("ledger status is invalid");
		if (item.status === "settled" && (typeof item.terminal_reason !== "string" || !item.terminal_reason.trim())) throw new ResearchRoundError("settled ledger requires a terminal reason");
		if (item.status !== "settled" && item.terminal_reason !== undefined) throw new ResearchRoundError("non-settled ledger cannot carry a terminal reason");
		return true;
	} catch { return false; }
}

export function researchRoundPath(cwd: string, runId: string, env: NodeJS.ProcessEnv = process.env): string {
	const safeRun = SAFE_RUN.test(runId) && runId !== "." && runId !== ".." ? runId : digest(runId);
	const cwdHash = createHash("sha256").update(cwd, "utf8").digest("hex");
	// Pi supplies PI_CODING_AGENT_DIR for normal sessions, keeping this state
	// outside the repository. A no-environment test/embedded session has no
	// writable agent directory, so use a private project .pi fallback rather than
	// failing graph creation on an unrelated host permission error.
	const root = env.PI_CODING_AGENT_DIR ? agentDir(env) : join(cwd, ".pi");
	return join(root, "artifacts", "research-rounds", cwdHash, `${safeRun}.json`);
}

export async function readResearchRoundLedger(path: string): Promise<ResearchRoundLedgerStateV1 | null> {
	try {
		const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
		return validateResearchRoundLedger(parsed) ? clone(parsed) : null;
	} catch { return null; }
}

type LedgerFileLock = { path: string; lockId: string };

async function lockOwnerAlive(pid: number): Promise<boolean> {
	if (!Number.isSafeInteger(pid) || pid <= 0) return false;
	try { process.kill(pid, 0); return true; }
	catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function staleLedgerLock(path: string): Promise<boolean> {
	try {
		const raw = JSON.parse(await readFile(path, "utf8")) as { pid?: unknown; created_at?: unknown };
		if (typeof raw.pid === "number") return !(await lockOwnerAlive(raw.pid));
		if (typeof raw.created_at === "string" && Number.isFinite(Date.parse(raw.created_at))) return Date.now() - Date.parse(raw.created_at) > LEDGER_LOCK_STALE_MS;
	} catch { /* malformed locks are recoverable only by the bounded age check below */ }
	try {
		const info = await stat(path);
		return Date.now() - info.mtimeMs > LEDGER_LOCK_STALE_MS;
	} catch { return false; }
}

async function acquireLedgerFileLock(path: string): Promise<LedgerFileLock> {
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	await chmod(directory, 0o700);
	const lockPath = `${path}.lock`;
	const deadline = Date.now() + LEDGER_LOCK_TIMEOUT_MS;
	while (Date.now() <= deadline) {
		const lockId = randomUUID();
		try {
			const handle = await open(lockPath, "wx", 0o600);
			try {
				await handle.writeFile(`${JSON.stringify({ pid: process.pid, lock_id: lockId, created_at: new Date().toISOString() })}\n`, "utf8");
				await handle.chmod(0o600);
				await handle.sync();
			} finally { await handle.close(); }
			return { path: lockPath, lockId };
		} catch (error) {
			if ((error as NodeJS.ErrnoException)?.code !== "EEXIST") throw error;
			if (await staleLedgerLock(lockPath)) { await unlink(lockPath).catch(() => undefined); continue; }
			await new Promise((resolve) => setTimeout(resolve, LEDGER_LOCK_RETRY_MS));
		}
	}
	throw new ResearchRoundError("research round ledger is busy in another parent process; retry after it exits");
}

async function releaseLedgerFileLock(lock: LedgerFileLock): Promise<void> {
	try {
		const raw = JSON.parse(await readFile(lock.path, "utf8")) as { lock_id?: unknown };
		if (raw.lock_id !== lock.lockId) return;
	} catch { return; }
	await unlink(lock.path).catch(() => undefined);
}

async function withLedgerFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	const lock = await acquireLedgerFileLock(path);
	try { return await fn(); }
	finally { await releaseLedgerFileLock(lock); }
}

async function writeResearchRoundLedgerUnlocked(path: string, state: ResearchRoundLedgerStateV1): Promise<void> {
	if (!validateResearchRoundLedger(state)) throw new ResearchRoundError("refusing to write invalid research round ledger");
	await atomicWriteFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, directoryMode: 0o700 });
}

/** Publish a validated ledger snapshot under a cross-process lock. */
export async function writeResearchRoundLedger(path: string, state: ResearchRoundLedgerStateV1): Promise<void> {
	await withLedgerFileLock(path, () => writeResearchRoundLedgerUnlocked(path, state));
}

/** Read, mutate, and publish one ledger snapshot while holding its lock. The
 * callback runs against the latest durable state, so concurrent parent rounds
 * cannot overwrite each other's evidence or budget consumption. */
export async function mutateResearchRoundLedger<T>(path: string, fn: (ledger: ResearchRoundLedger) => Promise<T> | T): Promise<T> {
	return withLedgerFileLock(path, async () => {
		let parsed: unknown;
		try { parsed = JSON.parse(await readFile(path, "utf8")); }
		catch { throw new ResearchRoundError("research round ledger is missing or malformed"); }
		if (!validateResearchRoundLedger(parsed)) throw new ResearchRoundError("research round ledger is missing or malformed");
		const ledger = ResearchRoundLedger.fromState(parsed);
		const result = await fn(ledger);
		await writeResearchRoundLedgerUnlocked(path, ledger.state);
		return result;
	});
}

/** Convert an existing evidence card without retaining page text. */
export function evidenceCardRef(card: EvidenceCardV1): EvidenceCardRefV1 {
	if (!card || card.v !== 1) throw new ResearchRoundError("evidence card is invalid");
	return validateCard({ card_id: card.card_id, original_url: card.original_url, content_sha256: card.content_sha256, claim_ids: card.claim_ids, truncated: card.truncated, parent_validated: card.parent_validated, retrieval_method: card.retrieval_method }, "evidence card", new Set(card.claim_ids));
}
