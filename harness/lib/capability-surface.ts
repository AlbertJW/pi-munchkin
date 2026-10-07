
export type CapabilityTool = {
	name: string;
	parameters?: unknown;
	promptSnippet?: unknown;
	promptGuidelines?: unknown;
};

/**
 * The plan tools plan-runner hides from the ordinary execution surface at
 * session_start. It lives here, not in either extension, because BOTH sides of the
 * handoff need it and tool-activation cannot import plan-runner (plan-runner
 * already imports CORE_NAMES from tool-activation — the other direction is a cycle).
 *
 * It was previously a literal repeated at seven sites across plan-runner and
 * tool-activation, in three different subsets. The subsets drifted: plan-runner hid
 * six names while tool-activation's recovery pool re-seeded two, so `plan_go`,
 * `plan_expand` and `plan_settle` were registered, stripped at startup, absent from
 * every deferred pool, and permanently uncallable whenever their flags were on.
 */
export const PLAN_SURFACE_TOOLS: readonly string[] = [
	"plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start",
	"research_finish",
];

/** The two flat plan tools any session may hold, graph flags or not. */
export const FLAT_PLAN_TOOLS: readonly string[] = ["plan_write", "plan_update"];

function bytes(value: unknown): number {
	try {
		return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? "") ?? "", "utf8");
	} catch { return 0; }
}

/** Measure only what is active; inactive schemas and prompt guidance contribute zero. */
export function measureActiveSurface(tools: readonly CapabilityTool[], activeNames: Iterable<string>): {
	schemaBytes: number;
	guidelineBytes: number;
} {
	const active = new Set(activeNames);
	let schemaBytes = 0;
	let guidelineBytes = 0;
	for (const tool of tools) {
		if (!active.has(tool.name)) continue;
		schemaBytes += bytes(tool.parameters);
		guidelineBytes += bytes(tool.promptSnippet) + bytes(tool.promptGuidelines);
	}
	return { schemaBytes, guidelineBytes };
}

export type CapabilityFamily = "research" | "delegation" | "browser" | "canvas" | "context" | "planning" | "goals" | "vision";
export const CORE_TOOL_NAMES: readonly string[] = ["read", "bash", "edit", "write", "search_spans", "read_span", "recall", "obs_recall", "verify_project", "capability", "plan_write", "plan_update"];
const FAMILY_NAMES: Record<Exclude<CapabilityFamily, "browser" | "canvas">, readonly string[]> = {
 research: ["web_search", "web_read"], delegation: ["subagent"], context: ["compact_context"], planning: PLAN_SURFACE_TOOLS,
 goals: ["goal_propose", "goal_inspect", "goal_update", "goal_settle", "goal_block"], vision: ["visual_observe", "visual_refine_target"],
};
/** Registration is the authority; this never activates an unregistered or excluded tool. */
export function capabilityTools(family: CapabilityFamily, registered: readonly string[]): string[] {
 return registered.filter(name => family === "browser" ? name.startsWith("browser_") : family === "canvas" ? name.startsWith("tldraw_") : FAMILY_NAMES[family].includes(name));
}
export function capabilityRoster(registered: readonly CapabilityTool[], activeNames: readonly string[]) {
 const active = new Set(activeNames);
 return Object.fromEntries((["research", "delegation", "browser", "canvas", "context", "planning", "goals", "vision"] as const).map(family => {
  const names = capabilityTools(family, registered.map(tool => tool.name));
  return [family, { registered: names, active: names.filter(name => active.has(name)), ...measureActiveSurface(registered, names.filter(name => active.has(name))) }];
 }));
}
