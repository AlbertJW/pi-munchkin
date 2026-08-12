import { isIP } from "node:net";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { agentDir } from "../lib/agent-dir.ts";
import { isPrivateAddress } from "../lib/public-url.ts";
import { discoverEntryPoints, hashSurface, walkRelativeImports } from "../lib/surface-walk.ts";
import {
	readRuntimePosture, renderDoctor, sandboxPosture, summarizeToolSurface,
} from "../lib/runtime-doctor.ts";
import { beginSession, record } from "../lib/telemetry.ts";

type ProviderTiming = {
	seq: number;
	started: number;
	headersAt: number | null;
	firstTokenAt: number | null;
	streamAt: number | null;
	status: number | null;
};

function elapsed(start: number, end: number | null): number | null {
	return end == null ? null : Math.max(0, Math.round(end - start));
}

export function isFirstTokenEvent(event: { type?: unknown; delta?: unknown }): boolean {
	return ["text_delta", "thinking_delta", "toolcall_delta"].includes(String(event.type)) &&
		typeof event.delta === "string" && event.delta.length > 0;
}

// ---------- serving-truth probe ----------
//
// The registry's contextWindow is a PROMISE; the server's n_ctx is a FACT, and
// when they disagree the failure is silent: ling3 shipped with registry 8192
// against a served 32768, pi computed a ~3-token output budget, and every
// session died at stopReason=length with zero diagnostics. This probe reads the
// fact once per model per session and compares. Observational only: one
// telemetry row, one /munchkin-doctor line, one notify on mismatch — no steer,
// no block, no registry mutation.

export type ServingVerdict = "ok" | "registry_over_served" | "registry_under_served";

// Same convention pi-health.sh enforces statically against the launchers
// (served − 8192 <= registry <= served): any over-provision is a silent
// truncation risk; under-provision only matters past the deliberate headroom
// (61440-vs-65536 is the sanctioned ~6% margin and must stay quiet).
export function computeServingVerdict(served: number, registry: number): ServingVerdict {
	if (registry > served) return "registry_over_served";
	if (registry < served - 8192) return "registry_under_served";
	return "ok";
}

// HOST guard, not an address guard. isPrivateAddress takes an IP and is
// deliberately fail-closed for anything unparsable — correct for its blocking
// caller, inverted here: it would call "api.anthropic.com" private and probe
// it. Named hosts are never probed; only loopback names and private IP
// literals qualify.
function isProbeableHost(hostname: string): boolean {
	const host = hostname.toLowerCase();
	if (host === "localhost" || host.endsWith(".localhost")) return true;
	const literal = host.replace(/^\[|\]$/g, "");
	return isIP(literal) !== 0 && isPrivateAddress(literal);
}

/** GET the server's /props and return its served n_ctx, or null on ANY failure.
 * llama.cpp serves /props at the root; llama-swap routes it per model under
 * /upstream/<id>/props (its own root /props is an unrouted 404 with no side
 * effect). The /upstream fallback is only safe when the model is LOADED —
 * hitting it for an unloaded model triggers a swap on the single-slot box —
 * which is why the caller runs after a completed provider response. */
