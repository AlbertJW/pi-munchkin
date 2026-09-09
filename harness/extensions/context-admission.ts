import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { contextProfileFor, modelFingerprint, type ContextProfile } from "../lib/context-profile.ts";
import { buildContextAccounting, CONTEXT_RESERVATION_KEY, CONTEXT_RESERVATION_SCHEMA, contextEpochKey, ContextReservationLedger } from "../lib/context-accounting.ts";
import { record } from "../lib/telemetry.ts";
import { createHash } from "node:crypto";
import { beginCompaction, finishCompaction } from "../lib/compaction-coordinator.ts";

type RuntimeContext = {
	model?: unknown;
	abort?: () => void;
	compact?: (options: { customInstructions: string; onComplete: () => void; onError: (error: Error) => void }) => void;
	getContextUsage?: () => { tokens?: number | null; contextWindow?: number | null; percent?: number | null } | undefined;
	ui?: { notify?: (message: string, level?: "info" | "warning" | "error") => void };
};

function profileFor(ctx: RuntimeContext): ContextProfile | null {
	const model = (ctx.model ?? {}) as { provider?: unknown; id?: unknown; baseUrl?: unknown; contextWindow?: unknown };
	const shared = globalThis as Record<string, unknown>;
	const published = shared.__pi_context_profile as ContextProfile | undefined;
	if (published && (model.provider == null || published.fingerprint === modelFingerprint(model))) return published;
	if (model.provider == null && model.id == null && model.contextWindow == null) return null;
	return contextProfileFor(model, published?.epoch ?? 0);
}

function safeRecord(accounting: ReturnType<typeof buildContextAccounting>): Record<string, unknown> {
	return {
		epoch: 0,
		effective_window: accounting.effective_window_tokens,
		input_allowance: accounting.input_allowance_tokens,
		completion_reserve: accounting.completion_reserve_tokens,
		overhead: accounting.overhead_tokens,
		uncertainty_margin: accounting.uncertainty_margin_tokens,
		payload_bytes: accounting.payload_bytes,
		accounted_bytes: accounting.accounted_bytes,
		unaccounted_bytes: accounting.unaccounted_bytes,
		payload_tokens: accounting.payload_tokens,
		observed_context_tokens: accounting.observed_context_tokens,
		observed_context_window: accounting.observed_context_window,
		usage_relation: accounting.usage_relation,
		reserved_tokens: accounting.reserved_tokens,
		remaining_tokens: accounting.remaining_tokens,
		confidence: accounting.confidence,
		tokenization: accounting.tokenization,
		contributors: accounting.contributors.length,
		reservation_count: accounting.reservation_count,
		request_digest: accounting.request_digest,
		epoch_digest: accounting.epoch_digest,
		outcome: accounting.outcome,
		reason_class: accounting.reason_class,
		truncated: accounting.truncated,
	};
}

/**
 * Admission is deliberately a before-provider-payload observer. Pi's hook
 * cannot cancel by returning a special object, and the runner treats thrown
 * hook errors as diagnostics. On an unsafe request we therefore abort the
 * current agent operation, preserve the exact payload for diagnosis, and
 * return it untouched. The provider never receives it because its signal is
 * aborted; user content is never silently rewritten.
 */
