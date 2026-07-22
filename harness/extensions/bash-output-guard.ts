// bash-output-guard (DARK: BASH_OUTPUT_GUARD=on — munchkin candidate c35, not
// a default). Withholds an oversized bash tool result and replaces it with a
// bounded diagnostic + steer, instead of letting a runaway/wandering command
// (e.g. an unscoped `find` that walked into $HOME or another project) flood
// context with a blob the model can't productively use.
//
// Observed trigger (2026-07-22, LFM25-8B-A1B on the remote box, tool-calling
// itself already working): a `find` walked into an unrelated project
// directory (thousands of files from unrelated historical runs) and returned
// ~63K characters. The session then sat idle — no further tool calls, no
// progress — for the rest of its budget. context-inlet-guard already bounds
// oversized READS the same way; bash had no equivalent.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { looksLikeCwdEscape, outputGuardMessage, totalContentChars } from "../lib/bash-output.ts";
import { record } from "../lib/telemetry.ts";

const ENABLED = process.env.BASH_OUTPUT_GUARD === "on";

const MAX_CHARS = (() => {
	const n = Number.parseInt(process.env.BASH_OUTPUT_MAX_CHARS || "8000", 10);
	return Number.isFinite(n) && n > 0 ? n : 8000;
})();

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;
	pi.on("tool_result", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const chars = totalContentChars(event.content);
		if (chars <= MAX_CHARS) return;

		const command = String((event.input as Record<string, unknown> | undefined)?.command ?? "");
		const cwdEscapeSuspected = looksLikeCwdEscape(command, ctx.cwd);
		const message = outputGuardMessage(chars, MAX_CHARS, cwdEscapeSuspected);
		record("bash-output-guard", "withheld", { chars, max_chars: MAX_CHARS, cwd_escape_suspected: cwdEscapeSuspected });
		return { content: [{ type: "text" as const, text: message }], isError: true };
	});
}
