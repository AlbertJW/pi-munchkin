import type { CapabilityName } from "./harness-signals.ts";

export type CapabilityTool = {
	name: string;
	parameters?: unknown;
	promptSnippet?: unknown;
	promptGuidelines?: unknown;
};

export const PHASE_CAPABILITY_TOOLS: Readonly<Record<CapabilityName, readonly string[]>> = {
	plan_go: ["plan_go"],
	span_tools: ["search_spans", "read_span"],
	subagent: ["subagent"],
	compact_context: ["compact_context"],
	web_read: ["web_read"],
};

export function phaseDeferredTools(allNames: Iterable<string>): Set<string> {
	const all = new Set(allNames);
	return new Set(Object.values(PHASE_CAPABILITY_TOOLS).flat().filter((name) => all.has(name)));
}

function bytes(value: unknown): number {
	try {
		return Buffer.byteLength(typeof value === "string" ? value : JSON.stringify(value ?? "") ?? "", "utf8");
	} catch { return 0; }
}

/** Measure only what is active; inactive schemas and prompt guidance contribute zero. */
export function measureActiveSurface(tools: CapabilityTool[], activeNames: Iterable<string>): {
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
