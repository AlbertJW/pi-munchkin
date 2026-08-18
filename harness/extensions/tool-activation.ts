import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { measureActiveSurface, phaseDeferredTools, PHASE_CAPABILITY_TOOLS } from "../lib/capability-surface.ts";
import { classifyBashCommand } from "../lib/command-policy.ts";
import { record } from "../lib/telemetry.ts";
import { initialToolSurface } from "../lib/session-bootstrap.ts";
import { onHarnessSignal, type CapabilityName } from "../lib/harness-signals.ts";

type Mode = "ambient" | "dynamic" | "phase";
type SurfaceMode = "default" | "minimal";
type DeferredTool = "subagent" | "compact_context";
const DYNAMIC_DEFERRED: readonly DeferredTool[] = ["subagent", "compact_context"];
const BASE_REGISTRY = ["read", "bash", "edit", "write"];
export const MINIMAL_TOOL_SURFACE = BASE_REGISTRY;

// "bash" is not a mutation — a bash COMMAND may or may not be. A tool-name set
// counted the opening `rg`/`ls`/`git status` of nearly every session as the
// first mutation, and because the flag latches once, the real `edit` that
// followed emitted nothing at all: the true timestamp was never written, so
// pre-fix rows cannot be repaired by filtering and must be discarded. Delegate
// to the shared classifier (which fails CLOSED on unknown commands) rather than
// growing a fourth private regex — there are already three in this repo.
function isMutationResult(toolName: string, input: unknown): boolean {
	if (toolName === "edit" || toolName === "write") return true;
	if (toolName !== "bash") return false;
	const command = (input as { command?: unknown } | undefined)?.command;
	return classifyBashCommand(typeof command === "string" ? command : "").mutates;
}

function modeFromEnvironment(): Mode {
	const value = process.env.MUNCHKIN_TOOL_ACTIVATION;
	return value === "ambient" || value === "phase" ? value : "dynamic";
}

function surfaceFromEnvironment(): SurfaceMode {
	return process.env.MUNCHKIN_TOOL_SURFACE === "minimal" ? "minimal" : "default";
}

