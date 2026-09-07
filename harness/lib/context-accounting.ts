import { createHash } from "node:crypto";
import type { ContextProfile } from "./context-profile.ts";

/**
 * The aggregate context contract.  This module deliberately works on the
 * provider payload, rather than on individual tool results, because the
 * provider only sees the assembled request.  All values are counts and
 * digests; raw prompt, tool, and artifact contents never leave this module.
 */
export const CONTEXT_ACCOUNTING_SCHEMA = "pi.context-accounting/v1" as const;

export type ContextTokenization = "exact" | "estimated" | "unavailable";
export type ContextConfidence = "verified" | "estimated" | "unavailable";
export type ContextAdmissionOutcome = "admitted" | "rejected" | "unavailable";
export type ContextContributorKind =
	| "system_instructions"
	| "tool_schemas"
	| "retained_history"
	| "user_input"
	| "goal_recovery"
	| "research_cards"
	| "tool_results"
	| "working_memory"
	| "request_metadata";

export type ContextContributor = {
	kind: ContextContributorKind;
	bytes: number;
	tokens: number;
	confidence: ContextConfidence;
	digest: string;
	required: boolean;
};

export type ContextAccounting = {
	schema_version: typeof CONTEXT_ACCOUNTING_SCHEMA;
	request_digest: string;
	epoch_digest: string;
	effective_window_tokens: number;
	input_allowance_tokens: number;
	completion_reserve_tokens: number;
	overhead_tokens: number;
	uncertainty_margin_tokens: number;
	payload_bytes: number;
	accounted_bytes: number;
	unaccounted_bytes: number;
	payload_tokens: number;
	observed_context_tokens: number | null;
	observed_context_window: number | null;
	usage_relation: "not_available" | "within" | "over" | "mismatch";
	reserved_tokens: number;
	total_tokens: number;
	remaining_tokens: number;
	tokenization: ContextTokenization;
	confidence: ContextConfidence;
	contributors: ContextContributor[];
	reservation_count: number;
	outcome: ContextAdmissionOutcome;
	reason_class: string;
	preservation_order: readonly string[];
	truncated: boolean;
};

type TokenCounter = (value: string) => number;

export type ContextAccountingOptions = {
	/** A provider-specific tokenizer may be supplied by a trusted adapter. */
	tokenCounter?: TokenCounter;
	/** Reservations held by concurrent retrieval/tool work for this epoch. */
	reservedTokens?: number;
	reservationCount?: number;
	/** Pi's observed context usage at the admission boundary, when available. */
	observedUsage?: { tokens?: number | null; contextWindow?: number | null; percent?: number | null };
	/** Set when a caller has explicitly truncated a recoverable view. */
	truncated?: boolean;
};

const PRESERVATION_ORDER = [
	"objective",
	"constraints",
	"active_state",
	"evidence",
	"next_action",
	"optional",
] as const;

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
		.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function finitePositive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function boundedTokenCount(value: string, tokenCounter?: TokenCounter): { bytes: number; tokens: number; confidence: ContextConfidence } {
	const bytes = utf8Bytes(value);
	if (tokenCounter) {
		try {
			const tokens = tokenCounter(value);
			if (Number.isFinite(tokens) && tokens >= 0) return { bytes, tokens: Math.ceil(tokens), confidence: "verified" };
		} catch {
			// A broken adapter must not make the request appear safe.
		}
	}
	// Four bytes/token is a deliberately conservative, language-neutral
	// estimate for UTF-8 text.  The uncertainty margin below covers the
	// remaining tokenizer and serialization variance.
	return { bytes, tokens: Math.ceil(bytes / 4), confidence: "estimated" };
}

function contributor(kind: ContextContributorKind, value: unknown, required: boolean, tokenCounter?: TokenCounter): ContextContributor {
	const serialized = typeof value === "string" ? value : stableStringify(value);
	const counted = boundedTokenCount(serialized, tokenCounter);
	return { kind, bytes: counted.bytes, tokens: counted.tokens, confidence: counted.confidence, digest: sha256(serialized), required };
}

