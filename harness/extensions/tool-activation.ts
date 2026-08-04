import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";
import type { TelemetryTap } from "../lib/telemetry.ts";

type DeferredTool = "subagent" | "compact_context";
const DEFERRED: readonly DeferredTool[] = ["subagent", "compact_context"];
const BASE_REGISTRY = ["read", "bash", "edit", "write"];

// Adopted 2026-08-04 after explicit human review. Ambient restores the prior
// always-visible surface immediately.
const MODE = process.env.MUNCHKIN_TOOL_ACTIVATION === "ambient" ? "ambient" : "dynamic";

export default function (pi: ExtensionAPI): void {
	if (MODE !== "dynamic") return;
	const deferred = new Set<DeferredTool>();
	const attempted = new Set<DeferredTool>();
	let lastOpenItems = 0;
	let lastContextPct = 0;

	function activate(tool: DeferredTool, reason: string): void {
		if (!deferred.has(tool) || attempted.has(tool)) return;
		attempted.add(tool); // one automatic attempt; later manual disables win
		const active = pi.getActiveTools();
		if (active.includes(tool)) return;
		try {
			pi.setActiveTools([...active, tool]);
			record("tool-activation", "activated", { tool, reason });
		} catch { /* incompatible runtime: fail open and never churn the surface */ }
	}

	const tap: TelemetryTap & { __toolActivation?: true } = (ext, kind, detail) => {
		if (ext === "plan-runner" && kind === "write" && typeof detail.open_items === "number") {
			lastOpenItems = detail.open_items;
		}
		if (ext === "plan-runner" && kind === "go" && lastOpenItems > 1) activate("subagent", "multi-item-execution");
		if (ext === "plan-runner" && kind === "gate" && detail.pass === false && Number(detail.fails) >= 2) {
			activate("subagent", "second-gate-failure");
		}
		if (ext === "loop-breaker" && kind === "steer" && detail.tier === 2) activate("subagent", "loop-tier-two");
	};
	tap.__toolActivation = true;
	const g = globalThis as Record<string, unknown>;
	const taps = ((g.__pi_telemetry_taps as TelemetryTap[] | undefined) ?? [])
		.filter((candidate) => !(candidate as typeof tap).__toolActivation);
	taps.push(tap);
	g.__pi_telemetry_taps = taps;

	pi.on("session_start", async () => {
		deferred.clear();
		attempted.clear();
		lastOpenItems = 0;
		lastContextPct = 0;
		const all = pi.getAllTools().map((tool) => tool.name);
		const active = pi.getActiveTools();
		const allSet = new Set(all);
		const activeSet = new Set(active);
		const complete = [...BASE_REGISTRY, ...DEFERRED].every((name) => allSet.has(name));
		const explicit = activeSet.size !== allSet.size || all.some((name) => !activeSet.has(name));
		if (!complete || explicit) {
			for (const tool of DEFERRED) record("tool-activation", "preserved-explicit", {
				tool, reason: complete ? "narrowed-tools" : "incomplete-registry",
			});
			return;
		}
		for (const tool of DEFERRED) {
			deferred.add(tool);
			record("tool-activation", "deferred", { tool, reason: "dynamic-startup" });
		}
		pi.setActiveTools(active.filter((name) => !deferred.has(name as DeferredTool)));
	});

	pi.on("context", async (_event, ctx) => {
		const pct = ctx.getContextUsage()?.percent;
		if (pct != null && lastContextPct < 60 && pct >= 60) activate("compact_context", "context-60");
		if (pct != null) lastContextPct = pct;
	});
}
