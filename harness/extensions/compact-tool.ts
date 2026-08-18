import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { beginCompaction, finishCompaction, resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { ACTIVE_TOOL_PROMPTS } from "../lib/active-tool-prompts.ts";
import { classifyFailure, type FailureClass } from "../lib/failure-episodes.ts";
import { runCapsuleMode } from "../lib/run-capsule-store.ts";
import { onRunStateSnapshot } from "../lib/run-kernel-snapshot.ts";
import { renderRecoveryBrief } from "../lib/recovery-brief.ts";
import type { RunStateV1 } from "../lib/run-kernel-types.ts";

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

function compactionFailureClass(error: unknown): FailureClass {
	const text = error instanceof Error ? error.message : String(error);
	return classifyFailure({ toolName: "compact_context", args: {}, text, isError: true });
}

export default function (pi: ExtensionAPI) {
	let inFlight = false;
	let recoveryState: RunStateV1 | null = null;
	const recoveryMode = runCapsuleMode() === "recovery";
	onRunStateSnapshot(pi.events, (event) => { recoveryState = event.state; });
	pi.on("session_start", async () => {
		resetCompactionCoordinator();
		inFlight = false;
		recoveryState = null;
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
			promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
				"If the provider reports that context exceeds its window, call compact_context once with a focused preservation brief, then resume from current filesystem state.",
			] : undefined,
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
					// MUST be followUp, not nextTurn: pi 0.83's docs (extensions.md:1408-1409)
					// state nextTurn is "Queued for next user prompt. Does not interrupt or
					// trigger anything" and that triggerTurn "Only applies to `steer` and
					// `followUp` modes (ignored for `nextTurn`)". With nextTurn the tool
					// aborted the operation, compacted, and then sat idle until the user
					// typed — while its own description promised it "automatically resumes
					// exactly once". followUp delivers once the agent has no more tool calls,
					// which is exactly the post-compaction moment we want. (Found by Albert's
					// 2026-07-30 QA session; it also explains why compact-tool completions
					// were never observed live despite requests being recorded.)
					pi.sendMessage(
						{ customType: "pi-munchkin:compact-resume", content: RESUME, display: true, details: { status, ...detail } },
						{ triggerTurn: true, deliverAs: "followUp" },
					);
				};
				try {
					const recovery = recoveryMode && recoveryState
						? `\n\n${renderRecoveryBrief(recoveryState, { reason: "compaction" })}`
						: "";
					ctx.compact({
						customInstructions: `${focus || DEFAULT_FOCUS}${recovery}`,
						onComplete: (r) => {
							if (settled) return;
							ctx.ui.notify(`context compacted (~${r.tokensBefore} tok before compaction)`, "info");
							resume("complete", { tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter ?? null });
						},
						onError: (e) => {
							if (settled) return;
							const failureClass = compactionFailureClass(e);
							ctx.ui.notify(`compaction failed (failure_class=${failureClass})`, "warning");
							resume("failed", { failureClass });
						},
					});
				} catch (error) {
					const failureClass = compactionFailureClass(error);
					finishCompaction(token);
					settled = true;
					inFlight = false;
					ctx.ui.notify(`compaction could not start (failure_class=${failureClass})`, "warning");
					return {
						content: [{ type: "text" as const, text: `Compaction could not start (failure_class=${failureClass}). Continue without compaction.` }],
						details: { queued: false, failureClass },
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
