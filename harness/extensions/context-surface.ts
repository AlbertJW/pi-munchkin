import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { buildContextSurfaceReceipt, systemPromptReceipt, type ContextSurfacePrior, type SystemPromptReceipt } from "../lib/context-surface.ts";
import { record } from "../lib/telemetry.ts";
import { emitHarnessSignal } from "../lib/harness-signals.ts";

export type ContextSurfaceMode = "summary" | "full" | "off";

export function contextSurfaceMode(env: NodeJS.ProcessEnv = process.env): ContextSurfaceMode {
	if (env.TELEMETRY_SOURCE === "gate") return "full";
	return env.CONTEXT_SURFACE_MODE === "full" || env.CONTEXT_SURFACE_MODE === "off"
		? env.CONTEXT_SURFACE_MODE : "summary";
}

export function installContextSurface(
	pi: ExtensionAPI,
	buildReceipt = buildContextSurfaceReceipt,
): void {
	const mode = contextSurfaceMode();
	let system: SystemPromptReceipt = systemPromptReceipt("");
	let compactionGeneration = 0;
	let callCount = 0;
	let summaryAfterCompaction = false;
	const crossed = new Set<number>();
	// Previous call's block hashes + system sha, for the KV-cache invariants
	// (prefix_stable/appended_only/system_prompt_changed). Reset on session
	// start AND compaction — a post-compaction array is legitimately
	// non-append-only; compaction_generation explains the null gap.
	let prior: ContextSurfacePrior | null = null;

	pi.on("before_agent_start", async (event) => {
		if (mode === "full") system = systemPromptReceipt(event.systemPrompt);
	});

	pi.on("session_start", async () => {
		compactionGeneration = 0;
		callCount = 0;
		summaryAfterCompaction = false;
		crossed.clear();
		prior = null;
	});

	pi.on("session_compact", async () => {
		compactionGeneration += 1;
		prior = null;
		summaryAfterCompaction = true;
	});

	pi.on("context", async (event, ctx) => {
		if (mode === "off") return;
		callCount += 1;
		if (mode === "summary") {
			const usage = ctx.getContextUsage?.();
			const pct = usage?.percent ?? null;
			const newlyCrossed = [60, 80, 90].filter((value) => pct != null && pct >= value && !crossed.has(value));
			for (const value of newlyCrossed) crossed.add(value);
			const threshold = newlyCrossed.at(-1);
			const reason = callCount === 1 ? "first" : summaryAfterCompaction ? "compaction" : threshold != null ? `threshold-${threshold}` : callCount % 8 === 0 ? "eighth" : null;
			if (reason) record("context-surface", "summary", {
				call: callCount, context_tokens: usage?.tokens ?? null, context_window: usage?.contextWindow ?? null,
				context_pct: pct, compaction_generation: compactionGeneration, reason,
			});
			summaryAfterCompaction = false;
			return;
		}
		const plan = (globalThis as Record<string, unknown>).__pi_active_plan_context as { run_id?: string; item_id?: string } | undefined;
		const { receipt, messageHashes } = buildReceipt(event.messages, system, ctx.getContextUsage?.(), {
			compactionGeneration,
			planRunId: plan?.run_id,
			planItemId: plan?.item_id,
		}, prior);
		prior = { messageHashes, systemSha: system.sha256 };
		record("context-surface", "receipt", {
			...receipt,
			provider: ctx.model?.provider,
			model: ctx.model?.id,
			run_id: plan?.run_id,
		});
		emitHarnessSignal(pi.events, {
			v: 1,
			type: "context/receipt",
			contextPct: receipt.context_pct,
			staleShare: receipt.stale_tool_result_share,
			duplicateShare: receipt.exact_duplicate_block_share,
		});
		// Observation-only: returning undefined preserves the exact original array.
	});
}

export default installContextSurface;
