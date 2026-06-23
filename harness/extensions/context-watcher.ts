import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { decide } from "../lib/context-watch.ts";

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

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.on("session_start", async () => {
		armed = true;
	});

	pi.on("turn_end", async (event, ctx) => {
		const usage = ctx.getContextUsage?.();
		const percent = usage?.percent ?? null;
		const d = decide(percent, armed, THRESHOLD, REARM);
		armed = d.armed;
		if (d.compact) {
			ctx.compact({
				customInstructions: FOCUS,
				onError: (e) => ctx.ui.notify(`context-watcher: compact failed: ${e.message}`, "warning"),
			});
			ctx.ui.notify(`context-watcher: compacting at ${Math.round(percent ?? 0)}% of context`, "info");
		}
	});
}
