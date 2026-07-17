// did-you-mean — deterministic closest-existing-path suggestion for a failed
// file access. Pure filesystem lookup, no model call: the agent-facing version
// of "if a file seems missing, look around first" (the prose anchor treats the
// wandering; this removes the trigger). Suggests only when UNambiguous.

import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join, basename } from "node:path";

function editDistance(a: string, b: string): number {
	const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
	for (let j = 1; j <= b.length; j++) dp[0][j] = j;
	for (let i = 1; i <= a.length; i++)
		for (let j = 1; j <= b.length; j++)
			dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
	return dp[a.length][b.length];
}

/** Closest existing path for a missing `attempted` (relative to cwd, or absolute).
 *  Strategy, all deterministic:
 *   1. parent dir exists → unique near-basename sibling (edit distance ≤ 2, sole winner)
 *   2. unique exact-basename match within 2 directory levels of cwd
 *  Ambiguity or no candidate → null (never guess). */
export function closestExistingPath(cwd: string, attempted: string): string | null {
	const abs = attempted.startsWith("/") ? attempted : join(cwd, attempted);
	if (existsSync(abs)) return null; // not actually missing — nothing to suggest
	const want = basename(abs);

	const parent = dirname(abs);
	if (existsSync(parent)) {
		let entries: string[] = [];
		try { entries = readdirSync(parent).filter((e) => !e.startsWith(".")); } catch { /* ignore */ }
		const scored = entries
			.map((e) => ({ e, d: editDistance(want.toLowerCase(), e.toLowerCase()) }))
			// d may be 0 for a case-only slip (Util.js vs util.js) — keep it as long as
			// the raw name differs; identical raw names can't be here (file would exist).
			.filter((x) => x.e !== want && x.d <= 2)
			.sort((a, b) => a.d - b.d);
		if (scored.length > 0 && (scored.length === 1 || scored[0].d < scored[1].d)) {
			const rel = join(parent, scored[0].e);
			return rel.startsWith(cwd + "/") ? rel.slice(cwd.length + 1) : rel;
		}
	}

	// exact basename elsewhere, shallow walk (same rule as plan-contract normalizeInput)
	const hits: string[] = [];
	const walk = (dir: string, depth: number) => {
		if (depth > 2 || hits.length > 1) return;
		let entries: string[] = [];
		try { entries = readdirSync(join(cwd, dir)); } catch { return; }
		for (const e of entries) {
			if (e.startsWith(".") || e === "node_modules") continue;
			const rel = dir ? `${dir}/${e}` : e;
			try {
				if (statSync(join(cwd, rel)).isDirectory()) walk(rel, depth + 1);
				else if (e === want) hits.push(rel);
			} catch { /* ignore */ }
		}
	};
	walk("", 0);
	return hits.length === 1 ? hits[0] : null;
}

/** Extract the attempted path from a read/edit failure. */
export function attemptedPathFrom(toolName: string, input: unknown, errorText: string): string | null {
	const p = (input as { path?: unknown })?.path;
	if (typeof p === "string" && p) return p;
	if (toolName === "edit") {
		// hashline: "file not found: <disp>. Use the file's real relative path…" —
		// the path itself contains dots, so capture up to a period-then-space or end.
		const m = errorText.match(/file not found:\s*(.+?)(?:\.\s|$)/i);
		if (m) return m[1];
	}
	const m2 = errorText.match(/ENOENT[^']*'([^']+)'/);
	return m2 ? m2[1] : null;
}
