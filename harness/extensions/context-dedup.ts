// Context read-dedup (LIVE default-on since 2026-08-07).
//
// READ_DEDUP=on (c26): a `context`-event view transform that collapses
// repeated identical `read` results into a one-line back-reference (see
// lib/context-dedup.ts for why the LATER copy is replaced). Per-call view
// only — session history is untouched by the context event contract.
//
// Registered BEFORE context-surface in pi.extensions so receipts measure the
// post-dedup surface — the duplicate-share drop is the mechanism metric.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dedupReadResults } from "../lib/context-dedup.ts";
import { record } from "../lib/telemetry.ts";

// READ_DEDUP: LIVE default-on since 2026-08-07 (was dark candidate c26).
// ADOPTED by judgment (Albert-approved); benefit was not established by a
// powered trial. One class riskier than pure-append adoptions (it TRANSFORMS
// the view). READ_DEDUP=off kills it.
const READ_DEDUP = process.env.READ_DEDUP !== "off";

export default function (pi: ExtensionAPI): void {
	if (READ_DEDUP) {
		pi.on("context", async (event) => {
			const result = dedupReadResults(event.messages);
			if (!result) return undefined; // nothing replaced — preserve the exact original array
			record("context-dedup", "dedup", { replaced: result.replaced, saved_bytes: result.savedBytes });
			return { messages: result.messages as typeof event.messages };
		});
	}
}
