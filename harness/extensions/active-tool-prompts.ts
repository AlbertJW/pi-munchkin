import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { ACTIVE_TOOL_PROMPTS, stripAmbientToolGuidance } from "../lib/active-tool-prompts.ts";

/** Pi selects promptSnippet, schema, and promptGuidelines by active tool. This
 * adapter removes the historical ambient block on the derived default surface;
 * ACTIVE_TOOL_PROMPTS=ambient is the explicit compatibility rollback. */
export default function (pi: ExtensionAPI): void {
	if (!ACTIVE_TOOL_PROMPTS) return;
	pi.on("before_agent_start", async (event) => ({
		systemPrompt: stripAmbientToolGuidance(event.systemPrompt),
	}));
}
