import { appendFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// RETIRED AUDIT SOURCE: wire-truth instrument (formerly PAYLOAD_AUDIT=on).
// Records what each provider request ACTUALLY contains — pi's `before_provider_request`
// hands us the serialized payload in-process, which a MITM proxy could not do under the
// gate sandbox (GATE_NETWORK=endpoint allows only the loopback model endpoint).
// Answers, per request: is the message prefix byte-stable call-to-call (KV cache truth)?
// do prior-turn assistant messages still carry thinking blocks at the wire? is the c48
// lens block present, and only in the tail position it promises?
// High-frequency data → its own trace file (plan-runner-traces precedent), not telemetry.

const ENABLED = process.env.PAYLOAD_AUDIT === "on";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

type Message = { role?: string; content?: unknown; reasoning_content?: unknown };

export type PayloadAuditRow = {
	ts: string;
	seq: number;
	model: string | null;
	messages: number;
	bytes: number;
	system_sha256: string | null;
	tools_sha256: string | null;
	// Index of the first message that differs from the previous request's messages;
	// -1 when the previous array is an exact serialized prefix of this one.
	first_divergence: number;
	prefix_stable: boolean;
	think_tag_count: number;
	reasoning_field_count: number;
	lens_present: boolean;
	lens_tail_only: boolean;
};

export function analyzePayload(
	payload: Record<string, unknown>,
	previous: string[] | null,
): { row: Omit<PayloadAuditRow, "ts" | "seq">; serialized: string[] } {
	const messages = (Array.isArray(payload.messages) ? payload.messages : []) as Message[];
	const serialized = messages.map((m) => JSON.stringify(m));
	const system = messages.find((m) => m.role === "system" || m.role === "developer");
	const tools = payload.tools === undefined ? null : JSON.stringify(payload.tools);

	let firstDivergence = -1;
	if (previous) {
		for (let i = 0; i < previous.length; i++) {
			if (serialized[i] !== previous[i]) { firstDivergence = i; break; }
		}
		if (firstDivergence === -1 && previous.length > serialized.length) {
			firstDivergence = serialized.length; // previous was truncated — also a break
		}
	}

	let thinkTags = 0;
	let reasoningFields = 0;
	for (const m of messages) {
		if (m.role !== "assistant") continue;
		const body = JSON.stringify(m.content ?? "");
		thinkTags += (body.match(/<think>/g) ?? []).length;
		if (m.reasoning_content !== undefined) reasoningFields += 1;
	}

	const LENS = "[harness summary]";
	const lensIndexes = serialized
		.map((s, i) => (s.includes(LENS) ? i : -1))
		.filter((i) => i >= 0);

	return {
		serialized,
		row: {
			model: typeof payload.model === "string" ? payload.model : null,
			messages: messages.length,
			bytes: serialized.reduce((n, s) => n + s.length, 0),
			system_sha256: system ? sha(JSON.stringify(system)) : null,
			tools_sha256: tools === null ? null : sha(tools),
			first_divergence: firstDivergence,
			prefix_stable: firstDivergence === -1,
			think_tag_count: thinkTags,
			reasoning_field_count: reasoningFields,
			lens_present: lensIndexes.length > 0,
			lens_tail_only: lensIndexes.length > 0 && lensIndexes.every((i) => i === serialized.length - 1),
		},
	};
}

export default function (pi: ExtensionAPI): void {
	if (!ENABLED) return;
	let previous: string[] | null = null;
	let seq = 0;
	let tracePath: string | null = null;

	pi.on("session_start", async (_event, ctx) => {
		previous = null;
		seq = 0;
		tracePath = join(ctx.cwd ?? process.cwd(), ".pi", "traces", "payload-audit.jsonl");
	});

	pi.on("before_provider_request", async (event) => {
		try {
			const payload = (event as { payload?: Record<string, unknown> }).payload;
			if (!payload || typeof payload !== "object") return undefined;
			const { row, serialized } = analyzePayload(payload, previous);
			previous = serialized;
			seq += 1;
			const path = tracePath ?? join(process.cwd(), ".pi", "traces", "payload-audit.jsonl");
			mkdirSync(dirname(path), { recursive: true });
			appendFileSync(path, `${JSON.stringify({ ts: new Date().toISOString(), seq, ...row })}\n`);
		} catch { /* an audit must never break a session */ }
		return undefined; // observation only — never replace the payload
	});
}
