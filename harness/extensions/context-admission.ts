import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { contextProfileFor, modelFingerprint, type ContextProfile } from "../lib/context-profile.ts";
import { buildContextAccounting, ContextReservationLedger } from "../lib/context-accounting.ts";
import { record } from "../lib/telemetry.ts";

type RuntimeContext = {
	model?: unknown;
	abort?: () => void;
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
	const outstanding = new Set<string>();

	pi.on("session_start", async () => {
		ledger.reset();
		outstanding.clear();
		delete (globalThis as Record<string, unknown>).__pi_context_accounting;
	});

	pi.on("before_provider_request", async (event, rawCtx) => {
		// Repository-only rollout: the aggregate contract is opt-in until the
		// pinned model-switch smoke supplies live evidence. Unset and any value
		// other than the explicit `on` preserve the existing admission behavior.
		if (process.env.CONTEXT_ADMISSION !== "on") return undefined;
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
		let accounting: ReturnType<typeof buildContextAccounting>;
		try {
			accounting = buildContextAccounting((event as { payload?: unknown }).payload, profile, {
				observedUsage: ctx.getContextUsage?.(),
			});
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
		const detail = safeRecord(accounting);
		detail.epoch = profile.epoch;
		if (accounting.outcome !== "admitted") {
			try { ctx.abort?.(); } catch { /* stale lifecycle */ }
			if (accounting.outcome === "rejected") record("context-admission", "rejected", detail);
			else record("context-admission", "unavailable", detail);
			try { ctx.ui?.notify?.(`Context admission stopped this request (${accounting.reason_class}; remaining=${accounting.remaining_tokens} tokens). Compact or retrieve a bounded page before retrying.`, "warning"); } catch { /* stale ui */ }
			return undefined;
		}
		outstanding.add(accounting.request_digest);
		record("context-admission", "admitted", detail);
		return undefined;
	});

	const release = () => {
		for (const id of outstanding) ledger.release(id);
		outstanding.clear();
	};
	pi.on("after_provider_response", async () => { release(); });
	pi.on("agent_settled", async () => { release(); });
	pi.on("session_shutdown", async () => { release(); ledger.reset(); });
}
