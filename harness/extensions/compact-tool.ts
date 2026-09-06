import { subscribeOnce } from "../lib/extension-lifecycle.ts";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { beginCompaction, finishCompaction, resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { ACTIVE_TOOL_PROMPTS } from "../lib/active-tool-prompts.ts";
import { classifyFailure, type FailureClass } from "../lib/failure-episodes.ts";
import { runCapsuleMode } from "../lib/run-capsule-store.ts";
import { onRunStateSnapshot } from "../lib/run-kernel-snapshot.ts";
import { renderRecoveryBrief } from "../lib/recovery-brief.ts";
import type { RunStateV1 } from "../lib/run-kernel-types.ts";
import { goalsEnabled, readCurrentGoal, readGoal, renderGoalRecoveryBrief } from "../lib/goal-state.ts";
import { continuationDispatcherActive, emitContinuationRequest, hashContinuationIdentity } from "../lib/continuation-authority.ts";
import { createHash } from "node:crypto";

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
	subscribeOnce("compact-tool:run-state-snapshot", () => onRunStateSnapshot(pi.events, (event) => { recoveryState = event.state; }));
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
				const sessionIdHash = hashContinuationIdentity(ctx.sessionManager?.getSessionId?.() ?? `compat:${ctx.cwd}`);
				const resume = async (status: "complete" | "failed", detail: Record<string, unknown>) => {
					if (settled || !finishCompaction(token)) return;
					settled = true;
					inFlight = false;
					// The post-compaction turn is dispatched by the shared continuation
					// authority only after the session is idle and the request is
					// re-authorized. No private follow-up/next-turn queue is used, so a
					// pause or cancellation can revoke this request before it reaches Pi.
					const goal = goalsEnabled() ? await readCurrentGoal(ctx.cwd) : undefined;
					if (goal && goal.status !== "active") return;
					const ownerIdHash = goal ? createHash("sha256").update(goal.goal_id).digest("hex") : sessionIdHash;
					const generation = goal ? createHash("sha256").update(JSON.stringify(goal)).digest("hex") : `compact:${token.generation}:${token.request}:${status}`;
					const request = {
						v: 1 as const, session_id_hash: sessionIdHash, owner_id_hash: ownerIdHash, generation,
						scope: goal ? "goal" as const : "session" as const, reason: "compaction_resume" as const, priority: 400,
						idempotency_key: `compact:${sessionIdHash}:${generation}`,
						message: RESUME, expires_at_ms: Date.now() + 60_000,
					};
					const authorize = async () => {
						const current = goalsEnabled() ? await readCurrentGoal(ctx.cwd) : undefined;
						if (!goal) return !current || current.status === "active";
						return Boolean(current && current.status === "active" &&
							createHash("sha256").update(current.goal_id).digest("hex") === ownerIdHash &&
							createHash("sha256").update(JSON.stringify(current)).digest("hex") === generation);
					};
					// A compacted turn may only resume through the shared authority. If the
					// arbiter is unavailable, fail closed rather than creating an unaudited
					// private follow-up that pause/cancel cannot revoke.
					if (continuationDispatcherActive(pi.events)) emitContinuationRequest(pi.events, { request, authorize });
				};
				try {
					const goalBrief = goalsEnabled() ? renderGoalRecoveryBrief(await readGoal(ctx.cwd)) : "";
					const recovery = recoveryMode && recoveryState
						? `\n\n${renderRecoveryBrief(recoveryState, { reason: "compaction" })}`
						: "";
					ctx.compact({
						customInstructions: `${focus || DEFAULT_FOCUS}${recovery}${goalBrief ? `\n\n${goalBrief}` : ""}`,
						onComplete: (r) => {
							if (settled) return;
							ctx.ui.notify(`context compacted (~${r.tokensBefore} tok before compaction)`, "info");
							void resume("complete", { tokensBefore: r.tokensBefore, estimatedTokensAfter: r.estimatedTokensAfter ?? null });
						},
						onError: (e) => {
							if (settled) return;
							const failureClass = compactionFailureClass(e);
							ctx.ui.notify(`compaction failed (failure_class=${failureClass})`, "warning");
							void resume("failed", { failureClass });
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
