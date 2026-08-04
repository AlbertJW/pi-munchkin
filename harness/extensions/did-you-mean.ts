// did-you-mean (LIVE default-on since 2026-08-03; was dark candidate c24).
// Appends a deterministic "closest existing path" line to a read/edit
// file-not-found ERROR result via the tool_result hook (fires on failures too;
// additive — hashline's own resolution and messages are untouched, isError stays
// true). Targets the measured #1 failure trigger: missing-file -> wander.
// ADOPTED by judgment (Albert-approved; grounds in
// DARK_CANDIDATE_VERDICTS_2026-08-03.md): additive, cannot produce the harm
// signature; "fires only on its purpose-built fixture" was a measurement-venue
// criticism, not a mechanism one — live models do typo paths. DID_YOU_MEAN=off
// is the kill switch.

import { record } from "../lib/telemetry.ts";
import { attemptedPathFrom, closestExistingPath } from "../lib/did-you-mean.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ENABLED = process.env.DID_YOU_MEAN !== "off";

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "read" && event.toolName !== "edit") return;
		if (!event.isError) return;
		const text = (event.content ?? [])
			.map((c: { type?: string; text?: string }) => (c?.type === "text" ? c.text ?? "" : ""))
			.join("\n");
		if (!/ENOENT|file not found/i.test(text)) return;
		const attempted = attemptedPathFrom(event.toolName, event.input, text);
		if (!attempted) return;
		const suggestion = await closestExistingPath(ctx.cwd, attempted);
		if (!suggestion) return;
		const hint = `\nclosest existing path: ${suggestion}`;
		record("did-you-mean", "hint", { tool: event.toolName, injected_chars: hint.length });
		return { content: [...(event.content ?? []), { type: "text" as const, text: hint }] };
	});
}
