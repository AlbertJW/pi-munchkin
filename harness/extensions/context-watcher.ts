import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { currentCompactionOwner } from "../lib/compaction-coordinator.ts";
import { record } from "../lib/telemetry.ts";
import { emitHarnessSignal } from "../lib/harness-signals.ts";

// Passive compaction observer. The active watcher (proactive ctx.compact() at a
// percent threshold) was removed 2026-07-28: it never fired in any of the 1,505
// gate sessions, and live telemetry shows 5 fires ever with zero recorded
// completions, while pi's native threshold/overflow compaction demonstrably
// handles the wall (including overflow recoveries with the watcher enabled and
// silent — it shared pi's undercounting estimate, so it could not preempt the
// wall it existed to prevent). What remains is the part gate rows consume:
// every compaction recorded with requester attribution.

export function registerContextWatcher(pi: ExtensionAPI, recordEvent: typeof record = record): void {
	pi.on("session_compact", async (event, ctx) => {
		const usage = ctx.getContextUsage?.();
		// Threshold/overflow are pi's own triggers. `fromExtension` only means a
		// session_before_compact hook supplied the summary content — it does NOT
		// identify who requested compaction. A coordinator owner (compact-tool)
		// is our only other exact receipt; anything else stays "manual-unknown"
		// rather than guessed.
		const requester = event.reason === "threshold" || event.reason === "overflow"
			? "pi"
			: currentCompactionOwner() ?? "manual-unknown";
		recordEvent("context-watcher", "compacted", {
			requester,
			contentProvider: event.fromExtension ? "extension" : "pi",
			reason: event.reason,
			willRetry: event.willRetry,
			tokensBefore: event.compactionEntry.tokensBefore,
			contextTokens: usage?.tokens ?? null,
			contextWindow: usage?.contextWindow ?? null,
			contextPct: usage?.percent == null ? null : Math.round(usage.percent * 100) / 100,
		});
		emitHarnessSignal(pi.events, { v: 1, type: "context/compacted" });
	});
}

export default function (pi: ExtensionAPI): void {
	registerContextWatcher(pi);
}
