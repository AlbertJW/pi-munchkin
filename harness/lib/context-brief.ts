// Pre-baked environment brief (lemma's agent_context_brief idea): a small
// model burns its cheapest early turns on discovery — ls, find, cat
// package.json — before touching the task. This computes that inventory ONCE,
// deterministically and bounded, so it can ride the system prompt instead.
// Pure: fs access goes through an injectable facade so tests need no mocks of
// node:fs itself.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export type BriefFs = {
	readdir(path: string): string[];
	isDirectory(path: string): boolean;
	readFile(path: string): string;
};

export const realBriefFs: BriefFs = {
	readdir: (path) => readdirSync(path),
	isDirectory: (path) => { try { return statSync(path).isDirectory(); } catch { return false; } },
	readFile: (path) => readFileSync(path, "utf8"),
};

const SKIP_DIRS = new Set(["node_modules", "__pycache__", "dist", "build", "target", "venv"]);
const MAX_TREE_ENTRIES = 40;
const DEFAULT_MAX_BYTES = 2048;

function skippable(name: string): boolean {
	return name.startsWith(".") || SKIP_DIRS.has(name);
}

export function buildBrief(
	cwd: string,
	opts: { maxBytes?: number; gitSummary?: string; fs?: BriefFs } = {},
): { text: string; bytes: number; entries: number; truncated: boolean } {
	const fs = opts.fs ?? realBriefFs;
	const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
	const lines: string[] = [];
	let entries = 0;

	// 1. top-2-level tree: dirs first with file counts, then top-level files —
	// sorted lexicographically for determinism, hard entry cap.
	lines.push("FILES:");
	let top: string[] = [];
	try { top = fs.readdir(cwd).filter((name) => !skippable(name)).sort(); } catch { top = []; }
	for (const name of top) {
		if (entries >= MAX_TREE_ENTRIES) { lines.push("  ...(capped)"); break; }
		const full = join(cwd, name);
		if (fs.isDirectory(full)) {
			let children: string[] = [];
			try { children = fs.readdir(full).filter((child) => !skippable(child)).sort(); } catch { children = []; }
			const files = children.filter((child) => !fs.isDirectory(join(full, child)));
			lines.push(`  ${name}/ (${children.length} entries)`);
			entries += 1;
			for (const child of files.slice(0, 6)) {
				if (entries >= MAX_TREE_ENTRIES) break;
				lines.push(`    ${child}`);
				entries += 1;
			}
		} else {
			lines.push(`  ${name}`);
			entries += 1;
		}
	}

	// 2. package scripts + detected test command
	try {
		const pkg = JSON.parse(fs.readFile(join(cwd, "package.json")));
		const scripts = Object.keys(pkg.scripts ?? {}).sort();
		if (scripts.length) lines.push(`NPM SCRIPTS: ${scripts.join(", ")}`);
		if (pkg.scripts?.test) lines.push(`TEST COMMAND: npm test`);
	} catch {
		// no package.json — check the python convention markers instead
		const markers = top.filter((name) => name === "pytest.ini" || name === "pyproject.toml" || name === "setup.py");
		if (markers.length) lines.push(`TEST COMMAND: python3 -m pytest (detected ${markers[0]})`);
	}

	// 3. git summary — passed in by the extension (computed via pi.exec,
	// fail-open); the lib never shells out.
	if (opts.gitSummary) lines.push(`GIT: ${opts.gitSummary}`);

	// hard byte cap, line-boundary truncation
	let truncated = false;
	const out: string[] = [];
	let size = 0;
	for (const line of lines) {
		const bytes = Buffer.byteLength(line, "utf8") + 1;
		if (size + bytes > maxBytes) { truncated = true; out.push("...[truncated]"); break; }
		out.push(line);
		size += bytes;
	}
	const text = out.join("\n");
	return { text, bytes: Buffer.byteLength(text, "utf8"), entries, truncated };
}