export async function probeServingTruth(
	input: { baseUrl: string; modelId: string },
	options: { fetchFn?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ served_n_ctx: number } | null> {
	const fetchFn = options.fetchFn ?? fetch;
	let origin: string;
	try {
		const url = new URL(input.baseUrl);
		if (!isProbeableHost(url.hostname)) return null;
		origin = url.origin;
	} catch {
		return null;
	}
	const signal = AbortSignal.timeout(options.timeoutMs ?? 3000);
	const readNCtx = async (path: string): Promise<number | null> => {
		try {
			const response = await fetchFn(`${origin}${path}`, { signal });
			if (!response.ok) return null;
			const body = (await response.json()) as { default_generation_settings?: { n_ctx?: unknown } };
			const n = body?.default_generation_settings?.n_ctx;
			return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : null;
		} catch {
			return null;
		}
	};
	const direct = await readNCtx("/props");
	if (direct !== null) return { served_n_ctx: direct };
	const routed = await readNCtx(`/upstream/${encodeURIComponent(input.modelId)}/props`);
	return routed !== null ? { served_n_ctx: routed } : null;
}

export default function (pi: ExtensionAPI): void {
	let nextSeq = 0;
	let current: ProviderTiming | null = null;
	let completed: ProviderTiming[] = [];
	let servingTruth: { served_n_ctx: number; registry_ctx: number; verdict: ServingVerdict } | null = null;
	// Latched by MODEL ID, not once-per-session: a mid-session /model switch
	// re-probes for the new model instead of reporting the old model's numbers.
	let probedModelId: string | null = null;
	let pendingProbe: { modelId: string; baseUrl: string; registryCtx: number; notify: (message: string) => void } | null = null;

	function closeCurrent(): void {
		if (!current) return;
		completed.push(current);
		current = null;
	}

	function reset(): void {
		nextSeq = 0;
		current = null;
		completed = [];
		servingTruth = null;
		probedModelId = null;
		pendingProbe = null;
	}

	pi.on("session_start", async () => {
		reset();
		// Mint session identity FIRST, before any row can be emitted for this
		// session: `si` must identify a session, not a process (one pi process
		// hosts /new, /fork and resumed sessions).
		beginSession();
		// Surface-bound telemetry for INTERACTIVE sessions (2026-08-11 second
		// inspection): only gate rounds exported HARNESS_SURFACE_SHA256, so live
		// rows could never be attributed to a surface and shadow evidence could
		// never accumulate. Compute the loaded hash once per process; gate rounds
		// keep their pre-set (pre-session, tamper-ordered) value untouched.
		if (!process.env.HARNESS_SURFACE_SHA256) {
			try {
				const dir = agentDir();
				const { entries, npmIdentities } = await discoverEntryPoints(dir);
				const files = await walkRelativeImports(entries);
				process.env.HARNESS_SURFACE_SHA256 = await hashSurface(dir, files, npmIdentities);
			} catch { /* unhashable surface: rows stay unattributed and the report says so */ }
		}
	});
	pi.on("session_shutdown", async () => { reset(); });

	pi.on("before_provider_request", async () => {
		closeCurrent();
		current = {
			seq: ++nextSeq, started: performance.now(), headersAt: null,
			firstTokenAt: null, streamAt: null, status: null,
		};
	});

	pi.on("after_provider_response", async (event, ctx) => {
		if (current) {
			current.headersAt ??= performance.now();
			current.status = event.status;
		}
		// Serving-truth, step 1: after a SUCCESSFUL response, remember which model
		// answered. Do NOT fetch here — this event fires BEFORE the response
		// stream is consumed, and on the single-slot llama-swap router a /props
		// request queues behind the in-flight completion until the probe's own
		// timeout kills it (measured live: standalone probes succeeded while
		// every in-session probe silently timed out). The fetch itself waits for
		// agent_settled, when the stream is done and the model sits loaded+idle.
		const model = ctx?.model as { id?: string; baseUrl?: string; contextWindow?: number } | undefined;
		if (typeof event.status !== "number" || event.status >= 400) return;
		if (!model?.id || !model.baseUrl || typeof model.contextWindow !== "number") return;
		if (probedModelId === model.id) return;
		pendingProbe = {
			modelId: model.id, baseUrl: model.baseUrl, registryCtx: model.contextWindow,
			notify: (message) => { try { ctx?.ui?.notify?.(message, "warning"); } catch { /* stale ctx */ } },
		};
	});

	pi.on("message_update", async (event) => {
		if (!current) return;
		if (current.firstTokenAt == null && isFirstTokenEvent(event.assistantMessageEvent)) {
			current.firstTokenAt = performance.now();
		}
		if (event.assistantMessageEvent.type === "done" || event.assistantMessageEvent.type === "error") {
			current.streamAt ??= performance.now();
		}
	});

	pi.on("message_end", async (event) => {
		if (current && event.message.role === "assistant") current.streamAt ??= performance.now();
	});

	pi.on("agent_settled", async () => {
		// Serving-truth, step 2: the run settled, the stream is finished, the
		// model is loaded and idle — the only moment a single-slot router answers
		// /props promptly. AWAITED, not fire-and-forget: `pi -p` exits right after
		// settlement, and a detached probe lost that race every time (measured
		// live — zero rows despite a working probe). The fetch is bounded at 3s
		// and takes milliseconds against an idle local server; once per model.
		if (pendingProbe && probedModelId !== pendingProbe.modelId) {
			const probeTarget = pendingProbe;
			pendingProbe = null;
			probedModelId = probeTarget.modelId;
			await probeServingTruth({ baseUrl: probeTarget.baseUrl, modelId: probeTarget.modelId }).then((probe) => {
				if (!probe) return; // non-probeable host or failed probe: silent
				const verdict = computeServingVerdict(probe.served_n_ctx, probeTarget.registryCtx);
				servingTruth = { served_n_ctx: probe.served_n_ctx, registry_ctx: probeTarget.registryCtx, verdict };
				record("runtime", "serving-truth", {
					served_n_ctx: probe.served_n_ctx, registry_ctx: probeTarget.registryCtx, verdict,
				});
				if (verdict !== "ok") {
					probeTarget.notify(
						`serving-truth: registry contextWindow ${probeTarget.registryCtx} vs served n_ctx ${probe.served_n_ctx} (${verdict}). ` +
						(verdict === "registry_over_served"
							? "The registry promises more context than the server serves — silent truncation risk."
							: "The registry is far below what the server serves — sessions may die on a starved output budget (the ling3 failure)."));
				}
			});
		}
		closeCurrent();
		const settledAt = performance.now();
		for (const timing of completed) {
			record("runtime", "provider-timing", {
				request_seq: timing.seq,
				request_to_headers_ms: elapsed(timing.started, timing.headersAt),
				first_token_ms: elapsed(timing.started, timing.firstTokenAt),
				stream_completion_ms: elapsed(timing.started, timing.streamAt),
				settlement_ms: elapsed(timing.started, settledAt),
				status: timing.status,
			});
		}
		completed = [];
	});

	pi.registerCommand("munchkin-doctor", {
		description: "Report redacted Pi, model, tool-provenance, retry, timeout, and sandbox posture.",
		handler: async (_args, ctx) => {
			const activation = (globalThis as Record<string, unknown>).__pi_tool_activation_state as
				{ mode?: unknown; phase?: unknown; preserved_explicit?: unknown; reason?: unknown; deferred?: unknown; attempted?: unknown } | undefined;
			const tools = summarizeToolSurface(
				pi.getAllTools(), pi.getActiveTools(), activation?.preserved_explicit === true,
			);
			const posture = await readRuntimePosture(ctx.cwd);
			const model = ctx.model;
			let providerName = model?.provider ?? "unknown";
			try {
				if (model) providerName = ctx.modelRegistry.getProviderDisplayName(model.provider);
			} catch { /* provider id remains the safe fallback */ }
			ctx.ui.notify(renderDoctor({
				piVersion: VERSION,
				surfaceHash: process.env.HARNESS_SURFACE_SHA256,
				model: model as Parameters<typeof renderDoctor>[0]["model"],
				providerName,
				tools,
				posture,
				sandbox: sandboxPosture(),
				servingTruth,
				preservationReason: typeof activation?.reason === "string" ? activation.reason : undefined,
				activation: {
					mode: typeof activation?.mode === "string" ? activation.mode : "unknown",
					phase: typeof activation?.phase === "string" ? activation.phase : "unknown",
					deferred: Array.isArray(activation?.deferred) ? activation.deferred : [],
					attempted: Array.isArray(activation?.attempted) ? activation.attempted : [],
				},
			}), "info");
		},
	});
}
