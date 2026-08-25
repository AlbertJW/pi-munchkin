import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { agentDir } from "../lib/agent-dir.ts";
import { measureActiveSurface } from "../lib/capability-surface.ts";
import { classifyBashCommand } from "../lib/command-policy.ts";
import { record } from "../lib/telemetry.ts";
import { initialToolSurface } from "../lib/session-bootstrap.ts";
import { onHarnessSignal } from "../lib/harness-signals.ts";

type Profile = "ambient" | "core";
type LegacyMode = "ambient" | "dynamic" | "phase";
const PLAN_GRAPH_ENABLED = process.env.PLAN_GRAPH === "on";
const DEEP_RESEARCH_PLANNING_ENABLED = PLAN_GRAPH_ENABLED && process.env.DEEP_RESEARCH_PLANNING === "on";
type Family = "research" | "delegation" | "browser" | "canvas" | "context" | "planning";

export const MUNCHKIN_TOOL_PROFILE_DEFAULT: Profile = "core";
const CORE_NAMES = new Set([
	"read", "bash", "edit", "write", "search_spans", "read_span", "recall",
	"verify_project", "capability", "plan_write", "plan_update",
]);
const PI_OPTIONAL_DEFAULTS = new Set(["grep", "find", "ls"]);
const EXPLICIT_FLAG = "__pi_tool_selection_explicit";

function profileFromEnvironment(): Profile {
	if (process.env.MUNCHKIN_TOOL_PROFILE === "core" || process.env.MUNCHKIN_TOOL_SURFACE === "minimal") return "core";
	return MUNCHKIN_TOOL_PROFILE_DEFAULT;
}

function legacyMode(): LegacyMode {
	const value = process.env.MUNCHKIN_TOOL_ACTIVATION;
	return value === "ambient" || value === "phase" ? value : "dynamic";
}

function commandLineIsExplicit(argv: readonly string[] = process.argv): boolean {
	return argv.some((arg) => ["--tools", "--exclude-tools", "--no-tools", "--no-builtin-tools"].includes(arg) ||
		arg.startsWith("--tools=") || arg.startsWith("--exclude-tools="));
}

async function settingsAreExplicit(cwd: string): Promise<boolean> {
	for (const path of [join(agentDir(), "settings.json"), join(cwd, ".pi", "settings.json")]) {
		try {
			const value = JSON.parse(await readFile(path, "utf8"));
			if (Array.isArray(value?.defaultTools)) return true;
		} catch { /* absent or malformed settings are not evidence of explicit intent */ }
	}
	return false;
}

export function baselineLooksExplicit(active: readonly string[], all: readonly string[], argv: readonly string[] = process.argv): boolean {
	if (commandLineIsExplicit(argv)) return true;
	const activeSet = new Set(active);
	return all.some((name) => !activeSet.has(name) && !PI_OPTIONAL_DEFAULTS.has(name));
}

function familyTools(family: Family, all: readonly string[]): string[] {
	switch (family) {
		case "research": return all.filter((name) => name === "web_search" || name === "web_read");
		case "delegation": return all.filter((name) => name === "subagent");
		case "browser": return all.filter((name) => name.startsWith("browser_"));
		case "canvas": return all.filter((name) => name.startsWith("tldraw_"));
		case "context": return all.filter((name) => name === "compact_context");
		case "planning": return DEEP_RESEARCH_PLANNING_ENABLED
			? all.filter((name) => ["research_plan_start", "plan_write", "plan_update", "plan_expand", "plan_settle"].includes(name)) : [];
	}
}

function isMutationResult(toolName: string, input: unknown): boolean {
	if (toolName === "edit" || toolName === "write") return true;
	if (toolName !== "bash") return false;
	return classifyBashCommand(String((input as { command?: unknown } | undefined)?.command ?? "")).mutates;
}