function add(list: ContextContributor[], kind: ContextContributorKind, value: unknown, required: boolean, tokenCounter?: TokenCounter): void {
	const counted = contributor(kind, value, required, tokenCounter);
	if (counted.bytes > 0 || counted.tokens > 0) list.push(counted);
}

function messageKind(message: Record<string, unknown>, index: number, lastUserIndex: number): { kind: ContextContributorKind; required: boolean } {
	const role = String(message.role ?? "");
	const marker = `${String(message.customType ?? "")} ${String(message.type ?? "")}`.toLowerCase();
	if (role === "system") return { kind: "system_instructions", required: true };
	if (role === "tool" || role === "toolResult" || role === "tool_result") return { kind: "tool_results", required: true };
	if (role === "user" && index === lastUserIndex) return { kind: "user_input", required: true };
	if (role === "goal" || role === "recovery" || message.goalContext !== undefined || message.recoveryBrief !== undefined || /goal|recovery/.test(marker)) return { kind: "goal_recovery", required: true };
	if (role === "research" || role === "branchSummary" || message.researchCard !== undefined || /research|evidence|branch/.test(marker)) return { kind: "research_cards", required: false };
	if (role === "workingMemory" || role === "working_memory" || message.workingMemory !== undefined || /working.?memory/.test(marker)) return { kind: "working_memory", required: false };
	return { kind: "retained_history", required: false };
}

function profileWindow(profile: ContextProfile): { window: number | null; completion: number; overhead: number } {
	const window = finitePositive(profile.served_context_window) ?? finitePositive(profile.declared_context_window);
	return {
		window,
		completion: finitePositive(profile.output_reserve) ?? 0,
		overhead: Number.isFinite(profile.overhead_tokens) && profile.overhead_tokens >= 0 ? Math.floor(profile.overhead_tokens) : 0,
	};
}

/** A stable key for reservations and accounting records. */
export function contextEpochKey(profile: Pick<ContextProfile, "provider" | "model" | "endpoint_fingerprint" | "declared_context_window" | "served_context_window">): string {
	return sha256(stableStringify({
		provider: profile.provider,
		model: profile.model,
		endpoint_fingerprint: profile.endpoint_fingerprint,
		declared_context_window: profile.declared_context_window,
		served_context_window: profile.served_context_window,
	}));
}

/**
 * Build a complete accounting record from the exact payload that Pi is about
 * to hand to the provider. Each top-level field is assigned once; messages
 * are split by role, and all other fields fall into request_metadata. That
 * partition is what prevents a system prompt or tool result being counted both
 * as a named contributor and again as generic history.
 */
