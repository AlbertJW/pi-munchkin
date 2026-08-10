import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { record } from "../lib/telemetry.ts";
import { onHarnessSignal } from "../lib/harness-signals.ts";

type DeferredTool = "subagent" | "compact_context";
const DEFERRED: readonly DeferredTool[] = ["subagent", "compact_context"];
const BASE_REGISTRY = ["read", "bash", "edit", "write"];

// Adopted 2026-08-04 after explicit human review. Ambient restores the prior
// always-visible surface immediately.
const MODE = process.env.MUNCHKIN_TOOL_ACTIVATION === "ambient" ? "ambient" : "dynamic";

export default function (pi: ExtensionAPI): void {
	const g = globalThis as Record<string, unknown>;
	g.__pi_tool_activation_state = { mode: MODE, preserved_explicit: false, reason: "startup" };
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

	onHarnessSignal(pi.events, (signal) => {
		if (signal.type === "plan/write") lastOpenItems = signal.openItems;
		if (signal.type === "plan/go" && lastOpenItems > 1) activate("subagent", "multi-item-execution");
		if (signal.type === "plan/gate" && !signal.pass && signal.fails >= 2) activate("subagent", "second-gate-failure");
		if (signal.type === "loop/tier" && signal.tier === 2) {
			activate("subagent", signal.detector === "semantic" ? "semantic-tier-two" : "loop-tier-two");
		}
	});

	pi.on("session_start", async () => {
		g.__pi_tool_activation_state = { mode: MODE, preserved_explicit: false, reason: "dynamic-startup" };
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
			g.__pi_tool_activation_state = {
				mode: MODE, preserved_explicit: true,
				reason: complete ? "narrowed-tools" : "incomplete-registry",
			};
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