export default function installContextAdmission(pi: ExtensionAPI): void {
	const ledger = new ContextReservationLedger();
	let currentProfile: ContextProfile | null = null;
	let currentEpochDigest: string | null = null;
	let outputAllowance: number | null = null;
	let overflowObservation: { tokens: number; contextWindow: number } | null = null;
	let pendingRecovery: string | null = null;
	const attemptedRecovery = new Set<string>();
	const activeReservations = new Set<string>();
	const shared = globalThis as Record<string, unknown>;

	function syncEpoch(profile: ContextProfile | null): string | null {
		if (!profile) {
			outputAllowance = null;
			currentEpochDigest = null;
			ledger.reset();
			return null;
		}
		const epoch = contextEpochKey(profile);
		if (currentEpochDigest !== epoch) {
			pendingRecovery = null;
			outputAllowance = null;
			overflowObservation = null;
			// A provider/model/endpoint/window change invalidates every reservation
			// from the previous serving epoch. Never let a large-window reservation
			// authorize a later small-window request.
			ledger.reset(epoch);
			activeReservations.clear();
			currentEpochDigest = epoch;
		}
		return epoch;
	}

	function profileFromModel(model: unknown): ContextProfile | null {
		return profileFor({ model } as RuntimeContext);
	}

	const reservationAPI = {
		schema_version: CONTEXT_RESERVATION_SCHEMA,
		enabled: () => process.env.CONTEXT_ADMISSION === "on",
		reserve: (id: string, requestedTokens: number) => {
			const idHash = createHash("sha256").update(id).digest("hex");
			if (!currentProfile) {
				record("context-admission", "reservation", { id_hash: idHash, requested_tokens: Number.isFinite(requestedTokens) ? Math.max(0, Math.floor(requestedTokens)) : 0, outcome: "unavailable", reason_class: "context_profile_unavailable" });
				return { ok: false as const, reason: "unavailable" as const };
			}
			const epoch = syncEpoch(currentProfile);
			if (!epoch || currentProfile.safe_input_tokens == null) {
				record("context-admission", "reservation", { id_hash: idHash, requested_tokens: Number.isFinite(requestedTokens) ? Math.max(0, Math.floor(requestedTokens)) : 0, outcome: "unavailable", reason_class: "context_budget_unavailable" });
				return { ok: false as const, reason: "unavailable" as const };
			}
			// No observation is not an empty context. A fresh payload accounting
			// boundary must establish capacity before tools can reserve output.
			if (outputAllowance === null) return { ok: false as const, reason: "unavailable" as const };
			const result = ledger.reserve(id, epoch, requestedTokens, outputAllowance);
			if (result.ok) {
				activeReservations.add(id);
				record("context-admission", "reservation", { id_hash: idHash, requested_tokens: result.tokens, outcome: "reserved", reason_class: result.idempotent ? "idempotent" : "ok" });
			} else {
				record("context-admission", "reservation", { id_hash: idHash, requested_tokens: Number.isFinite(requestedTokens) ? Math.max(0, Math.floor(requestedTokens)) : 0, outcome: "rejected", reason_class: result.reason });
			}
			return result;
		},
		release: (id: string) => {
			if (!activeReservations.has(id)) return;
			activeReservations.delete(id);
			ledger.release(id);
		},
		snapshot: () => currentEpochDigest ? ledger.snapshot(currentEpochDigest) : { reserved_tokens: 0, reservation_count: 0 },
		epoch: () => currentEpochDigest,
	};
	shared[CONTEXT_RESERVATION_KEY] = reservationAPI;

	pi.on("session_start", async (_event, rawCtx) => {
		pendingRecovery = null;
		attemptedRecovery.clear();
		ledger.reset();
		activeReservations.clear();
		currentProfile = profileFromModel((rawCtx as RuntimeContext | undefined)?.model);
		currentEpochDigest = null;
		syncEpoch(currentProfile);
		delete shared.__pi_context_accounting;
	});

	pi.on("model_select", async (event) => {
		currentProfile = profileFromModel((event as { model?: unknown }).model);
		syncEpoch(currentProfile);
	});

	pi.on("before_provider_request", async (event, rawCtx) => {
		// Repository-only rollout: the aggregate contract is opt-in until the
		// pinned model-switch smoke supplies live evidence. Unset and any value
		// other than the explicit `on` preserve the existing admission behavior.
		if (process.env.CONTEXT_ADMISSION !== "on") return undefined;
		pendingRecovery = null;
		const ctx = rawCtx as RuntimeContext;
		const profile = profileFor(ctx);
		if (!profile) {
			try { ctx.abort?.(); } catch { /* stale lifecycle */ }
			record("context-admission", "rejected", {
				epoch: 0, effective_window: 0, input_allowance: 0, completion_reserve: 0,
				overhead: 0, uncertainty_margin: 0, payload_tokens: 0, reserved_tokens: 0,
				payload_bytes: 0, accounted_bytes: 0, unaccounted_bytes: 0,
				observed_context_tokens: null, observed_context_window: null, usage_relation: "not_available",
				remaining_tokens: 0, confidence: "unavailable", tokenization: "unavailable",
				contributors: 0, reservation_count: 0, request_digest: "unknown", epoch_digest: "unknown",
				outcome: "unavailable", reason_class: "context_profile_unavailable", truncated: false,
			});
			try { ctx.ui?.notify?.("Context admission stopped this request: serving context window is unknown. Select a model with a declared context window or inspect the runtime profile.", "warning"); } catch { /* stale ui */ }
			return undefined;
		}
		currentProfile = profile;
		const epoch = syncEpoch(profile);
		let accounting: ReturnType<typeof buildContextAccounting>;
		try {
			const reservations = epoch ? ledger.snapshot(epoch) : { reserved_tokens: 0, reservation_count: 0 };
			const observed = ctx.getContextUsage?.();
			// Pi intentionally returns null after compaction until a new provider
			// observation exists. Absence must not erase a known overflow.
			const usableObservation = typeof observed?.tokens === "number" && Number.isFinite(observed.tokens) && observed.tokens >= 0;
			accounting = buildContextAccounting((event as { payload?: unknown }).payload, profile, {
				observedUsage: usableObservation ? observed : overflowObservation ?? observed,
				reservedTokens: reservations.reserved_tokens,
				reservationCount: reservations.reservation_count,
			});
			if (accounting.usage_relation === "over") overflowObservation = { tokens: accounting.observed_context_tokens!, contextWindow: accounting.observed_context_window ?? accounting.effective_window_tokens };
			else if (accounting.usage_relation === "within" && usableObservation) overflowObservation = null;
		} catch {
			// Malformed/cyclic provider payloads must not escape through the runner's
			// swallowed-hook-error path. Abort and emit only a bounded class.
			try { ctx.abort?.(); } catch { /* stale lifecycle */ }
			record("context-admission", "unavailable", {
				epoch: profile.epoch, effective_window: 0, input_allowance: 0, completion_reserve: 0,
				overhead: 0, uncertainty_margin: 0, payload_tokens: 0, reserved_tokens: 0,
				payload_bytes: 0, accounted_bytes: 0, unaccounted_bytes: 0,
				observed_context_tokens: null, observed_context_window: null, usage_relation: "not_available",
				remaining_tokens: 0, confidence: "unavailable", tokenization: "unavailable",
				contributors: 0, reservation_count: 0, request_digest: "unknown", epoch_digest: "unknown",
				outcome: "unavailable", reason_class: "payload_malformed", truncated: false,
			});
			return undefined;
		}
		const shared = globalThis as Record<string, unknown>;
		shared.__pi_context_accounting = structuredClone(accounting);
		outputAllowance = accounting.outcome === "admitted"
			? Math.max(0, accounting.remaining_tokens + accounting.reserved_tokens) : 0;
		const detail = safeRecord(accounting);
		detail.epoch = profile.epoch;
		if (accounting.outcome !== "admitted") {
			if (accounting.reason_class === "aggregate_budget_exceeded" || accounting.reason_class === "observed_budget_exceeded") {
				pendingRecovery = `${accounting.epoch_digest}:${accounting.request_digest}`;
			}
			try { ctx.abort?.(); } catch { /* stale lifecycle */ }
			if (accounting.outcome === "rejected") record("context-admission", "rejected", detail);
			else record("context-admission", "unavailable", detail);
			try { ctx.ui?.notify?.(`Context admission stopped this request (${accounting.reason_class}; remaining=${accounting.remaining_tokens} tokens). Compact or retrieve a bounded page before retrying.`, "warning"); } catch { /* stale ui */ }
			return undefined;
		}
		record("context-admission", "admitted", detail);
		return undefined;
	});

	const releaseTool = (event: unknown) => {
		const id = (event as { toolCallId?: unknown } | undefined)?.toolCallId;
		if (typeof id === "string") reservationAPI.release(id);
	};
	// Pi emits tool_execution_end before the tool-result message is appended;
	// tool_result is the equivalent finalization boundary in the test double and
	// for blocked/throwing tools. Both are idempotent through activeReservations.
	pi.on("tool_execution_end", async (event) => { releaseTool(event); });
	pi.on("tool_result", async (event) => { releaseTool(event); });
	pi.on("agent_settled", async (_event, rawCtx) => {
		ledger.reset(); activeReservations.clear();
		const key = pendingRecovery;
		const ctx = rawCtx as RuntimeContext;
		if (!key || attemptedRecovery.has(key) || !key.startsWith(`${currentEpochDigest}:`) || process.env.CONTEXT_ADMISSION !== "on") return;
		// Bound the session-local retry set as well as each individual request.
		if (!ctx.compact || attemptedRecovery.size >= 32) return;
		const lease = beginCompaction("context-admission");
		if (!lease) return; // The existing owner keeps authority; no competing call.
		pendingRecovery = null;
		attemptedRecovery.add(key);
		const epoch = currentEpochDigest;
		const finish = (ok: boolean) => {
			if (!finishCompaction(lease) || epoch !== currentEpochDigest) return;
			outputAllowance = null;
			try { ctx.ui?.notify?.(ok
				? "Context recovery compacted the session. Retry only after a fresh context measurement establishes room; no provider request was automatically repeated."
				: "Context recovery failed. This request remains stopped. Reduce the input, select a larger serving window, or compact manually before retrying.", "warning"); } catch { /* stale UI */ }
		};
		try {
			ctx.compact({ customInstructions: "Preserve the active task, goal and plan identities, evidence references, constraints and next action. Reduce optional context. Do not execute external work.", onComplete: () => finish(true), onError: () => finish(false) });
		} catch { finish(false); }
	});
	pi.on("session_shutdown", async () => {
		ledger.reset();
		activeReservations.clear();
		currentProfile = null;
		currentEpochDigest = null;
		if (shared[CONTEXT_RESERVATION_KEY] === reservationAPI) delete shared[CONTEXT_RESERVATION_KEY];
	});
}
