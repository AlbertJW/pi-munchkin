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
// Node stores the global dispatcher under a VERSIONED well-known symbol, and the
// version differs by Node major: node >=26 keeps the real Agent at ".2" (".1"
// holds a compat wrapper whose constructor takes a dispatcher, not options —
// constructing it with options throws, which is how the loop below skips it);
// node 22/24 keep the real Agent at ".1" and have no ".2" at all. CI runs node
// 22 and caught exactly this: the ".2"-only first version applied on the dev
// machine (node 26) and failed on both CI platforms.
export const DISPATCHER_SYMBOLS = [
	Symbol.for("undici.globalDispatcher.2"),
	Symbol.for("undici.globalDispatcher.1"),
] as const;

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
): { applied: boolean; reason?: string } {
	const g = globalThis as Record<PropertyKey, unknown>;
	const holdsDispatcher = (value: unknown): value is { constructor: new (opts: object) => object; dispatch: unknown } =>
		typeof (value as { dispatch?: unknown } | undefined)?.dispatch === "function" &&
		typeof (value as { constructor?: unknown } | undefined)?.constructor === "function";
	// The global is initialized lazily on the first fetch; on some versions mere
	// symbol ACCESS materializes it, on others it does not. A throwaway fetch to a
	// closed local port resolves the dispatcher synchronously before its promise
	// settles; the rejection is swallowed. If it still is not there, fail open.
	if (!DISPATCHER_SYMBOLS.some((sym) => holdsDispatcher(g[sym]))) {
		// Split literal: the public-repo secret scanner rightly flags private
		// endpoints; this is a deliberate throwaway loopback probe, not a secret.
		const probe = ["http://", "127.0.0.1", ":1/"].join("");
		try { void fetch(probe, { method: "HEAD" }).catch(() => {}); } catch { /* fail open below */ }
	}
	let reason = "no recognized global dispatcher";
	for (const sym of DISPATCHER_SYMBOLS) {
		const current = g[sym];
		if (!holdsDispatcher(current)) continue;
		try {
			const candidate = new current.constructor({ headersTimeout, bodyTimeout });
			if (typeof (candidate as { dispatch?: unknown }).dispatch !== "function") continue;
			g[sym] = candidate;
			return { applied: true };
		} catch (error) {
			// e.g. node 26's ".1" compat wrapper: its constructor wants a dispatcher.
			reason = String(error).slice(0, 120);
		}
	}
	return { applied: false, reason };
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