export function buildContextAccounting(payload: unknown, profile: ContextProfile, options: ContextAccountingOptions = {}): ContextAccounting {
	const contributors: ContextContributor[] = [];
	const tokenCounter = options.tokenCounter;
	const windowInfo = profileWindow(profile);
	const requestSerialized = stableStringify(payload);
	const requestDigest = sha256(requestSerialized);
	const payloadCounted = boundedTokenCount(requestSerialized, tokenCounter);
	const epochDigest = contextEpochKey(profile);
	const isObject = payload !== null && typeof payload === "object" && !Array.isArray(payload);

	if (isObject) {
		const record = payload as Record<string, unknown>;
		const messages = Array.isArray(record.messages) ? record.messages : null;
		const lastUserIndex = messages
			? messages.reduce((last, item, index) => String((item as Record<string, unknown> | null)?.role ?? "") === "user" ? index : last, -1)
			: -1;
		if (messages) {
			for (let index = 0; index < messages.length; index += 1) {
				const message = (messages[index] ?? {}) as Record<string, unknown>;
				const classification = messageKind(message, index, lastUserIndex);
				add(contributors, classification.kind, message, classification.required, tokenCounter);
			}
		}
		for (const [key, value] of Object.entries(record)) {
			if (key === "messages") continue;
			const lower = key.toLowerCase();
			if (lower === "system" || lower === "systemprompt" || lower === "system_prompt" || lower === "instructions" || lower.startsWith("system_")) add(contributors, "system_instructions", value, true, tokenCounter);
			else if (lower === "tools" || lower === "functions" || lower === "tool_choice" || lower === "toolchoices" || lower.includes("tool_schema") || lower.includes("tool_definition")) add(contributors, "tool_schemas", value, true, tokenCounter);
			else if (lower.includes("goal") || lower.includes("recovery") || lower.includes("constraint")) add(contributors, "goal_recovery", value, true, tokenCounter);
			else if (lower.includes("research") || lower.includes("evidence") || lower.includes("branch")) add(contributors, "research_cards", value, false, tokenCounter);
			else if (lower.includes("memory") || lower.includes("note")) add(contributors, "working_memory", value, false, tokenCounter);
			else add(contributors, "request_metadata", { [key]: value }, false, tokenCounter);
		}
	}

	const payloadTokens = payloadCounted.tokens;
	const accountedBytes = contributors.reduce((sum, item) => sum + item.bytes, 0);
	const payloadBytes = payloadCounted.bytes;
	const tokenization: ContextTokenization = contributors.length === 0
		? "unavailable"
		: payloadCounted.confidence === "verified" ? "exact" : "estimated";
	const confidence: ContextConfidence = tokenization === "exact" ? "verified" : tokenization === "estimated" ? "estimated" : "unavailable";
	const uncertaintyMargin = tokenization === "exact"
		? 0
		: tokenization === "estimated" ? Math.max(32, Math.ceil(payloadTokens * 0.12)) : 0;
	const reserved = Math.max(0, Math.floor(options.reservedTokens ?? 0));
	const reservationCount = Math.max(0, Math.floor(options.reservationCount ?? 0));
	const total = payloadTokens + windowInfo.overhead + uncertaintyMargin + reserved + windowInfo.completion;
	const inputAllowance = windowInfo.window === null
		? 0
		: Math.max(0, windowInfo.window - windowInfo.completion - windowInfo.overhead);
	const remaining = inputAllowance - payloadTokens - uncertaintyMargin - reserved;
	const observedTokens = finitePositive(options.observedUsage?.tokens);
	const observedWindow = finitePositive(options.observedUsage?.contextWindow);
	const usageRelation = observedTokens === null
		? "not_available" as const
		: observedWindow !== null && windowInfo.window !== null && observedWindow !== windowInfo.window
			? "mismatch" as const
			: observedTokens <= inputAllowance ? "within" as const : "over" as const;
	let outcome: ContextAdmissionOutcome = "admitted";
	let reasonClass = "within_budget";
	if (windowInfo.window === null) {
		outcome = "unavailable";
		reasonClass = "context_window_unknown";
	} else if (tokenization === "unavailable") {
		outcome = "unavailable";
		reasonClass = "payload_unavailable";
	} else if (usageRelation === "mismatch") {
		outcome = "rejected";
		reasonClass = "stale_usage_epoch";
	} else if (remaining < 0) {
		outcome = "rejected";
		reasonClass = "aggregate_budget_exceeded";
	}
	return {
		schema_version: CONTEXT_ACCOUNTING_SCHEMA,
		request_digest: requestDigest,
		epoch_digest: epochDigest,
		effective_window_tokens: windowInfo.window ?? 0,
		input_allowance_tokens: inputAllowance,
		completion_reserve_tokens: windowInfo.completion,
		overhead_tokens: windowInfo.overhead,
		uncertainty_margin_tokens: uncertaintyMargin,
		payload_bytes: payloadBytes,
		accounted_bytes: accountedBytes,
		unaccounted_bytes: Math.max(0, payloadBytes - accountedBytes),
		payload_tokens: payloadTokens,
		observed_context_tokens: observedTokens,
		observed_context_window: observedWindow,
		usage_relation: usageRelation,
		reserved_tokens: reserved,
		total_tokens: total,
		remaining_tokens: remaining,
		tokenization,
		confidence,
		contributors,
		reservation_count: reservationCount,
		outcome,
		reason_class: reasonClass,
		preservation_order: PRESERVATION_ORDER,
		truncated: options.truncated === true,
	};
}

