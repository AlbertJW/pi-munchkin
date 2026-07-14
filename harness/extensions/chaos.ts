import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CHAOS_MARKER, ChaosState, parseChaos } from "../lib/chaos-policy.ts";
import { record } from "../lib/telemetry.ts";

// chaos — the gauntlet's fault injector. DORMANT unless CHAOS="<tool>:<nth>:<fault>"
// is set (gauntlet.sh sets it per session). On the nth call of the named tool it
// blocks the call and returns a realistic error observation ONCE PER WORKDIR ROW:
// a marker file records the firing, so a fresh recovery session in the same
// workdir (c18b-style) observes the fault's aftermath, never a second fault.
// NEVER set CHAOS in live/interactive sessions.

export default function (pi: ExtensionAPI) {
	const spec = parseChaos(process.env.CHAOS);
	if (!spec) return;

	let state: ChaosState | null = null;

	pi.on("tool_call", async (event, ctx) => {
		if (state === null) {
			state = new ChaosState(spec, existsSync(join(ctx.cwd, CHAOS_MARKER)));
		}
		const fault = state.observe(event.toolName);
		if (fault === null) return;
		try {
			writeFileSync(join(ctx.cwd, CHAOS_MARKER), `${spec.tool}:${spec.nth}:${spec.fault}\n`);
		} catch {
			// marker write failing must not turn one fault into zero — inject anyway
		}
		record("chaos", "injected", { fault: spec.fault, tool: spec.tool, nth: spec.nth });
		return { block: true, reason: fault };
	});
}
