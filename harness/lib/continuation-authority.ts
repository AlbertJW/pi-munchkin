import { createHash } from "node:crypto";
import type { EventBus } from "@earendil-works/pi-coding-agent";

/**
 * A continuation is not an ordinary advisory steer.  It can start another
 * provider turn, so it carries enough identity for the dispatcher to reject a
 * late request after a goal, plan, or session has changed.
 *
 * The envelope stays process-local: `authorize` is deliberately a callback,
 * rather than serialised policy, because the persisted authority belongs to the
 * owning extension (goal ledger, plan graph, or compaction coordinator).
 */
export const CONTINUATION_REQUEST_CHANNEL = "pi-munchkin/continuation-request/v1";
export const CONTINUATION_RECEIPT_TYPE = "pi-munchkin:continuation-receipt/v1";
export const CONTINUATION_MAX_CHARS = 4_000;

export type ContinuationReason = "goal" | "research_synthesis" | "citation_correction" | "context_handoff" | "compaction_resume" | "drift_review";
export type ContinuationScope = "goal" | "plan" | "session";

export interface ContinuationRequestV1 {
	v: 1;
	/** SHA-256 of Pi's session id; raw session IDs never enter telemetry. */
	session_id_hash: string;
	/** The goal id / plan run id hash, or a stable session scope hash. */
	owner_id_hash: string;
	/** A persisted revision or cancellation generation owned by the producer. */
	generation: string;
	scope: ContinuationScope;
	reason: ContinuationReason;
	priority: number;
	/** Stable across reload and no-op updates; consumed receipts use this key. */
	idempotency_key: string;
	/** Bounded model-visible text, never an unbounded callback payload. */
	message: string;
	/** Monotonic wall-clock expiry prevents old child/callback work reviving a session. */
	expires_at_ms: number;
}

export interface ContinuationEnvelope {
	request: ContinuationRequestV1;
	authorize: () => boolean | Promise<boolean>;
}

export interface ContinuationReceiptV1 {
	v: 1;
	idempotency_key: string;
	session_id_hash: string;
	delivered_at_ms: number;
}

const HASH = /^[a-f0-9]{64}$/;
const REASONS = new Set<ContinuationReason>(["goal", "research_synthesis", "citation_correction", "context_handoff", "compaction_resume", "drift_review"]);
const SCOPES = new Set<ContinuationScope>(["goal", "plan", "session"]);
const ACTIVE_DISPATCHER_KEY = "__pi_continuation_dispatcher_active_v1";

export function hashContinuationIdentity(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export function continuationDispatcherActive(bus: EventBus): boolean {
	// Extensions are evaluated by Pi's isolated loader. A module-global WeakSet
	// is not reliable across those loader realms, while the EventBus object is
	// the one stable identity all extensions actually share.
	return Reflect.get(bus, ACTIVE_DISPATCHER_KEY) === true;
}

export function setContinuationDispatcherActive(bus: EventBus, active: boolean): void {
	Reflect.set(bus, ACTIVE_DISPATCHER_KEY, active);
}

export function isContinuationRequest(value: unknown): value is ContinuationRequestV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const request = value as Record<string, unknown>;
	const keys = ["v", "session_id_hash", "owner_id_hash", "generation", "scope", "reason", "priority", "idempotency_key", "message", "expires_at_ms"];
	return Object.keys(request).length === keys.length && keys.every((key) => key in request) &&
		request.v === 1 && HASH.test(String(request.session_id_hash)) && HASH.test(String(request.owner_id_hash)) &&
		typeof request.generation === "string" && request.generation.length > 0 && request.generation.length <= 256 &&
		SCOPES.has(request.scope as ContinuationScope) && REASONS.has(request.reason as ContinuationReason) &&
		Number.isSafeInteger(request.priority) && Number(request.priority) >= 0 && Number(request.priority) <= 1_000 &&
		typeof request.idempotency_key === "string" && request.idempotency_key.length > 0 && request.idempotency_key.length <= 512 &&
		typeof request.message === "string" && request.message.length > 0 && request.message.length <= CONTINUATION_MAX_CHARS &&
		Number.isSafeInteger(request.expires_at_ms) && Number(request.expires_at_ms) > 0;
}

export function isContinuationReceipt(value: unknown): value is ContinuationReceiptV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const receipt = value as Record<string, unknown>;
	const keys = ["v", "idempotency_key", "session_id_hash", "delivered_at_ms"];
	return Object.keys(receipt).length === keys.length && keys.every((key) => key in receipt) &&
		receipt.v === 1 && typeof receipt.idempotency_key === "string" && receipt.idempotency_key.length > 0 &&
		HASH.test(String(receipt.session_id_hash)) && Number.isSafeInteger(receipt.delivered_at_ms) && Number(receipt.delivered_at_ms) > 0;
}

export function emitContinuationRequest(bus: EventBus, envelope: ContinuationEnvelope): boolean {
	if (!isContinuationRequest(envelope.request) || typeof envelope.authorize !== "function") return false;
	bus.emit(CONTINUATION_REQUEST_CHANNEL, envelope);
	return true;
}

export function onContinuationRequest(bus: EventBus, handler: (envelope: ContinuationEnvelope) => void): () => void {
	return bus.on(CONTINUATION_REQUEST_CHANNEL, (value) => {
		if (!value || typeof value !== "object") return;
		const envelope = value as Partial<ContinuationEnvelope>;
		if (!isContinuationRequest(envelope.request) || typeof envelope.authorize !== "function") return;
		handler(envelope as ContinuationEnvelope);
	});
}

/**
 * Install the one authority dispatcher for this EventBus. The subscription is
 * stored on the bus itself so a Pi extension reload replaces its previous
 * generation without disturbing another live AgentSession's distinct bus.
 */
const AUTHORITY_DISPOSER_KEY = "__pi_continuation_authority_disposer_v1";

export function replaceContinuationAuthority(bus: EventBus, handler: (envelope: ContinuationEnvelope) => void): () => void {
	const previous = Reflect.get(bus, AUTHORITY_DISPOSER_KEY);
	if (typeof previous === "function") {
		try { previous(); } catch { /* a stale Pi generation is already inert */ }
	}
	const dispose = onContinuationRequest(bus, handler);
	Reflect.set(bus, AUTHORITY_DISPOSER_KEY, dispose);
	return () => {
		if (Reflect.get(bus, AUTHORITY_DISPOSER_KEY) !== dispose) return;
		dispose();
		Reflect.deleteProperty(bus, AUTHORITY_DISPOSER_KEY);
	};
}

export function continuationReceipts(entries: readonly unknown[], sessionIdHash: string): Set<string> {
	const delivered = new Set<string>();
	for (const entry of entries) {
		if (!entry || typeof entry !== "object") continue;
		const item = entry as { type?: unknown; customType?: unknown; data?: unknown };
		if (item.type !== "custom" || item.customType !== CONTINUATION_RECEIPT_TYPE || !isContinuationReceipt(item.data)) continue;
		if (item.data.session_id_hash === sessionIdHash) delivered.add(item.data.idempotency_key);
	}
	return delivered;
}
