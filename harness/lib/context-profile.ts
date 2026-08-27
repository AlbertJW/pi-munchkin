import { createHash } from "node:crypto";
import { isIP } from "node:net";

export type ContextProfileSource = "metadata" | "serving_probe" | "calibration" | "observed" | "fallback";
export type ContextProfileConfidence = "unknown" | "fallback" | "observed" | "measured";

export type ContextProfile = {
	schema_version: 1;
	epoch: number;
	fingerprint: string;
	provider: string;
	model: string;
	declared_context_window: number | null;
	served_context_window: number | null;
	safe_input_tokens: number | null;
	output_reserve: number;
	overhead_tokens: number;
	confidence: ContextProfileConfidence;
	source: ContextProfileSource;
	calibrated_at: string | null;
	calibration: "not_requested" | "success" | "failed" | "skipped";
};

export type ModelContextMetadata = {
	provider?: unknown;
	id?: unknown;
	baseUrl?: unknown;
	contextWindow?: unknown;
};

const FALLBACK_WINDOW = 8_192;
const DEFAULT_OVERHEAD = 1_024;

function finitePositive(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : null;
}
function isoNow(): string { return new Date().toISOString(); }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }

export function modelFingerprint(model: ModelContextMetadata): string {
	return hash(JSON.stringify({ provider: String(model.provider ?? "unknown"), id: String(model.id ?? "unknown"), contextWindow: finitePositive(model.contextWindow) }));
}

export function outputReserveFor(window: number): number {
	const normalized = finitePositive(window);
	if (normalized === null) return 0;
	return Math.min(normalized, Math.min(8_192, Math.max(512, Math.ceil(normalized * 0.15))));
}

export function safeInputBudget(window: number | null, overhead = DEFAULT_OVERHEAD): number | null {
	const normalizedWindow = finitePositive(window);
	if (normalizedWindow === null) return null;
	const reserve = outputReserveFor(normalizedWindow);
	const normalizedOverhead = Number.isFinite(overhead) ? Math.max(0, Math.floor(overhead)) : 0;
	const raw = normalizedWindow - reserve - normalizedOverhead;
	return Math.min(normalizedWindow, Math.max(0, raw));
}

export function contextProfileFor(model: ModelContextMetadata, epoch = 0, options: {
	servedContextWindow?: number | null;
	overheadTokens?: number;
	confidence?: ContextProfileConfidence;
	source?: ContextProfileSource;
	calibration?: ContextProfile["calibration"];
	calibratedAt?: string | null;
} = {}): ContextProfile {
	const declared = finitePositive(model.contextWindow);
	const served = finitePositive(options.servedContextWindow);
	const window = served ?? declared ?? FALLBACK_WINDOW;
	const overhead = Number.isFinite(options.overheadTokens) ? Math.max(0, Math.floor(options.overheadTokens!)) : DEFAULT_OVERHEAD;
	const source = options.source ?? (served ? "serving_probe" : declared ? "metadata" : "fallback");
	return {
		schema_version: 1, epoch, fingerprint: modelFingerprint(model), provider: String(model.provider ?? "unknown"), model: String(model.id ?? "unknown"),
		declared_context_window: declared, served_context_window: served, safe_input_tokens: safeInputBudget(window, overhead),
		output_reserve: outputReserveFor(window), overhead_tokens: overhead,
		confidence: options.confidence ?? (served ? "measured" : declared ? "observed" : "fallback"), source,
		calibrated_at: options.calibratedAt ?? null, calibration: options.calibration ?? "not_requested",
	};
}

export function withServingWindow(profile: ContextProfile, servedContextWindow: number): ContextProfile {
	return contextProfileFor({ provider: profile.provider, id: profile.model, contextWindow: profile.declared_context_window }, profile.epoch, {
		servedContextWindow, overheadTokens: profile.overhead_tokens, confidence: "measured", source: "serving_probe", calibration: profile.calibration, calibratedAt: profile.calibrated_at,
	});
}

