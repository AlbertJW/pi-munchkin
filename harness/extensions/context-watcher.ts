import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decide } from "../lib/context-watch.ts";
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

const ENABLED = process.env.CONTEXT_WATCHER !== "off";
const THRESHOLD = (() => {
	const n = Number.parseInt(process.env.CTX_WATCH_PCT || "70", 10);
	return Number.isFinite(n) && n > 0 && n < 100 ? n : 70;
})();
const REARM = Math.max(10, THRESHOLD - 15); // hysteresis band below the trigger

const FOCUS =
	"Summarise older turns; keep the plan, recent edits with their file paths/#tags, the active task, and any unresolved error.";

let armed = true;
// Thrash guard: if compaction can't shrink usage below THRESHOLD, don't refire
// forever — after 2 consecutive fires without dropping under REARM, go quiet and
// let pi's reserveTokens auto-compaction be the net. Resets under REARM.
let consecutiveFires = 0;

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.on("session_start", async () => {
		armed = true;
		consecutiveFires = 0;
	});

	// If compaction lands BETWEEN REARM and THRESHOLD, decide()'s hysteresis
	// would never re-arm (usage only climbs from there) — the watcher was
	// permanently disarmed after its first fire. Re-arm after any compaction
	// that ends below the trigger; the thrash guard bounds refiring.
	pi.on("session_compact", async (event, ctx) => {
		const pct = ctx.getContextUsage?.()?.percent ?? null;
		if (pct !== null && pct < THRESHOLD) armed = true;
		// 0.79.10+ metadata: distinguishes our proactive fires ("manual", fromExtension)
		// from pi's reserveTokens net ("threshold"/"overflow") in the telemetry.
		const e = event as { reason?: string; willRetry?: boolean };
		record("context-watcher", "compacted", { reason: e.reason ?? "unknown", willRetry: e.willRetry ?? false, pct: pct === null ? -1 : Math.round(pct) });
	});

	pi.on("turn_end", async (event, ctx) => {
		const usage = ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		if (percent !== null && percent < REARM) consecutiveFires = 0;
		const d = decide(percent, armed, THRESHOLD, REARM);
		armed = d.armed;
		if (d.compact && consecutiveFires < 2) {
			consecutiveFires += 1;
			record("context-watcher", "compact", { pct: Math.round(percent ?? 0), consecutive: consecutiveFires });
			ctx.compact({
				customInstructions: FOCUS,
				onError: (e) => {
					armed = true; // failed compaction must not disarm the watcher — retry next turn
					record("context-watcher", "compact-failed", { error: e.message.slice(0, 200) });
					ctx.ui.notify(`context-watcher: compact failed: ${e.message}`, "warning");
				},
			});
			ctx.ui.notify(`context-watcher: compacting at ${Math.round(percent ?? 0)}% of context`, "info");
		} else if (d.compact) {
			record("context-watcher", "thrash-silenced", { pct: Math.round(percent ?? 0) });
		}
	});
}
