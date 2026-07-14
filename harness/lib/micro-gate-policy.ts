// micro-gate-policy: pure logic for the post-edit micro-gate (c21).
// After a turn that mutated source files, run the CHEAPEST deterministic check
// on just the changed files and surface the FIRST actionable error — never the
// full test suite. Motivated by the gauntlet baseline: an unnoticed bad edit
// (edit-noop fault) cost the 4B 9 turns / ~16k tokens of flailing; a parse
// check would have surfaced it in one observation.

export type Check = { file: string; kind: "node" | "python" | "json" };

const CHECKERS: Record<string, Check["kind"]> = {
	".js": "node",
	".mjs": "node",
	".cjs": "node",
	".py": "python",
	".json": "json",
};

const HEADER_RE = /\[([^\[\]#\n]+)#[0-9A-Za-z-]+\]/g;

// Paths a single edit-style tool call mutates: hashline input headers, or the
// builtin edit/write path argument.
export function changedPaths(toolName: string, input: unknown): string[] {
	if (!input || typeof input !== "object") return [];
	const args = input as Record<string, unknown>;
	if (toolName === "edit" && typeof args.input === "string") {
		const out = new Set<string>();
		for (const m of args.input.matchAll(HEADER_RE)) out.add(m[1]);
		if (out.size) return [...out];
	}
	if (toolName === "bash" && typeof args.command === "string") {
		// Conservative shell mutation coverage. Capture explicit source/config
		// paths from common in-place writes; do not pretend arbitrary scripts are
		// statically knowable.
		const cmd = args.command;
		if (!/(?:\bsed\s+-[^\n;]*i|\bperl\s+-[^\n;]*i|\btee\b|>>?|\bmv\b|\bcp\b)/.test(cmd)) return [];
		const out = new Set<string>();
		for (const m of cmd.matchAll(/(?:^|[\s'"=])([^\s'";|<>]+\.(?:[cm]?js|py|json))(?:$|[\s'";|])/g)) out.add(m[1]);
		return [...out];
	}
	if (typeof args.path === "string" && args.path) return [args.path];
	return [];
}

// The checks for one turn's changed files: dedup, checkable extensions only,
// bounded to `cap` files (cheapest-first is meaningless at n<=3; keep order).
export function checksFor(paths: string[], cap = 3): Check[] {
	const seen = new Set<string>();
	const out: Check[] = [];
	for (const p of paths) {
		if (seen.has(p)) continue;
		seen.add(p);
		const ext = p.slice(p.lastIndexOf("."));
		const kind = CHECKERS[ext];
		if (kind) out.push({ file: p, kind });
		if (out.length >= cap) break;
	}
	return out;
}

// First actionable error, bounded — the model needs the location, not a wall.
export function firstError(outputs: Array<{ file: string; err: string }>): string | null {
	for (const { file, err } of outputs) {
		const t = err.trim();
		if (t) return `${file}: ${t.split("\n").slice(0, 6).join("\n").slice(0, 600)}`;
	}
	return null;
}
