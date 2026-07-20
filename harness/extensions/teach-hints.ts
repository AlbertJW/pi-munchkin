// teach-hints (DARK: TEACH_HINTS=on — munchkin candidate c28, not a default).
// Appends one deterministic teaching line to matching tool ERROR results via
// the tool_result hook (the did-you-mean shape: additive, isError stays true).
// Per-rule kill switches: TEACH_HINT_<RULE-ID-UPPERCASED>=off (dashes → _).
import { execFileSync } from "node:child_process";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildRules, hintFor } from "../lib/teach-hints.ts";
import { record } from "../lib/telemetry.ts";
import { steerText } from "../lib/steer-texts.ts";

const ENABLED = process.env.TEACH_HINTS === "on";

function ruleEnabled(id: string): boolean {
	return process.env[`TEACH_HINT_${id.toUpperCase().replace(/-/g, "_")}`] !== "off";
}

// One PATH probe per process — the availability of node/python3/etc does not
// change mid-session, and the probe must never run per tool result.
const probeCache = new Map<string, boolean>();
function probeAvailable(name: string): boolean {
	const cached = probeCache.get(name);
	if (cached !== undefined) return cached;
	let available = false;
	try {
		execFileSync("command", ["-v", name], { shell: false, timeout: 1000, stdio: "ignore" });
		available = true;
	} catch {
		try {
			execFileSync("which", [name], { timeout: 1000, stdio: "ignore" });
			available = true;
		} catch {
			available = false;
		}
	}
	probeCache.set(name, available);
	return available;
}

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;
	const rules = buildRules(probeAvailable);
	pi.on("tool_result", async (event) => {
		if (!event.isError) return;
		const text = (event.content ?? [])
			.map((c: { type?: string; text?: string }) => (c?.type === "text" ? c.text ?? "" : ""))
			.join("\n");
		const match = hintFor(rules, event.toolName, true, text, event.input as Record<string, unknown> | undefined, ruleEnabled);
		if (!match) return;
		const hint = "\n" + steerText(`HINT_${match.rule.toUpperCase().replace(/-/g, "_")}`, "{hint}", { hint: match.hint });
		record("teach-hints", "hint", { rule: match.rule, tool: event.toolName, injected_chars: hint.length });
		return { content: [...(event.content ?? []), { type: "text" as const, text: hint }] };
	});
}
