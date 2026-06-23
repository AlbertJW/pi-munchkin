import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

// Model-driven in-place context compaction.
//
// The autonomous twin of the user-only `/collapse`. `navigateTree` is reachable
// only from command handlers, but `ctx.compact()` is on the base
// ExtensionContext (types.d.ts:233) so a TOOL can let the model summarise its
// OWN older context mid-task — at a good moment, with focused instructions —
// instead of waiting for blunt auto-compaction at the reserve threshold.
//
// This is the model's in-place prune lever in the regeneration stack:
//   - compact_context (this) — model summarises its own window, in place.
//   - /collapse (command)    — user rewinds the leaf to the plan spine.
//   - auto-compaction        — the backstop at contextWindow - reserveTokens.
//
// CRITICAL: ctx.compact() is fire-and-forget — compaction applies AFTER the
// current turn. The tool must NOT await onComplete (that would deadlock the
// turn). It queues the compaction and returns immediately.

export default function (pi: ExtensionAPI) {
	pi.registerTool(
		defineTool({
			name: "compact_context",
			label: "Compact context",
			description:
				"Summarise your own older context in place when the window is heavy (after noisy exploration / a sub-phase). " +
				"Keeps recent turns + the active task; summarises the rest. `focus` = what to keep. " +
				"Your in-place lever — /collapse (user) rewinds to the plan; auto-compaction is the backstop. " +
				"Applies before your next turn — call it, then keep working.",
			promptSnippet: "compact_context(focus?): summarise your own older context in place when the window is heavy.",
			parameters: Type.Object({
				focus: Type.Optional(
					Type.String({
						description: "What to keep, e.g. 'the plan, file paths I edited, the failing test'.",
					}),
				),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const focus = params.focus?.trim();
				ctx.compact({
					customInstructions: focus || "Summarise older turns; keep recent work, the active task, and key decisions/paths.",
					onComplete: (r) => ctx.ui.notify(`context compacted (~${r.tokensBefore} tok summarised)`, "info"),
					onError: (e) => ctx.ui.notify(`compact failed: ${e.message}`, "warning"),
				});
				return {
					content: [
						{
							type: "text" as const,
							text: "Compaction queued — older context summarised before your next turn. Keep working.",
						},
					],
					details: {},
				};
			},
		}),
	);
}
