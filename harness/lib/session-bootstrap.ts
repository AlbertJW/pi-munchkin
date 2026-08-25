import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export type InitialToolSurface = Readonly<{
	active: readonly string[];
	all: readonly string[];
	complete: boolean;
}>;

const BASELINE_FLAG = "__pi_session_initial_tool_surface_v1";

function names(values: unknown): string[] | null {
	if (!Array.isArray(values)) return null;
	const result: string[] = [];
	const seen = new Set<string>();
	for (const value of values) {
		const name = typeof value === "string"
			? value
			: value && typeof value === "object" && typeof (value as { name?: unknown }).name === "string"
				? (value as { name: string }).name
				: null;
		if (!name || seen.has(name)) return null;
		seen.add(name);
		result.push(name);
	}
	return result;
}

/**
 * Capture the registry before any later session_start handler can narrow it.
 *
 * First capture wins for the process lifetime. Pi re-emits session_start on
 * /reload (and `pi update --extensions` reloads), and reload rebuilds the
 * runtime from the CURRENT active set — i.e. the surface this harness already
 * narrowed. Re-capturing there made the classifier read the harness's own
 * core-profile narrowing as an explicit user allowlist, which blocked /plan
 * ("the explicit tool selection excludes plan_write") — observed live
 * 2026-08-25 on a package-installed deployment. A fresh process always gets a
 * true default baseline (initialActiveToolNames never comes from persisted
 * session state), so first-wins is sufficient.
 */
export function captureInitialToolSurface(pi: ExtensionAPI): InitialToolSurface {
	const existing = initialToolSurface();
	if (existing) return existing;
	let active: string[] | null = null;
	let all: string[] | null = null;
	try {
		active = names(pi.getActiveTools());
		all = names(pi.getAllTools());
	} catch {
		// An older/incomplete Pi surface is preserved rather than guessed at.
	}
	const allSet = new Set(all ?? []);
	const complete = active !== null && all !== null && all.length > 0 && active.every((name) => allSet.has(name));
	const baseline = Object.freeze({
		active: Object.freeze([...(active ?? [])]),
		all: Object.freeze([...(all ?? [])]),
		complete,
	});
	(globalThis as Record<string, unknown>)[BASELINE_FLAG] = baseline;
	return baseline;
}

export function initialToolSurface(): InitialToolSurface | null {
	const value = (globalThis as Record<string, unknown>)[BASELINE_FLAG];
	if (!value || typeof value !== "object") return null;
	return value as InitialToolSurface;
}
