import { createHash } from "node:crypto";
import { deadlinePhase, type ResearchAggregateState } from "./research-aggregate.ts";

export const RESEARCH_DIGEST_MAX_BYTES = 2_400;
export const RESEARCH_INSPECT_PAGE_MAX_BYTES = 4_096;

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }

export type ResearchCoverageDigest = {
	schema: "pi.research-coverage-digest/v1";
	revision: number;
	phase: ResearchAggregateState["phase"];
	deadline_phase: "discovery" | "validation" | "expired";
	deadline_at?: string;
	discovery_deadline_at?: string;
	extension_count: number;
	required: Array<{ id: string; status: string }>;
	cards: string[];
	conflicts: string[];
	resources: { searches_remaining: number; reads_remaining: number; validation_reads_remaining: number };
	next_action: string;
	omitted: number;
	cursor?: string;
};

function digestModel(state: ResearchAggregateState): ResearchCoverageDigest {
	const round = state.evidence_round as Record<string, any>;
	const obligations = Array.isArray(round.obligations) ? round.obligations : [];
	const cards = Array.isArray(round.evidence_cards) ? round.evidence_cards : [];
	const conflicts = Array.isArray(round.conflicts) ? round.conflicts : [];
	const consumed = round.budget?.consumed ?? {};
	const allocated = round.budget?.allocated ?? state.budget;
	return {
		schema: "pi.research-coverage-digest/v1", revision: state.revision, phase: state.phase,
		deadline_phase: deadlinePhase(state),
		...(state.deadline ? { deadline_at: state.deadline.deadline_at, discovery_deadline_at: state.deadline.discovery_deadline_at } : {}),
		extension_count: state.deadline?.extension_count ?? 0,
		required: obligations.filter((item: any) => item?.required === true).map((item: any) => ({ id: String(item.claim_id ?? item.id ?? "unknown"), status: String(item.status ?? "open") })),
		cards: cards.flatMap((item: any) => typeof item?.card_id === "string" ? [item.card_id] : []),
		conflicts: conflicts.flatMap((item: any) => item?.status === "open" && typeof item.conflict_id === "string" ? [item.conflict_id] : []),
		resources: {
			searches_remaining: Math.max(0, Number(allocated.searches ?? 0) - Number(consumed.searches ?? 0)),
			reads_remaining: Math.max(0, Number(allocated.reads ?? 0) - Number(consumed.reads ?? 0)),
			validation_reads_remaining: Math.max(0, Number(allocated.validation_reads ?? 0) - Number(consumed.validation_reads ?? 0)),
		},
		next_action: String(round.rounds?.at?.(-1)?.next_action ?? "inspect"), omitted: 0,
	};
}

export function renderCoverageDigest(state: ResearchAggregateState, maxBytes = RESEARCH_DIGEST_MAX_BYTES): { text: string; digest: ResearchCoverageDigest } {
	const model = digestModel(state);
	const full = JSON.stringify(model);
	if (bytes(full) <= maxBytes) return { text: full, digest: model };
	const all = [...model.required.map((item) => `criterion:${item.id}`), ...model.cards.map((id) => `card:${id}`), ...model.conflicts.map((id) => `conflict:${id}`)];
	const compact: ResearchCoverageDigest = { ...model, required: [], cards: [], conflicts: [], omitted: all.length, cursor: `r${state.revision}:0` };
	let included = 0;
	for (const item of all) {
		const target = item.startsWith("criterion:") ? "required" : item.startsWith("card:") ? "cards" : "conflicts";
		const candidate = structuredClone(compact);
		if (target === "required") candidate.required.push({ id: item.slice(10), status: "open" });
		if (target === "cards") candidate.cards.push(item.slice(5));
		if (target === "conflicts") candidate.conflicts.push(item.slice(9));
		candidate.omitted = all.length - included - 1;
		candidate.cursor = `r${state.revision}:${included + 1}`;
		if (included === all.length - 1) delete candidate.cursor;
		if (bytes(JSON.stringify(candidate)) > maxBytes) break;
		compact.required = candidate.required; compact.cards = candidate.cards; compact.conflicts = candidate.conflicts; compact.omitted = candidate.omitted; compact.cursor = candidate.cursor;
		included += 1;
	}
	const text = JSON.stringify(compact);
	if (bytes(text) > maxBytes) throw new Error("research digest cap is too small for its bounded receipt");
	return { text, digest: compact };
}

export function inspectResearchPage(state: ResearchAggregateState, cursor = `r${state.revision}:0`, maxBytes = RESEARCH_INSPECT_PAGE_MAX_BYTES): { text: string; next_cursor?: string } {
	const match = /^r(\d+):(\d+)$/.exec(cursor);
	if (!match || Number(match[1]) !== state.revision) throw new Error("research inspection cursor is stale; restart from the current revision");
	const round = state.evidence_round as Record<string, any>;
	const entries = [
		...(Array.isArray(round.obligations) ? round.obligations.map((value: any) => ({ kind: "criterion", value })) : []),
		...(Array.isArray(round.evidence_cards) ? round.evidence_cards.map((value: any) => ({ kind: "card", value })) : []),
		...(Array.isArray(round.conflicts) ? round.conflicts.map((value: any) => ({ kind: "conflict", value })) : []),
	];
	const start = Number(match[2]);
	const selected: typeof entries = [];
	for (let i = start; i < entries.length; i += 1) {
		const remaining = entries.length - start - selected.length - 1;
		const hasNext = i + 1 < entries.length;
		const candidate = JSON.stringify({ schema: "pi.research-inspect/v1", revision: state.revision, entries: [...selected, entries[i]], omitted: remaining, ...(hasNext ? { next_cursor: `r${state.revision}:${i + 1}` } : {}) });
		if (bytes(candidate) > maxBytes) break;
		selected.push(entries[i]);
	}
	const next = start + selected.length < entries.length ? `r${state.revision}:${start + selected.length}` : undefined;
	const payload = { schema: "pi.research-inspect/v1", revision: state.revision, entries: selected, omitted: entries.length - start - selected.length, ...(next ? { next_cursor: next } : {}) };
	const text = JSON.stringify(payload);
	if (bytes(text) > maxBytes) throw new Error("research inspection page cap is too small for its bounded receipt");
	return { text, ...(next ? { next_cursor: next } : {}) };
}
