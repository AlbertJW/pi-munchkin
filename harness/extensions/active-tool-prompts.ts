import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ACTIVE_TOOL_PROMPTS, stripAmbientToolGuidance } from "../lib/active-tool-prompts.ts";

/** Dark PR-2 surface mode. Pi already selects promptSnippet, schema, and
 * promptGuidelines by active tool; this adapter removes only the historical
 * ambient block when explicitly enabled. Unset preserves the live prompt. */
export default function (pi: ExtensionAPI): void {
	if (!ACTIVE_TOOL_PROMPTS) return;
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: stripAmbientToolGuidance(event.systemPrompt),
	}));
}
