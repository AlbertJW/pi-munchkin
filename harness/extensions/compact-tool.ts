import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { beginCompaction, finishCompaction, resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";

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
// CRITICAL: in Pi 0.80.x ctx.compact() aborts the active agent operation before
// compacting. A tool result therefore cannot promise that the current loop will
// naturally continue. We explicitly queue one bounded next turn from the
// completion/error callback, and deduplicate requests while one is in flight.

const RESUME =
	"Context compaction finished. Re-read the active task and current filesystem state, then resume from the next unresolved step. Do not repeat completed work.";
const DEFAULT_FOCUS =
	"Preserve a compact structured capsule: active task and constraints; decisions; changed paths and exact identifiers; verified commands/results; unresolved errors or blockers; next action. Keep the most recent raw evidence needed to continue.";

export default function (pi: ExtensionAPI) {
	let inFlight = false;
	pi.on("session_start", async () => {
		resetCompactionCoordinator();
		inFlight = false;
	});

	pi.registerTool(
		defineTool({
			name: "compact_context",
			label: "Compact context",
			description:
				"Summarise your own older context in place when the window is heavy (after noisy exploration / a sub-phase). " +
				"Keeps recent turns + the active task; summarises the rest. `focus` = what to keep. " +
				"Your in-place lever — /collapse (user) rewinds to the plan; auto-compaction is the backstop. " +
				"This ends the current tool turn, compacts, then automatically resumes exactly once.",
			promptSnippet: "compact_context(focus?): summarise your own older context in place when the window is heavy.",
			parameters: Type.Object({
				focus: Type.Optional(
					Type.String({
						description: "What to keep, e.g. 'the plan, file paths I edited, the failing test'.",
					}),
				),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const token = inFlight ? null : beginCompaction("compact-tool");
				if (!token) {
					return {
						content: [{ type: "text" as const, text: "Compaction is already in progress; no second request was queued." }],
						details: { queued: false, duplicate: true },
					};
				}
				const focus = params.focus?.trim();
				inFlight = true;
				let settled = false;
				const resume = (status: "complete" | "failed", detail: Record<string, unknown>) => {
					if (settled || !finishCompaction(token)) return;
					settled = true;
					inFlight = false;
					pi.sendMessage(
						{ customType: "pi-munchkin:compact-resume", content: RESUME, display: true, details: { status, ...detail } },
						{ triggerTurn: true, deliverAs: "nextTurn" },
					);
				};
				try {
					ctx.compact({
						customInstructions: focus || DEFAULT_FOCUS,
						onComplete: (r) => {
							if (settled) return;
							ctx.ui.notify(`context compacted (~${r.tokensBefore} tok before compaction)`, "info");
							resume("complete", { tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter ?? null });
						},
						onError: (e) => {
							if (settled) return;
							ctx.ui.notify(`compact failed: ${e.message}`, "warning");
							resume("failed", { error: e.message.slice(0, 200) });
						},
					});
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					finishCompaction(token);
					settled = true;
					inFlight = false;
					ctx.ui.notify(`compact could not start: ${message}`, "warning");
					return {
						content: [{ type: "text" as const, text: `Compaction could not start: ${message.slice(0, 200)}` }],
						details: { queued: false, error: message.slice(0, 200) },
					};
				}
				return {
					content: [
						{
							type: "text" as const,
							text: "Compaction started. This tool turn will stop; one continuation turn is queued after compaction finishes.",
						},
					],
					details: { queued: true, resumesAfterCompaction: true },
				};
			},
		}),
	);
}
