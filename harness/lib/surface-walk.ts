// Shared first-party-surface discovery: walks the relative-import graph starting
// from a harness's extension entry points, and hashes the resulting file set
// deterministically. Extracted from scripts/package-smoke.mjs's inline walker so
// scripts/surface-hash.ts (the loaded-surface receipt's launcher-side hasher) uses
// the exact same logic package-smoke.mjs already relies on to prove a packed
// tarball can't load from the checkout while a transitive source file is missing.
//
// walkRelativeImports itself stays narrow — only `./`/`../` imports are followed,
// matching package-smoke.mjs's own walk, since that function also serves the
// first-party-tarball-completeness check where crossing into node_modules would be
// wrong. Active npm: packages are real, behavior-bearing, loaded code, though — for
// surface-hash.ts's purpose (proving what a gate session actually ran), excluding
// them entirely would be unsafe. discoverEntryPoints/hashSurface below fold their
// LOCKFILE identity (name/version/resolved/integrity — what npm itself already
// promises) into the surface hash, and fail closed (throw) if any active npm:
// package can't be resolved against the lockfile, rather than silently omitting it.

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

export type NpmPackageIdentity = { name: string; version: string; resolved: string; integrity: string };
type LockPackageEntry = { version?: string; resolved?: string; integrity?: string };
type PackageLock = { packages?: Record<string, LockPackageEntry> };

/** Resolve an `npm:`-prefixed settings.json package spec (e.g.
 * "npm:pi-rtk-optimizer@0.9.0") against `<agentDir>/npm/package-lock.json` — the
 * lockfile is the same trust boundary npm itself uses, so this proves PINNED
 * identity (what the lockfile promises), not that on-disk node_modules matches it
 * byte-for-byte. Throws (fail closed) on any missing/unusable lockfile or entry —
 * a partial surface hash must never look complete. */
export async function resolveNpmPackageIdentity(agentDir: string, packageSpec: string): Promise<NpmPackageIdentity> {
	const bare = packageSpec.slice("npm:".length).replace(/@[^@]+$/, "");
	const lockPath = join(agentDir, "npm", "package-lock.json");
	let lock: PackageLock;
	try {
		lock = JSON.parse(await readFile(lockPath, "utf8"));
	} catch (err) {
		throw new Error(`npm lockfile unreadable at ${lockPath} for ${packageSpec}: ${err instanceof Error ? err.message : String(err)}`);
	}
	const entry = lock.packages?.[`node_modules/${bare}`];
	if (!entry?.resolved || !entry?.integrity) {
		throw new Error(`no usable lockfile identity (resolved+integrity) for ${packageSpec} in ${lockPath}`);
	}
	return { name: bare, version: entry.version ?? "", resolved: entry.resolved, integrity: entry.integrity };
}

/** Entry points for a live agent-dir install (no package.json there): every
 * top-level extensions/*.ts (matching pi's directory-scan auto-load), plus each
 * non-`npm:`-prefixed settings.json `packages` entry's own package.json
 * `pi.extensions`, plus every `agents/*.md` role prompt (read by plan-weaver.ts's
 * agentPromptPath and appended as each child's system prompt — behavior-bearing,
 * but not `.ts`/`.js` so walkRelativeImports's regex can never reach them; added
 * as leaves directly, no import-walking needed). Each `npm:`-prefixed entry
 * resolves to a lockfile-pinned identity instead (see resolveNpmPackageIdentity)
 * — never silently skipped. `agents/` is optional (matches agentPromptPath's own
 * existsSync-or-null treatment of individual role files) — a missing directory
 * contributes nothing rather than failing closed, since there's no declared list
 * of expected role prompts to fail against. */
export async function discoverEntryPoints(agentDir: string): Promise<{ entries: string[]; npmIdentities: NpmPackageIdentity[] }> {
	const extDir = join(agentDir, "extensions");
	const extFiles = (await readdir(extDir)).filter((f) => f.endsWith(".ts"));
	const entries = extFiles.map((f) => join(extDir, f));

	const agentsDir = join(agentDir, "agents");
	try {
		const mdFiles = (await readdir(agentsDir)).filter((f) => f.endsWith(".md"));
		for (const f of mdFiles) entries.push(join(agentsDir, f));
	} catch {
		// no agents/ dir — role prompts are optional, nothing to add
	}

	const npmIdentities: NpmPackageIdentity[] = [];
	const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] };
	for (const pkg of settings.packages ?? []) {
		if (pkg.startsWith("npm:")) {
			npmIdentities.push(await resolveNpmPackageIdentity(agentDir, pkg));
			continue;
		}
		const pkgDir = join(agentDir, pkg);
		const manifest = JSON.parse(await readFile(join(pkgDir, "package.json"), "utf8")) as PackageManifest;
		for (const ext of manifest.pi?.extensions ?? []) entries.push(resolve(pkgDir, ext));
	}
	return { entries, npmIdentities };
}

/** sha256 over sorted relative-path + NUL + bytes + NUL (files), then sorted
 * npm identities, so the digest is reproducible across machines/checkouts as long
 * as relative layout + contents + pinned npm identities match — independent of
 * $HOME or checkout location. */
export async function hashSurface(baseDir: string, files: Iterable<string>, npmIdentities: NpmPackageIdentity[] = []): Promise<string> {
	const relPaths = Array.from(files, (f) => relative(baseDir, f).split("\\").join("/")).sort();
	const hash = createHash("sha256");
	for (const relPath of relPaths) {
		const bytes = await readFile(join(baseDir, relPath));
		hash.update(relPath, "utf8");
		hash.update("\0");
		hash.update(bytes);
		hash.update("\0");
	}
	for (const pkg of [...npmIdentities].sort((a, b) => a.name.localeCompare(b.name))) {
		hash.update(`npm:${pkg.name}`, "utf8");
		hash.update("\0");
		hash.update(`${pkg.version}|${pkg.resolved}|${pkg.integrity}`, "utf8");
		hash.update("\0");
	}
	return hash.digest("hex");
}
