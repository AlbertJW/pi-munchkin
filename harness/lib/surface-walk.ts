// Shared first-party-surface discovery: walks the relative-import graph starting
// from a harness's extension entry points, and hashes the resulting file set
// deterministically. Extracted from scripts/package-smoke.mjs's inline walker so
// scripts/surface-hash.ts (the loaded-surface receipt's launcher-side hasher) uses
// the exact same logic package-smoke.mjs already relies on to prove a packed
// tarball can't load from the checkout while a transitive source file is missing.
//
// Scope is deliberately narrow: only `./`/`../` imports are followed — third-party
// npm packages are pinned by package-lock and out of scope for this hash, matching
// what package-smoke.mjs's own walk already does.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const RELATIVE_IMPORT = /(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g;

/** Follow every relative import from each entry point. Returns absolute paths,
 * entry points included. */
export async function walkRelativeImports(entryPoints: string[]): Promise<Set<string>> {
	const pending = entryPoints.slice();
	const visited = new Set<string>();
	while (pending.length) {
		const sourcePath = pending.pop();
		if (!sourcePath || visited.has(sourcePath)) continue;
		visited.add(sourcePath);
		const source = await readFile(sourcePath, "utf8");
		for (const match of source.matchAll(RELATIVE_IMPORT)) {
			let imported = resolve(dirname(sourcePath), match[1]);
			if (!existsSync(imported) && imported.endsWith(".js") && existsSync(`${imported.slice(0, -3)}.ts`)) {
				imported = `${imported.slice(0, -3)}.ts`;
			}
			if (existsSync(imported)) pending.push(imported);
		}
	}
	return visited;
}

type PackageManifest = { pi?: { extensions?: string[] } };

/** Entry points for a live agent-dir install (no package.json there): every
 * top-level extensions/*.ts (matching pi's directory-scan auto-load), plus each
 * non-`npm:`-prefixed settings.json `packages` entry's own package.json
 * `pi.extensions`. `npm:`-prefixed packages are skipped — third-party, out of
 * scope, same boundary as walkRelativeImports never crossing bare specifiers. */
export async function discoverEntryPoints(agentDir: string): Promise<string[]> {
	const extDir = join(agentDir, "extensions");
	const extFiles = (await readdir(extDir)).filter((f) => f.endsWith(".ts"));
	const entries = extFiles.map((f) => join(extDir, f));

	const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] };
	for (const pkg of settings.packages ?? []) {
		if (pkg.startsWith("npm:")) continue;
		const pkgDir = join(agentDir, pkg);
		const manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as PackageManifest;
		for (const ext of manifest.pi?.extensions ?? []) entries.push(resolve(pkgDir, ext));
	}
	return entries;
}

/** sha256 over sorted relative-path + NUL + bytes + NUL, so the digest is
 * reproducible across machines/checkouts as long as relative layout + contents
 * match — independent of $HOME or checkout location. */
export async function hashSurface(baseDir: string, files: Iterable<string>): Promise<string> {
	const relPaths = Array.from(files, (f) => relative(baseDir, f).split("\\").join("/")).sort();
	const hash = createHash("sha256");
	for (const relPath of relPaths) {
		const bytes = await readFile(join(baseDir, relPath));
		hash.update(relPath, "utf8");
		hash.update("\0");
		hash.update(bytes);
		hash.update("\0");
	}
	return hash.digest("hex");
}
