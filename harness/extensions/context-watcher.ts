import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decide, readWatcherConfig, usageDetail, type WatcherConfig } from "../lib/context-watch.ts";
import { beginCompaction, currentCompactionOwner, finishCompaction, resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { record } from "../lib/telemetry.ts";

// Active context-watcher: proactively compacts before the window fills.
//
// Why this exists: the local llama-server provider reports no token usage
// (compat.supportsUsageInStreaming=false), so pi estimates context with a char
// heuristic that UNDERCOUNTS the Qwen tokenizer. That estimate drove a hard
// 400 "request exceeds context size" (66414 > 65536) in a real run, and the
// model never called compact_context on its own (passive reflex, 0 uses).
//
// On each turn_end this reads pi's own usage estimate and, once past a percent
// threshold, calls ctx.compact() DIRECTLY — no reliance on the model. It fires
// before pi's built-in auto-compaction (which triggers at window-reserveTokens),
// so the watcher is the proactive primary and reserveTokens is the safety net.
//
// HONEST LIMIT: this shares pi's undercounting estimate, so it cannot catch a
// single catastrophic one-turn jump on its own — the widened reserveTokens
// (settings.json) is what guarantees the wall isn't hit. The watcher handles
// the common gradual-growth case, visibly and with a focus instruction.
//
// Disable with CONTEXT_WATCHER=off. Tune with CTX_WATCH_PCT (default 70).

const FOCUS =
	"Create a concise recall-first capsule with: active task and constraints; decisions; changed paths and exact identifiers; verified state and commands; unresolved errors or blockers; and the single next action. Retain the most recent raw evidence needed to continue.";
const RESUME =
	"Context compaction interrupted a tool-bearing turn. Resume the active task from the compacted state; inspect current results before taking the next bounded action.";
const RESUME_AFTER_FAILURE =
	"Context compaction failed after interrupting a tool-bearing turn. Resume the active task from current state; inspect the last tool result and take one bounded next action.";

export function registerContextWatcher(
	pi: ExtensionAPI,
	config: WatcherConfig = readWatcherConfig(),
	recordEvent: typeof record = record,
): void {
	const { enabled, thresholdPct, rearmPct } = config;
	let armed = true;
	// Thrash guard: if compaction cannot shrink usage below the threshold, do not
	// refire forever. Reset after usage falls below the re-arm band.
	let consecutiveFires = 0;
	let watcherRequestPending = false;
	let resumePending = false;
	let watcherRequestSettled = false;

	pi.on("session_start", async (event, ctx) => {
		resetCompactionCoordinator();
		armed = true;
		consecutiveFires = 0;
		watcherRequestPending = false;
		resumePending = false;
		watcherRequestSettled = false;
		recordEvent("context-watcher", "session-config", {
			enabled,
			thresholdPct,
			rearmPct,
			startReason: event.reason,
			...usageDetail(ctx.getContextUsage?.()),
		});
	});

	// If compaction lands BETWEEN REARM and THRESHOLD, decide()'s hysteresis
	// would never re-arm (usage only climbs from there) — the watcher was
	// permanently disarmed after its first fire. Re-arm after any compaction
	// that ends below the trigger; the thrash guard bounds refiring.
	pi.on("session_compact", async (event, ctx) => {
		const usage = ctx.getContextUsage?.();
		const pct = usage?.percent ?? null;
		if (pct !== null && pct < thresholdPct) armed = true;
		// Pi's `fromExtension` means a session_before_compact hook supplied the
		// summary content; it does NOT identify who requested compaction. The
		// pending latch is our exact watcher receipt. Threshold/overflow are Pi;
		// another manual caller is intentionally left unknown rather than guessed.
		const managedOwner = currentCompactionOwner();
		const requester = event.reason === "threshold" || event.reason === "overflow"
			? "pi"
			: watcherRequestPending
				? "context-watcher"
				: managedOwner ?? "manual-unknown";
		recordEvent("context-watcher", "compacted", {
			requester,
			contentProvider: event.fromExtension ? "extension" : "pi",
			reason: event.reason,
			willRetry: event.willRetry,
			enabled,
			thresholdPct,
			rearmPct,
			tokensBefore: event.compactionEntry.tokensBefore,
			...usageDetail(usage),
		});
	});

	pi.on("turn_end", async (event, ctx) => {
		const usage = ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		if (percent !== null && percent < rearmPct) consecutiveFires = 0;
		if (!enabled) return;
		const d = decide(percent, armed, thresholdPct, rearmPct);
		armed = d.armed;
		if (d.compact && consecutiveFires < 2) {
			consecutiveFires += 1;
			const token = beginCompaction("context-watcher");
			if (!token) {
				armed = true;
				consecutiveFires -= 1;
				recordEvent("context-watcher", "compact-suppressed", {
					reason: "another pi-munchkin compaction is active",
					activeOwner: currentCompactionOwner(), enabled, thresholdPct, rearmPct,
					...usageDetail(usage),
				});
				return;
			}
			watcherRequestPending = true;
			watcherRequestSettled = false;
			resumePending = event.toolResults.length > 0;
			const pre = usageDetail(usage);
			recordEvent("context-watcher", "compact-requested", {
				requester: "context-watcher",
				enabled,
				thresholdPct,
				rearmPct,
				consecutive: consecutiveFires,
				resumePending,
				...pre,
			});
			try {
			ctx.compact({
				customInstructions: FOCUS,
				onComplete: (result) => {
					if (watcherRequestSettled || !finishCompaction(token)) return;
					watcherRequestSettled = true;
					const post = usageDetail(ctx.getContextUsage?.());
					recordEvent("context-watcher", "compact-completed", {
						requester: "context-watcher",
						enabled,
						thresholdPct,
						rearmPct,
						preTokens: pre.contextTokens,
						preContextWindow: pre.contextWindow,
						prePct: pre.contextPct,
						tokensBefore: result.tokensBefore,
						estimatedTokensAfter: result.estimatedTokensAfter ?? null,
						postTokens: post.contextTokens,
						postContextWindow: post.contextWindow,
						postPct: post.contextPct,
					});
					watcherRequestPending = false;
					if (resumePending) {
						resumePending = false;
						pi.sendMessage(
							{ customType: "context-watcher-resume", content: RESUME, display: false },
							{ triggerTurn: true, deliverAs: "followUp" },
						);
					}
				},
				onError: (e) => {
					if (watcherRequestSettled || !finishCompaction(token)) return;
					watcherRequestSettled = true;
					armed = true; // failed compaction must not disarm the watcher — retry next turn
					const post = usageDetail(ctx.getContextUsage?.());
					recordEvent("context-watcher", "compact-failed", {
						requester: "context-watcher",
						enabled,
						thresholdPct,
						rearmPct,
						preTokens: pre.contextTokens,
						preContextWindow: pre.contextWindow,
						prePct: pre.contextPct,
						postTokens: post.contextTokens,
						postContextWindow: post.contextWindow,
						postPct: post.contextPct,
						error: e.message.slice(0, 200),
					});
					watcherRequestPending = false;
					if (resumePending) {
						resumePending = false;
						pi.sendMessage(
							{ customType: "context-watcher-resume", content: RESUME_AFTER_FAILURE, display: false },
							{ triggerTurn: true, deliverAs: "followUp" },
						);
					}
					ctx.ui.notify(`context-watcher: compact failed: ${e.message}`, "warning");
				},
			});
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				finishCompaction(token);
				watcherRequestSettled = true;
				watcherRequestPending = false;
				resumePending = false;
				armed = true;
				consecutiveFires -= 1;
				recordEvent("context-watcher", "compact-failed", {
					requester: "context-watcher", enabled, thresholdPct, rearmPct,
					preTokens: pre.contextTokens, preContextWindow: pre.contextWindow,
					prePct: pre.contextPct, postTokens: pre.contextTokens,
					postContextWindow: pre.contextWindow, postPct: pre.contextPct,
					error: message.slice(0, 200), synchronous: true,
				});
				ctx.ui.notify(`context-watcher: compact could not start: ${message}`, "warning");
				return;
			}
			ctx.ui.notify(`context-watcher: compacting at ${Math.round(percent ?? 0)}% of context`, "info");
		} else if (d.compact) {
			recordEvent("context-watcher", "thrash-silenced", {
				enabled,
				thresholdPct,
				rearmPct,
				...usageDetail(usage),
			});
		}
	});
}

export default function (pi: ExtensionAPI): void {
	registerContextWatcher(pi);
}
