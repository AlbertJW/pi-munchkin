import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	readRuntimePosture, renderDoctor, sandboxPosture, summarizeToolSurface,
} from "../lib/runtime-doctor.ts";
import { record } from "../lib/telemetry.ts";

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

export default function (pi: ExtensionAPI): void {
	let nextSeq = 0;
	let current: ProviderTiming | null = null;
	let completed: ProviderTiming[] = [];

	function closeCurrent(): void {
		if (!current) return;
		completed.push(current);
		current = null;
	}

	function reset(): void {
		nextSeq = 0;
		current = null;
		completed = [];
	}

	pi.on("session_start", async () => { reset(); });
	pi.on("session_shutdown", async () => { reset(); });

	pi.on("before_provider_request", async () => {
		closeCurrent();
		current = {
			seq: ++nextSeq, started: performance.now(), headersAt: null,
			firstTokenAt: null, streamAt: null, status: null,
		};
	});

	pi.on("after_provider_response", async (event) => {
		if (!current) return;
		current.headersAt ??= performance.now();
		current.status = event.status;
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
				{ preserved_explicit?: unknown; reason?: unknown } | undefined;
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
				preservationReason: typeof activation?.reason === "string" ? activation.reason : undefined,
			}), "info");
		},
	});
}
