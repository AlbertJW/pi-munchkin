import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";
import {
	buildControlProposal, controlEnforces, emitControlProposal, onControlDecision,
} from "../lib/control-proposal.ts";

// tool-call-rescue (LIVE default-on since 2026-08-07; was dark candidate
// c49). Rescues sessions that die on the
// malformed pseudo-tool-call serving artifact — the model emits its tool call
// as TEXT (`<tool_call></tool_call>\n<function=bash>…`, or a fenced lone JSON
// call object), produces zero real toolCall blocks, and the session ends at
// stopReason:"stop" with zero work done. Measured live on qwen36-35b (4/6
// equil sessions in one round; a documented serving-config trade-off) and as
// LFM25's 100% collapse class. Grammar cannot fix this: llama-server's lazy
// tool grammars engage only when the template's trigger tokens fire, and here
// the trigger text itself is malformed (llama.cpp #21839).
//
// Mechanism: ONE corrective steer per detection (wording seeded from forge's
// measured nudge), max 2 rescues per session. sendUserMessage triggers a turn,
// reviving a session that would otherwise be over. Detection without steering
// (damper exhausted) still records `detected` — free occurrence-rate data.
// v2 (recorded, not built): schema-locked one-shot reformat escalation.

// ADOPTED by judgment (Albert-approved); benefit was not established by a
// powered trial. No cross-suppression with other steers — bounded by
// MAX_RESCUES. TOOL_CALL_RESCUE=off is the kill switch.
const ENABLED = process.env.TOOL_CALL_RESCUE !== "off";
const MAX_RESCUES = 2;

export type PseudoCallDetection = { signature: string; toolName: string | null };

// Signatures, checked in order of specificity. Kept deliberately narrow: a
// false positive costs one polite steer (damper-capped), a false negative
// costs a dead session — but matching plain prose would be noise.
export function detectPseudoToolCall(text: string): PseudoCallDetection | null {
	if (!text) return null;
	const fn = text.match(/<function=([\w-]+)/);
	if (text.includes("<tool_call>") || fn) {
		return { signature: fn ? "function-tag" : "tool-call-tag", toolName: fn?.[1] ?? null };
	}
	// Fenced lone JSON object that looks like a call: {"name": "...", "arguments"|"parameters": ...}
	const fence = text.match(/```(?:json)?\s*(\{[\s\S]{0,2000}?\})\s*```/);
	if (fence) {
		try {
			const obj = JSON.parse(fence[1]);
			if (obj && typeof obj === "object" && typeof obj.name === "string" &&
				("arguments" in obj || "parameters" in obj)) {
				return { signature: "fenced-json-call", toolName: obj.name };
			}
		} catch { /* not JSON — not a call */ }
	}
	return null;
}

export function rescueMessage(det: PseudoCallDetection): string {
	const named = det.toolName ? ` It looks like you meant to call \`${det.toolName}\`.` : "";
	return (
		`[tool-call-rescue] Your previous response was not a valid tool call — it was plain text.${named} ` +
		"Re-emit it as a REAL tool call through the tool-calling interface, not as text, code fences, or XML tags. " +
		"Do not describe the call; make it."
	);
}

export default function (pi: ExtensionAPI): void {
	if (!ENABLED) return;
	let rescues = 0;
	// Set when a proposal is handed to the arbiter and cleared by its decision.
	// MAX_RESCUES bounds messages the model RECEIVES; charging the budget at
	// proposal time spent it on messages the arbiter dropped, and `tool_rescue` is
	// the second-lowest priority there, so it loses most contested boundaries under
	// the shipped CONTROL_ARBITER=enforce (2026-08-21). Two dropped proposals used
	// to exhaust the session budget without the model ever seeing a rescue.
	let awaitingDecision: { signature: string; turnIndex: number } | null = null;

	pi.on("session_start", async () => { rescues = 0; awaitingDecision = null; });

	onControlDecision(pi.events, (decision) => {
		const pending = awaitingDecision;
		awaitingDecision = null;
		if (!pending) return;
		const delivered = decision.winner?.source === "tool-call-rescue";
		if (delivered) rescues += 1;
		record("tool-call-rescue", "steered", {
			signature: pending.signature, turnIndex: pending.turnIndex, delivered,
		});
	});

	pi.on("turn_end", async (event) => {
		const msg = event.message;
		if (msg.role !== "assistant") return;
		let hasRealCall = false;
		let text = "";
		for (const block of msg.content ?? []) {
			if (block.type === "toolCall") hasRealCall = true;
			if (block.type === "text" && typeof block.text === "string") text += `${block.text}\n`;
		}
		if (hasRealCall) return; // real call present — nothing to rescue
		const det = detectPseudoToolCall(text);
		if (!det) return;
		record("tool-call-rescue", "detected", { signature: det.signature, turnIndex: event.turnIndex });
		if (rescues >= MAX_RESCUES) return;
		const message = rescueMessage(det);
		const legacyActed = !controlEnforces(pi.events);
		emitControlProposal(pi.events, buildControlProposal({
			boundarySequence: event.turnIndex,
			kind: "tool_rescue",
			reason: "pseudo_tool_call",
			source: "tool-call-rescue",
			cooldownKey: `tool-rescue:${det.signature}`,
			messageFactory: "tool-rescue",
			legacyActed,
		}), { message });
		if (!legacyActed) {
			// The arbiter owns delivery; its decision charges the budget and records
			// `steered`. If no decision ever arrives the budget is simply not spent.
			awaitingDecision = { signature: det.signature, turnIndex: event.turnIndex };
			return;
		}
		rescues += 1;
		record("tool-call-rescue", "steered", {
			signature: det.signature, turnIndex: event.turnIndex, delivered: true,
		});
		try {
			pi.sendUserMessage(message, { deliverAs: "steer" });
		} catch { /* stale pi post-replacement — nothing to rescue anymore */ }
	});
}