export default function (pi: ExtensionAPI): void {
	const profile = profileFromEnvironment();
	const activationMode = legacyMode();
	const g = globalThis as Record<string, unknown>;
	let allTools: any[] = [];
	let allNames: string[] = [];
	let explicit = false;
	let deferred = new Set<string>();
	let attempted = new Set<Family>();
	let lastOpenItems = 0;
	let lastContextPct = 0;
	let firstUsefulMutation = false;
	let sessionStartedAt = 0;

	const publish = (reason: string) => {
		g.__pi_tool_activation_state = {
			profile, mode: activationMode, preserved_explicit: explicit, reason,
			deferred: [...deferred].sort(), attempted: [...attempted].sort(),
		};
		g[EXPLICIT_FLAG] = explicit;
	};

	const surfaceTelemetry = () => {
		const active = pi.getActiveTools();
		const measured = measureActiveSurface(allTools, active);
		record("tool-activation", "surface", {
			mode: activationMode, surface_mode: profile, active_tools: active.length, all_tools: allTools.length,
			schema_bytes: measured.schemaBytes, guideline_bytes: measured.guidelineBytes,
			deferred_tools: deferred.size, unavailable_attempts: 0,
		});
	};

	const activateFamily = (family: Family, reason: string): { activated: number; status: string } => {
		if (attempted.has(family)) return { activated: 0, status: "already-attempted-or-manually-disabled" };
		attempted.add(family);
		if (g.__pi_plan_phase_active === true && family !== "research") {
			publish("planning-restriction");
			return { activated: 0, status: "planning-allows-research-only" };
		}
		const names = familyTools(family, allNames);
		const allowed = explicit ? names.filter((name) => initialToolSurface()?.active.includes(name)) : names;
		const active = pi.getActiveTools();
		const add = allowed.filter((name) => deferred.has(name) && !active.includes(name));
		if (!add.length) {
			publish(explicit ? "preserved-explicit" : "unavailable-or-active");
			return { activated: 0, status: explicit ? "preserved-explicit" : "unavailable-or-active" };
		}
		try {
			pi.setActiveTools([...active, ...add]);
			for (const name of add) {
				deferred.delete(name);
				record("tool-activation", "activated", { tool: name, reason });
			}
			publish("activated");
			surfaceTelemetry();
			return { activated: add.length, status: "activated" };
		} catch {
			publish("activation-failed");
			return { activated: 0, status: "activation-failed" };
		}
	};

	pi.registerTool(defineTool({
		name: "capability",
		label: "Capability Switch",
		description: "Enable one specialist tool family for this session, or report bounded family status.",
		promptSnippet: `capability: enable research, delegation, browser, canvas, context${DEEP_RESEARCH_PLANNING_ENABLED ? ", or planning" : ""} tools only when needed`,
		parameters: Type.Object({
			action: Type.Union([Type.Literal("enable"), Type.Literal("status")]),
			family: Type.Optional(Type.Union([
				Type.Literal("research"), Type.Literal("delegation"), Type.Literal("browser"),
				Type.Literal("canvas"), Type.Literal("context"),
				...(DEEP_RESEARCH_PLANNING_ENABLED ? [Type.Literal("planning")] : []),
			])),
		}),
		async execute(_toolCallId, params) {
			if (params.action === "enable" && !params.family) throw new Error("capability: family is required for enable");
			const result = params.action === "enable" ? activateFamily(params.family as Family, "model-request") : null;
			const activeFamilies = (["research", "delegation", "browser", "canvas", "context", ...(DEEP_RESEARCH_PLANNING_ENABLED ? ["planning" as const] : [])] as Family[])
				.filter((family) => familyTools(family, allNames).some((name) => pi.getActiveTools().includes(name)));
			return {
				content: [{ type: "text" as const, text: JSON.stringify({ profile, explicit, active_families: activeFamilies, result }) }],
				details: { tool_name: "capability", success: result?.status !== "activation-failed" },
			};
		},
	}));

	onHarnessSignal(pi.events, (signal) => {
		if (signal.type === "plan/write") lastOpenItems = signal.openItems;
		if (signal.type === "plan/go" && lastOpenItems > 1) activateFamily("delegation", "multi-item-execution");
		if (signal.type === "loop/tier" && signal.tier === 2) activateFamily("delegation", signal.detector === "semantic" ? "semantic-tier-two" : "loop-tier-two");
		if (signal.type === "capability/need") {
			if (signal.capability === "subagent") activateFamily("delegation", signal.reason);
			if (signal.capability === "compact_context") activateFamily("context", signal.reason);
			if (signal.capability === "web_read") activateFamily("research", signal.reason);
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		deferred = new Set();
		attempted = new Set();
		lastOpenItems = 0;
		lastContextPct = 0;
		firstUsefulMutation = false;
		sessionStartedAt = performance.now();
		try { allTools = pi.getAllTools() as any[]; } catch { allTools = []; }
		allNames = allTools.map((tool) => String(tool.name));
		const baseline = initialToolSurface();
		if (!baseline?.complete) {
			explicit = true;
			publish("bootstrap-unavailable");
			surfaceTelemetry();
			return;
		}
		explicit = baselineLooksExplicit(baseline.active, baseline.all) || await settingsAreExplicit(ctx.cwd);
		publish(explicit ? "preserved-explicit" : "startup");
		if (explicit) {
			for (const family of ["research", "delegation", "browser", "canvas", "context", ...(DEEP_RESEARCH_PLANNING_ENABLED ? ["planning" as const] : [])] as Family[]) {
				for (const tool of familyTools(family, allNames)) record("tool-activation", "preserved-explicit", { tool, reason: "explicit-tools" });
			}
			surfaceTelemetry();
			return;
		}

		const active = pi.getActiveTools();
		if (profile === "core") {
			const activePlan = Boolean(g.__pi_active_plan_context);
			const core = active.filter((name) => CORE_NAMES.has(name) && (activePlan || (name !== "plan_write" && name !== "plan_update")));
			deferred = new Set(active.filter((name) => !core.includes(name)));
			if (DEEP_RESEARCH_PLANNING_ENABLED) for (const name of familyTools("planning", allNames)) if (!core.includes(name)) deferred.add(name);
			pi.setActiveTools(core);
			for (const name of deferred) record("tool-activation", "deferred", { tool: name, reason: "core-startup" });
			publish("core-startup");
			surfaceTelemetry();
			return;
		}

		if (activationMode !== "ambient") {
			for (const name of ["subagent", "compact_context"]) if (active.includes(name)) deferred.add(name);
			pi.setActiveTools(active.filter((name) => !deferred.has(name)));
			for (const name of deferred) record("tool-activation", "deferred", { tool: name, reason: "dynamic-startup" });
		}
		publish(activationMode === "ambient" ? "ambient-startup" : "dynamic-startup");
		surfaceTelemetry();
	});

	pi.on("context", async (_event, ctx) => {
		const pct = ctx.getContextUsage()?.percent;
		if (pct != null && lastContextPct < 60 && pct >= 60) activateFamily("context", "context-60");
		if (pct != null) lastContextPct = pct;
	});

	pi.on("tool_result", async (event) => {
		if (firstUsefulMutation || event.isError || !isMutationResult(event.toolName, event.input)) return;
		firstUsefulMutation = true;
		record("tool-activation", "first-useful-mutation", { elapsed_ms: Math.max(0, Math.round(performance.now() - sessionStartedAt)), tool: event.toolName });
	});
}
