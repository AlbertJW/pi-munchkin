import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildContextSurfaceReceipt, systemPromptReceipt, type ContextSurfacePrior, type SystemPromptReceipt } from "../lib/context-surface.ts";
import { record } from "../lib/telemetry.ts";

export default function (pi: ExtensionAPI): void {
	let system: SystemPromptReceipt = systemPromptReceipt("");
	let compactionGeneration = 0;
	// Previous call's block hashes + system sha, for the KV-cache invariants
	// (prefix_stable/appended_only/system_prompt_changed). Reset on session
	// start AND compaction — a post-compaction array is legitimately
	// non-append-only; compaction_generation explains the null gap.
	let prior: ContextSurfacePrior | null = null;

	pi.on("before_agent_start", async (event) => {
		system = systemPromptReceipt(event.systemPrompt);
	});

	pi.on("session_start", async () => {
		compactionGeneration = 0;
		prior = null;
	});

	pi.on("session_compact", async () => {
		compactionGeneration += 1;
		prior = null;
	});

	pi.on("context", async (event, ctx) => {
		const plan = (globalThis as Record<string, unknown>).__pi_active_plan_context as { run_id?: string; item_id?: string } | undefined;
		const { receipt, messageHashes } = buildContextSurfaceReceipt(event.messages, system, ctx.getContextUsage?.(), {
			compactionGeneration,
			planRunId: plan?.run_id,
			planItemId: plan?.item_id,
		}, prior);
		prior = { messageHashes, systemSha: system.sha256 };
		// Flag-bus publish (same-process idiom as __pi_gate_green): the combined
		// duplicate share of the surface the provider will actually see, for
		// context-dedup's redundancy nudge — no recompute, no direct coupling.
		(globalThis as Record<string, unknown>).__pi_ctx_redundancy_pct =
			(receipt.exact_duplicate_block_share + receipt.near_duplicate_block_share) * 100;
		record("context-surface", "receipt", {
			...receipt,
			provider: ctx.model?.provider,
			model: ctx.model?.id,
			run_id: plan?.run_id,
		});
		// Observation-only: returning undefined preserves the exact original array.
	});
}
