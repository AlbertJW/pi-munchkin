// provider-patience (LIVE default-on 2026-08-22; Albert-requested). Raises the
// process-global fetch HEADER timeout so slow local models are not aborted
// mid-prefill.
//
// The measured failure (telemetry, 2026-08-22): 16 of 600 provider requests died
// at ~301s with status=None — no HTTP status ever arrived. The ceiling is Node's
// bundled undici `headersTimeout` (300s): pi's provider SDKs call the global
// `fetch`, a big model streams NOTHING until prefill completes, and a cold-loaded
// 35B with a long prompt can take >300s to its first byte. The successful-request
// telemetry brackets it exactly (time-to-headers max 299,464ms survived; the
// aborts cluster at 300-301s). llama-swap is NOT the limit — its log shows a
// 3m30s request returning 200.
//
// Neither pi nor its SDKs expose a knob (grepped pi-ai/pi-coding-agent: no
// timeout env, no dispatcher option), but none is needed: Node keeps the global
// dispatcher at Symbol.for("undici.globalDispatcher.2") (the v1 symbol holds a
// compat wrapper whose constructor takes a dispatcher, not options — do not use
// it), and `fetch` consults it per request. Swapping in an Agent built from the
// SAME class with longer timeouts governs every subsequent fetch in the process.
// Both polarities measured on node v26.5.0: a 300ms cap kills a 1200ms-header
// response (UND_ERR_HEADERS_TIMEOUT); a raised cap lets it through.
//
// bodyTimeout is the gap BETWEEN chunks, not total duration — raised too, so a
// long silent generation stretch cannot abort an already-streaming response.
// Fail-open: if the symbol shape ever changes, the default behavior stands and
// the telemetry row says so — a session must never be broken by its own patience.
// PROVIDER_PATIENCE=off is the kill switch.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";

const ENABLED = process.env.PROVIDER_PATIENCE !== "off";
const DISPATCHER = Symbol.for("undici.globalDispatcher.2");

function boundedIntEnv(name: string, fallback: number): number {
	const n = Number.parseInt(process.env[name] || "", 10);
	return Number.isFinite(n) && n >= 0 ? n : fallback; // 0 = undici "no limit"
}
// Default matches PI_TIMEOUT (1800s): the session wall clock should be the only
// thing that gives up on a local model, never the HTTP client underneath it.
const HEADERS_MS = boundedIntEnv("PI_PROVIDER_HEADERS_TIMEOUT_MS", 1_800_000);
const BODY_MS = boundedIntEnv("PI_PROVIDER_BODY_TIMEOUT_MS", 1_800_000);

export function applyProviderPatience(
	headersTimeout: number,
	bodyTimeout: number,
): { applied: boolean; previous: unknown; reason?: string } {
	const g = globalThis as Record<PropertyKey, unknown>;
	const current = g[DISPATCHER] as { constructor?: new (opts: object) => object } | undefined;
	const AgentClass = current?.constructor;
	if (typeof AgentClass !== "function" || typeof (current as { dispatch?: unknown })?.dispatch !== "function") {
		return { applied: false, previous: current, reason: "global dispatcher shape unrecognized" };
	}
	try {
		g[DISPATCHER] = new AgentClass({ headersTimeout, bodyTimeout });
		return { applied: true, previous: current };
	} catch (error) {
		return { applied: false, previous: current, reason: String(error).slice(0, 120) };
	}
}

export default function (pi: ExtensionAPI): void {
	if (!ENABLED) return;
	// At registration, before any provider request exists to race with.
	const result = applyProviderPatience(HEADERS_MS, BODY_MS);
	pi.on("session_start", async () => {
		// Field names avoid telemetry's FORBIDDEN_DETAIL_FIELD (/header/i): the live
		// smoke caught `headers_timeout_ms` being schema-rejected (invalid_detail) --
		// the whole applied row became a reject stub. first_byte is the accurate name
		// anyway: undici's headersTimeout caps time to FIRST BYTE.
		record("provider-patience", "applied", {
			applied: result.applied, first_byte_timeout_ms: HEADERS_MS, body_timeout_ms: BODY_MS,
		});
	});
}