type Reservation = { id: string; epoch: string; tokens: number };

export type ReservationResult =
	| { ok: true; id: string; epoch: string; tokens: number; idempotent: boolean }
	| { ok: false; reason: "invalid" | "inflation" | "budget_exceeded" | "unavailable" };

/**
 * Session-local, idempotent reservations. A repeated callback with the same
 * operation ID is a no-op; a changed amount is rejected. Reservations from a
 * prior serving epoch are discarded when reset() is called, so a 128K budget
 * can never authorize a later 32K request.
 */
export class ContextReservationLedger {
	private readonly reservations = new Map<string, Reservation>();

	reserve(id: string, epoch: string, tokens: number, allowance: number): ReservationResult {
		if (!id || !epoch || !Number.isFinite(tokens) || tokens < 0 || !Number.isFinite(allowance) || allowance < 0) return { ok: false, reason: "invalid" };
		const normalized = Math.ceil(tokens);
		const existing = this.reservations.get(id);
		if (existing) {
			if (existing.epoch !== epoch || existing.tokens !== normalized) return { ok: false, reason: "inflation" };
			return { ok: true, id, epoch, tokens: normalized, idempotent: true };
		}
		if (this.snapshot(epoch).reserved_tokens + normalized > Math.floor(allowance)) return { ok: false, reason: "budget_exceeded" };
		this.reservations.set(id, { id, epoch, tokens: normalized });
		return { ok: true, id, epoch, tokens: normalized, idempotent: false };
	}

	release(id: string): void { this.reservations.delete(id); }

	reset(epoch?: string): void {
		if (epoch === undefined) { this.reservations.clear(); return; }
		for (const [id, reservation] of this.reservations) if (reservation.epoch !== epoch) this.reservations.delete(id);
	}

	snapshot(epoch: string): { reserved_tokens: number; reservation_count: number } {
		let reserved = 0;
		let count = 0;
		for (const item of this.reservations.values()) if (item.epoch === epoch) { reserved += item.tokens; count += 1; }
		return { reserved_tokens: reserved, reservation_count: count };
	}
}

export function allocateContextAllowance(ledger: ContextReservationLedger, id: string, epoch: string, requestedTokens: number, allowance: number): ReservationResult {
	return ledger.reserve(id, epoch, requestedTokens, allowance);
}

/**
 * The provider-payload observer owns the ledger, while retrieval extensions
 * need a very small, process-local capability to reserve the output they are
 * about to add to the transcript. Keeping this boundary typed and digest-only
 * prevents producers from reaching into the admission extension or exporting
 * profile/payload contents. The API is intentionally absent when the feature
 * is disabled; callers can therefore remain byte-compatible with the legacy
 * path without reading CONTEXT_ADMISSION themselves.
 */
export const CONTEXT_RESERVATION_KEY = "__pi_context_reservation_v1" as const;
export const CONTEXT_RESERVATION_SCHEMA = "pi.context-reservation/v1" as const;

export type ContextReservationSnapshot = { reserved_tokens: number; reservation_count: number };
export type ContextReservationAPI = {
	schema_version: typeof CONTEXT_RESERVATION_SCHEMA;
	/** Whether the owning admission extension is currently enforcing reservations. */
	enabled: () => boolean;
	reserve: (id: string, requestedTokens: number) => ReservationResult;
	release: (id: string) => void;
	snapshot: () => ContextReservationSnapshot;
	epoch: () => string | null;
};

function reservationAPI(): ContextReservationAPI | undefined {
	const candidate = (globalThis as Record<string, unknown>)[CONTEXT_RESERVATION_KEY];
	if (!candidate || typeof candidate !== "object") return undefined;
	const api = candidate as Partial<ContextReservationAPI>;
	return typeof api.enabled === "function" && typeof api.reserve === "function" &&
		typeof api.release === "function" && typeof api.snapshot === "function" &&
		typeof api.epoch === "function" ? candidate as ContextReservationAPI : undefined;
}

