// did-you-mean — deterministic closest-existing-path suggestion for a failed
// file access. Pure filesystem lookup, no model call: the agent-facing version
// of "if a file seems missing, look around first" (the prose anchor treats the
// wandering; this removes the trigger). Suggests only when UNambiguous.

import { access, readdir } from "node:fs/promises";
import { dirname, join, basename } from "node:path";

const MAX_DISTANCE = 2;
const MAX_COMPONENT = 128;
const MAX_SIBLINGS = 512;
const MAX_WALK_ENTRIES = 2048;

function editDistanceAtMost2(a: string, b: string): number {
	if (a.length > MAX_COMPONENT || b.length > MAX_COMPONENT || Math.abs(a.length - b.length) > MAX_DISTANCE) return MAX_DISTANCE + 1;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const next = Array(b.length + 1).fill(MAX_DISTANCE + 1);
		next[0] = i;
		const from = Math.max(1, i - MAX_DISTANCE);
		const to = Math.min(b.length, i + MAX_DISTANCE);
		let rowMin = MAX_DISTANCE + 1;
		for (let j = from; j <= to; j++) {
			next[j] = Math.min(next[j - 1] + 1, prev[j] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
			rowMin = Math.min(rowMin, next[j]);
		}
		if (rowMin > MAX_DISTANCE) return MAX_DISTANCE + 1;
		prev = next;
	}
	return prev[b.length];
}

/** Closest existing path for a missing `attempted` (relative to cwd, or absolute).
 *  Strategy, all deterministic:
 *   1. parent dir exists → unique near-basename sibling (edit distance ≤ 2, sole winner)
 *   2. unique exact-basename match within 2 directory levels of cwd
 *  Ambiguity or no candidate → null (never guess). */
export async function closestExistingPath(cwd: string, attempted: string): Promise<string | null> {
	const abs = attempted.startsWith("/") ? attempted : join(cwd, attempted);
	try { await access(abs); return null; } catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
	}
	const want = basename(abs);
	if (want.length > MAX_COMPONENT) return null;

	const parent = dirname(abs);
	try {
		const entries = (await readdir(parent)).filter((e) => !e.startsWith("."));
		if (entries.length > MAX_SIBLINGS) return null;
		const scored = entries
			.map((e) => ({ e, d: editDistanceAtMost2(want.toLowerCase(), e.toLowerCase()) }))
			// d may be 0 for a case-only slip (Util.js vs util.js) — keep it as long as
			// the raw name differs; identical raw names can't be here (file would exist).
			.filter((x) => x.e !== want && x.d <= 2)
			.sort((a, b) => a.d - b.d);
		if (scored.length > 0 && (scored.length === 1 || scored[0].d < scored[1].d)) {
			const rel = join(parent, scored[0].e);
			return rel.startsWith(cwd + "/") ? rel.slice(cwd.length + 1) : rel;
		}
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null;
	}

	// exact basename elsewhere, shallow walk
	const hits: string[] = [];
	const queue: Array<{ dir: string; depth: number }> = [{ dir: "", depth: 0 }];
	let visited = 0;
	while (queue.length && hits.length <= 1) {
		const current = queue.shift()!;
		let entries;
		try { entries = await readdir(join(cwd, current.dir), { withFileTypes: true }); } catch { return null; }
		visited += entries.length;
		if (visited > MAX_WALK_ENTRIES) return null;
		for (const entry of entries) {
			if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
			const rel = current.dir ? `${current.dir}/${entry.name}` : entry.name;
			if (entry.isDirectory() && current.depth < 2) queue.push({ dir: rel, depth: current.depth + 1 });
			else if (!entry.isDirectory() && entry.name === want) hits.push(rel);
		}
	}
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
