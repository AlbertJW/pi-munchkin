import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildContextSurfaceReceipt, systemPromptReceipt, type SystemPromptReceipt } from "../lib/context-surface.ts";
import { record } from "../lib/telemetry.ts";

export default function (pi: ExtensionAPI): void {
	let system: SystemPromptReceipt = systemPromptReceipt("");
	let compactionGeneration = 0;

	pi.on("before_agent_start", async (event) => {
		system = systemPromptReceipt(event.systemPrompt);
	});

	pi.on("session_start", async () => {
		compactionGeneration = 0;
	});

	pi.on("session_compact", async () => {
		compactionGeneration += 1;
	});

	pi.on("context", async (event, ctx) => {
		const plan = (globalThis as Record<string, unknown>).__pi_active_plan_context as { run_id?: string; item_id?: string } | undefined;
		const receipt = buildContextSurfaceReceipt(event.messages, system, ctx.getContextUsage?.(), {
			compactionGeneration,
			planRunId: plan?.run_id,
			planItemId: plan?.item_id,
		});
		record("context-surface", "receipt", {
			...receipt,
			provider: ctx.model?.provider,
			model: ctx.model?.id,
			run_id: plan?.run_id,
		});
		// Observation-only: returning undefined preserves the exact original array.
	});
}