/** Reserve a bounded retrieval/tool result, or return null when admission is off. */
export function reserveContextOutput(id: string, requestedTokens: number): ReservationResult | null {
	const api = reservationAPI();
	if (!api || !api.enabled()) return null;
	return api.reserve(id, requestedTokens);
}

/** Release a producer reservation after Pi has finalized its tool result. */
export function releaseContextOutput(id: string): void {
	reservationAPI()?.release(id);
}

/** Read the current safe aggregate reservation without exposing model metadata. */
export function contextReservationSnapshot(): ContextReservationSnapshot | null {
	const api = reservationAPI();
	return api && api.enabled() ? api.snapshot() : null;
}

export type PreservationSections = Partial<Record<(typeof PRESERVATION_ORDER)[number], string>>;

export function preserveContextSections(sections: PreservationSections, maxChars: number): { text: string; truncated: boolean; omitted: string[] } {
	const cap = Number.isFinite(maxChars) && maxChars > 0 ? Math.floor(maxChars) : 0;
	if (cap === 0) return { text: "", truncated: false, omitted: [] };
	const entries = PRESERVATION_ORDER.flatMap((key) => sections[key] ? [{ key, line: `${key}: ${sections[key]}` }] : []);
	if (entries.length === 0) return { text: "", truncated: false, omitted: [] };
	// Reserve a conservative marker before selecting content. The previous
	// backwards-shortening loop could reach a line whose computed room equalled
	// its current length and spin forever for narrow caps. This forward pass and
	// the bounded suffix trim below are both monotone and always terminate.
	const markerFloor = "...[truncated; retrieve omitted context: x]".length;
	const contentCap = Math.max(0, cap - markerFloor - 1);
	const lines: string[] = [];
	const omitted: string[] = [];
	let used = 0;
	for (const { key, line } of entries) {
		const remaining = Math.max(0, contentCap - used);
		if (line.length <= remaining) {
			lines.push(line);
			used += line.length + 1;
			continue;
		}
		// Required sections retain a bounded prefix when there is room; optional
		// commentary is omitted first. In either case the marker records the full
		// field name so callers can retrieve the private artifact.
		if (key !== "optional" && remaining > 0) {
			const clipped = line.slice(0, remaining);
			lines.push(clipped);
			used += clipped.length + 1;
		}
		omitted.push(key);
	}
	if (omitted.length === 0) return { text: lines.join("\n"), truncated: false, omitted };
	const markerFor = () => `...[truncated; retrieve omitted context: ${omitted.join(",")}]`;
	if (markerFor().length > cap) {
		// Preserve the hard cap even for diagnostic callers that request less
		// space than the complete marker needs. The omitted-field list remains in
		// the returned structured value for recovery; the text is only a bounded
		// projection and must never overflow its caller's budget.
		return { text: markerFor().slice(0, cap), truncated: true, omitted };
	}
	while (lines.length > 0 && lines.join("\n").length + 1 + markerFor().length > cap) {
		const body = lines.join("\n");
		const allowance = Math.max(0, cap - markerFor().length - 1);
		if (body.length > allowance) {
			const previous = lines.slice(0, -1).join("\n");
			const roomForLast = Math.max(0, allowance - (previous ? previous.length + 1 : 0));
			if (roomForLast > 0) {
				lines[lines.length - 1] = lines[lines.length - 1].slice(0, roomForLast);
				break;
			}
		}
		const removed = lines.pop()!;
		const key = removed.split(": ", 1)[0];
		if (!omitted.includes(key)) omitted.unshift(key);
	}
	const marker = markerFor();
	const body = lines.join("\n");
	const text = body && body.length + 1 + marker.length <= cap ? `${body}\n${marker}` : marker.slice(0, cap);
	return { text, truncated: true, omitted };
}

export { PRESERVATION_ORDER };