export function contextNeedsHandoff(profile: ContextProfile | undefined, usage: { tokens?: number | null; percent?: number | null } | undefined): boolean {
	if (!profile || profile.safe_input_tokens == null || !usage) return false;
	if (typeof usage.tokens === "number" && usage.tokens >= profile.safe_input_tokens) return true;
	// Pi's ContextUsage.percent is a percentage in the range 0–100 (not a
	// 0–1 ratio). Keep this aligned with context-surface/tool-activation, which
	// use the same native contract.
	return typeof usage.percent === "number" && usage.percent >= 85;
}

export function handoffReason(profile: ContextProfile, usage: { tokens?: number | null; percent?: number | null } | undefined): string {
	if (typeof usage?.tokens === "number" && profile.safe_input_tokens != null) return `context epoch ${profile.epoch} reached safe input budget (${usage.tokens}/${profile.safe_input_tokens} tokens)`;
	return `context epoch ${profile.epoch} reached dynamic compaction threshold (${Math.round(usage?.percent ?? 0)}%)`;
}

export type CalibrationResult = { ok: boolean; status: number | null; safe_input_tokens: number | null; profile: ContextProfile; failure: "not_requested" | "unsafe_host" | "network" | "rejected" | null };

function probeableHost(baseUrl: string): boolean {
	try {
		const hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, "");
		if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
		const ip = isIP(hostname);
		return ip === 4 ? hostname.startsWith("10.") || hostname.startsWith("192.168.") || hostname.startsWith("127.") || hostname.startsWith("169.254.") || /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) : ip === 6 && (hostname === "::1" || hostname.startsWith("fc") || hostname.startsWith("fd"));
	} catch { return false; }
}

/**
 * Send one isolated, synthetic max_tokens=1 request. It never contains user
 * content, tool definitions, or transcript messages. This is deliberately
 * opt-in: CONTEXT_DISCOVERY=on is required by the runtime extension.
 */
export async function calibrateContext(input: {
	model: ModelContextMetadata;
	profile: ContextProfile;
	fetchFn?: typeof fetch;
	timeoutMs?: number;
	enabled?: boolean;
}): Promise<CalibrationResult> {
	if (!input.enabled) return { ok: false, status: null, safe_input_tokens: input.profile.safe_input_tokens, profile: { ...input.profile, calibration: "skipped" }, failure: "not_requested" };
	if (typeof input.model.baseUrl !== "string" || !probeableHost(input.model.baseUrl)) return { ok: false, status: null, safe_input_tokens: input.profile.safe_input_tokens, profile: { ...input.profile, calibration: "skipped" }, failure: "unsafe_host" };
	const fetchFn = input.fetchFn ?? fetch;
	const base = input.model.baseUrl.replace(/\/+$/, "");
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), input.timeoutMs ?? 3_000);
	try {
		const response = await fetchFn(`${base}/chat/completions`, {
			method: "POST", signal: controller.signal,
			headers: { "content-type": "application/json", "x-pi-munchkin-calibration": "v1" },
			body: JSON.stringify({ model: String(input.model.id ?? ""), messages: [{ role: "user", content: "Return one token: OK" }], max_tokens: 1, stream: false }),
		});
		if (!response.ok) return { ok: false, status: response.status, safe_input_tokens: input.profile.safe_input_tokens, profile: { ...input.profile, calibration: "failed" }, failure: "rejected" };
		const profile = contextProfileFor(input.model, input.profile.epoch, { servedContextWindow: input.profile.served_context_window, overheadTokens: input.profile.overhead_tokens, confidence: "measured", source: "calibration", calibration: "success", calibratedAt: isoNow() });
		// This request validates the serving path only; it is not a capacity
		// benchmark. Keep the profile internally consistent with the declared or
		// observed serving window rather than inventing a smaller measured limit.
		return { ok: true, status: response.status, safe_input_tokens: profile.safe_input_tokens, profile, failure: null };
	} catch {
		return { ok: false, status: null, safe_input_tokens: input.profile.safe_input_tokens, profile: { ...input.profile, calibration: "failed" }, failure: "network" };
	} finally { clearTimeout(timer); }
}
