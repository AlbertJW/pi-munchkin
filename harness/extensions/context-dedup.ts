// Context read-dedup + redundancy nudge — both DARK A/B candidates.
//
// READ_DEDUP=on (c26): a `context`-event view transform that collapses
// repeated identical `read` results into a one-line back-reference (see
// lib/context-dedup.ts for why the LATER copy is replaced). Per-call view
// only — session history is untouched by the context event contract.
//
// CTX_REDUNDANCY_NUDGE=on (c27): when the post-dedup context is still
// heavily redundant (exact + near duplicate share from context-surface's
// receipt, published on the globalThis flag bus), steer the model once
// toward compact_context. Cooldown so it never nags.
//
// Registered BEFORE context-surface in pi.extensions so receipts measure the
// post-dedup surface — the duplicate-share drop is the mechanism metric.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dedupReadResults } from "../lib/context-dedup.ts";
import { steerText } from "../lib/steer-texts.ts";
import { record } from "../lib/telemetry.ts";

const READ_DEDUP = process.env.READ_DEDUP === "on";
const NUDGE = process.env.CTX_REDUNDANCY_NUDGE === "on";
const NUDGE_PCT = Math.min(95, Math.max(5, Number.parseInt(process.env.CTX_REDUNDANCY_PCT || "50", 10) || 50));
const NUDGE_COOLDOWN_TURNS = 8;

export default function (pi: ExtensionAPI): void {
	if (READ_DEDUP) {
		pi.on("context", async (event) => {
			const result = dedupReadResults(event.messages);
			if (!result) return undefined; // nothing replaced — preserve the exact original array
			record("context-dedup", "dedup", { replaced: result.replaced, saved_bytes: result.savedBytes });
			return { messages: result.messages as typeof event.messages };
		});
	}

	if (NUDGE) {
		let lastNudgeTurn = -Infinity;
		pi.on("turn_end", async (event) => {
			const share = (globalThis as Record<string, unknown>).__pi_ctx_redundancy_pct;
			if (typeof share !== "number" || share < NUDGE_PCT) return;
			if (event.turnIndex - lastNudgeTurn < NUDGE_COOLDOWN_TURNS) return;
			lastNudgeTurn = event.turnIndex;
			const msg = steerText(
				"CTX_REDUNDANCY_MSG",
				"[context] ~{share}% of the context window is duplicate or near-duplicate content (mostly repeated reads/output). Call compact_context to fold it down before continuing — do not re-read files you have already seen.",
				{ share: Math.round(share) },
			);
			record("context-dedup", "nudge", { share_pct: Math.round(share), injected_chars: msg.length, turnIndex: event.turnIndex });
			pi.sendUserMessage(msg, { deliverAs: "steer" });
		});
	}
}