export default function (pi: ExtensionAPI): void {
	const mode = modeFromEnvironment();
	const surfaceMode = surfaceFromEnvironment();
	const g = globalThis as Record<string, unknown>;
	const publish = (value: Record<string, unknown>) => { g.__pi_tool_activation_state = value; };
	publish({ mode, surface_mode: surfaceMode, preserved_explicit: false, reason: "startup", phase: mode === "phase" ? "phase-aware" : "ambient-or-dynamic" });
	if (mode === "ambient" && surfaceMode === "default") return;

	const deferred = new Set<string>();
	const attempted = new Set<CapabilityName>();
	let allTools: any[] = [];
	let explicit = false;
	let lastOpenItems = 0;
	let lastContextPct = 0;
	let sessionStartedAt = 0;
	let firstUsefulMutation = false;

	function activationState(extra: Record<string, unknown> = {}): void {
		const current = (g.__pi_tool_activation_state && typeof g.__pi_tool_activation_state === "object")
			? g.__pi_tool_activation_state as Record<string, unknown> : {};
		publish({ ...current, ...extra, deferred: [...deferred].sort(), attempted: [...attempted].sort() });
	}

	function surfaceTelemetry(): void {
		const active = pi.getActiveTools();
		const measured = measureActiveSurface(allTools, active);
		record("tool-activation", "surface", {
			mode, surface_mode: surfaceMode, active_tools: active.length, all_tools: allTools.length,
			schema_bytes: measured.schemaBytes, guideline_bytes: measured.guidelineBytes,
			deferred_tools: deferred.size, unavailable_attempts: 0,
		});
	}

	function activateCapability(capability: CapabilityName, reason: string): void {
		if (surfaceMode === "minimal") return;
		if (mode !== "phase" && capability !== "subagent" && capability !== "compact_context") return;
		if (attempted.has(capability)) return;
		const names = PHASE_CAPABILITY_TOOLS[capability];
		const available = names.filter((name) => deferred.has(name));
		if (available.length === 0) return;
		attempted.add(capability); // one automatic attempt; later manual disables win
		activationState();
		const active = pi.getActiveTools();
		const next = [...active, ...available.filter((name) => !active.includes(name))];
		try {
			pi.setActiveTools(next);
			for (const tool of available) record("tool-activation", "activated", { tool, reason });
			surfaceTelemetry();
		} catch { /* incompatible runtime: fail open and never churn the surface */ }
	}

	function activateDynamic(tool: DeferredTool, reason: string): void {
		if (surfaceMode === "minimal") return;
		if (mode !== "dynamic" || !deferred.has(tool) || attempted.has(tool)) return;
		attempted.add(tool);
		activationState();
		const active = pi.getActiveTools();
		if (active.includes(tool)) return;
		try {
			pi.setActiveTools([...active, tool]);
			record("tool-activation", "activated", { tool, reason });
			surfaceTelemetry();
		} catch { /* incompatible runtime: fail open and never churn the surface */ }
	}

	function activate(capability: CapabilityName, reason: string): void {
		if (mode === "phase") activateCapability(capability, reason);
		else if (capability === "subagent" || capability === "compact_context") activateDynamic(capability, reason);
	}

	onHarnessSignal(pi.events, (signal) => {
		if (signal.type === "plan/write") {
			lastOpenItems = signal.openItems;
			if (mode === "phase") activate("plan_go", "accepted-plan");
		}
		if (signal.type === "plan/go" && lastOpenItems > 1) activate("subagent", "multi-item-execution");
		if (signal.type === "plan/gate" && !signal.pass && signal.fails >= 2) activate("subagent", "second-gate-failure");
		if (signal.type === "loop/tier" && signal.tier === 2) {
			activate("subagent", signal.detector === "semantic" ? "semantic-tier-two" : "loop-tier-two");
		}
		if (signal.type === "capability/need") activate(signal.capability, signal.reason);
	});

	pi.on("session_start", async () => {
		publish({ mode, surface_mode: surfaceMode, preserved_explicit: false, reason: mode === "phase" ? "phase-start" : surfaceMode === "minimal" ? "minimal-startup" : "dynamic-startup", phase: mode === "phase" ? "phase-aware" : "ambient-or-dynamic" });
		deferred.clear();
		attempted.clear();
		lastOpenItems = 0;
		lastContextPct = 0;
		sessionStartedAt = performance.now();
		firstUsefulMutation = false;
		try { allTools = pi.getAllTools() as any[]; } catch { allTools = []; }
		const active = pi.getActiveTools();
		const baseline = initialToolSurface();
		if (!baseline?.complete) {
			publish({ mode, surface_mode: surfaceMode, preserved_explicit: true, reason: "bootstrap-unavailable", phase: mode === "phase" ? "phase-aware" : "dynamic" });
			for (const tool of mode === "phase" ? phaseDeferredTools(allTools.map((item) => String(item.name))) : DYNAMIC_DEFERRED) {
				record("tool-activation", "preserved-explicit", { tool, reason: "bootstrap-unavailable" });
			}
			surfaceTelemetry();
			return;
		}
		const all = [...baseline.all];
		const initialActive = [...baseline.active];
		const allSet = new Set(all);
		const activeSet = new Set(initialActive);
		const complete = [...BASE_REGISTRY, ...DYNAMIC_DEFERRED].every((name) => allSet.has(name));
		explicit = activeSet.size !== allSet.size || all.some((name) => !activeSet.has(name));
		const deferredNames = mode === "phase" ? phaseDeferredTools(all) : new Set(DYNAMIC_DEFERRED.filter((name) => allSet.has(name)));
		if (!complete || explicit) {
			publish({ mode, surface_mode: surfaceMode, preserved_explicit: true, reason: complete ? "narrowed-tools" : "incomplete-registry", phase: mode === "phase" ? "phase-aware" : "dynamic" });
			for (const tool of deferredNames) record("tool-activation", "preserved-explicit", { tool, reason: complete ? "narrowed-tools" : "incomplete-registry" });
			surfaceTelemetry();
			return;
		}
		if (surfaceMode === "minimal") {
			const minimal = BASE_REGISTRY.filter((name) => allSet.has(name));
			if (minimal.length === BASE_REGISTRY.length) {
				pi.setActiveTools(minimal);
				publish({ mode, surface_mode: surfaceMode, preserved_explicit: false, reason: "minimal-startup", phase: "minimal", deferred: [], attempted: [] });
				surfaceTelemetry();
				return;
			}
			publish({ mode, surface_mode: surfaceMode, preserved_explicit: true, reason: "minimal-incomplete", phase: "minimal" });
			surfaceTelemetry();
			return;
		}
		for (const tool of deferredNames) {
			deferred.add(tool);
			record("tool-activation", "deferred", { tool, reason: mode === "phase" ? "phase-start" : "dynamic-startup" });
		}
		pi.setActiveTools(active.filter((name) => !deferred.has(name)));
		publish({ mode, surface_mode: surfaceMode, preserved_explicit: false, reason: mode === "phase" ? "phase-start" : "dynamic-startup", phase: mode === "phase" ? "phase-aware" : "dynamic", deferred: [...deferred].sort(), attempted: [] });
		surfaceTelemetry();
	});

	pi.on("context", async (_event, ctx) => {
		const pct = ctx.getContextUsage()?.percent;
		if (pct != null && lastContextPct < 60 && pct >= 60) activate("compact_context", "context-60");
		if (pct != null) lastContextPct = pct;
	});

	pi.on("tool_call", async (event) => {
		if (mode === "phase" && deferred.has(event.toolName) && !pi.getActiveTools().includes(event.toolName)) {
			record("tool-activation", "unavailable", { tool: event.toolName, reason: "deferred-capability" });
		}
	});

	pi.on("tool_result", async (event) => {
		if (firstUsefulMutation || event.isError === true || !isMutationResult(event.toolName, event.input)) return;
		firstUsefulMutation = true;
		record("tool-activation", "first-useful-mutation", { elapsed_ms: Math.max(0, Math.round(performance.now() - sessionStartedAt)), tool: event.toolName });
	});
}
