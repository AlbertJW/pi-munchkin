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
import { readdir, readFile, stat } from "node:fs/promises";
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

export type SurfaceDescriptor = {
	/** Absolute extension entry points in the exact order Pi will load them. */
	orderedEntryPoints: readonly string[];
	/** Absolute behavior- and prompt-bearing files. Ordering is intentionally ignored. */
	files: Iterable<string>;
	npmIdentities?: readonly NpmPackageIdentity[];
};

/** Every regular file below `dir`, recursively; empty if the directory is absent.
 * Deliberately NOT limited to .md: skill directories carry executable scripts
 * (e.g. lavish-review's render-plan.mjs) whose behavior is part of the surface —
 * an .md-only walk let a script change slip through without a new boundary. */
export async function walkPromptFiles(dir: string): Promise<string[]> {
	let names: import("node:fs").Dirent[];
	try {
		names = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const files: string[] = [];
	for (const entry of names.sort((a, b) => a.name.localeCompare(b.name))) {
		const child = join(dir, entry.name);
		if (entry.isDirectory()) files.push(...await walkPromptFiles(child));
		else if (entry.isFile()) files.push(child);
	}
	return files;
}

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

async function resolveExtensionDirectory(dir: string): Promise<string[]> {
	const packageJson = join(dir, "package.json");
	if (existsSync(packageJson)) {
		try {
			const manifest = JSON.parse(await readFile(packageJson, "utf8")) as PackageManifest;
			const declared = (manifest.pi?.extensions ?? [])
				.map((entry) => resolve(dir, entry))
				.filter((entry) => existsSync(entry));
			if (declared.length) return declared;
		} catch {
			// Pi also ignores an unreadable package manifest and falls back to index.
		}
	}
	for (const name of ["index.ts", "index.js"]) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return [candidate];
	}
	return [];
}

/** Reproduce Pi's one-level extension-directory discovery, including its native
 * readdir order and package-manifest-before-index precedence. */
export async function discoverExtensionEntriesInDir(dir: string): Promise<string[]> {
	let children: import("node:fs").Dirent[];
	try {
		children = await readdir(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const discovered: string[] = [];
	for (const child of children) {
		const childPath = join(dir, child.name);
		if ((child.isFile() || child.isSymbolicLink()) && (child.name.endsWith(".ts") || child.name.endsWith(".js"))) {
			discovered.push(childPath);
			continue;
		}
		if (child.isDirectory() || child.isSymbolicLink()) {
			try {
				if ((await stat(childPath)).isDirectory()) discovered.push(...await resolveExtensionDirectory(childPath));
			} catch {
				// Match Pi: a broken or unreadable child contributes no entry point.
			}
		}
	}
	return discovered;
}

/** Entry points for a live agent-dir install (no package.json there): every
 * top-level extensions/*.ts (matching pi's directory-scan auto-load), plus each
 * non-`npm:`-prefixed settings.json `packages` entry's own package.json
 * `pi.extensions`, plus every `agents/*.md` role prompt (appended by the subagent
 * tool as each child's system prompt — behavior-bearing,
 * but not `.ts`/`.js` so walkRelativeImports's regex can never reach them; added
 * as leaves directly, no import-walking needed). Each `npm:`-prefixed entry
 * resolves to a lockfile-pinned identity instead (see resolveNpmPackageIdentity)
 * — never silently skipped. `agents/` is optional (matches agentPromptPath's own
 * existsSync-or-null treatment of individual role files) — a missing directory
 * contributes nothing rather than failing closed, since there's no declared list
 * of expected role prompts to fail against. */
export async function discoverEntryPoints(agentDir: string, cwd?: string): Promise<{
	entries: string[];
	orderedEntryPoints: string[];
	npmIdentities: NpmPackageIdentity[];
}> {
	const orderedEntryPoints: string[] = [];
	const seen = new Set<string>();
	const addEntries = (paths: Iterable<string>) => {
		for (const entry of paths) {
			const absolute = resolve(entry);
			if (!seen.has(absolute)) {
				seen.add(absolute);
				orderedEntryPoints.push(absolute);
			}
		}
	};
	if (cwd) addEntries(await discoverExtensionEntriesInDir(join(resolve(cwd), ".pi", "extensions")));
	addEntries(await discoverExtensionEntriesInDir(join(agentDir, "extensions")));
	const promptFiles: string[] = [];

	const agentsDir = join(agentDir, "agents");
	try {
		const mdFiles = (await readdir(agentsDir)).filter((f) => f.endsWith(".md"));
		for (const f of mdFiles) promptFiles.push(join(agentsDir, f));
	} catch {
		// no agents/ dir — role prompts are optional, nothing to add
	}

	// Skill text and the governor append are model-visible prompt surface, same
	// class as agents/*.md. Before 2026-08-11 they were OUTSIDE the hash, which
	// let two different model-visible changes share one hash (SURFACE_BOUNDARIES
	// rows 2026-08-06 ×2 are the manifested case). Optional-if-missing, matching
	// agents/ above; mirror:check separately proves presence.
	promptFiles.push(...await walkPromptFiles(join(agentDir, "skills")));
	const appendPath = join(agentDir, "APPEND_SYSTEM.md");
	if (existsSync(appendPath)) promptFiles.push(appendPath);

	const npmIdentities: NpmPackageIdentity[] = [];
	const settings = JSON.parse(await readFile(join(agentDir, "settings.json"), "utf8")) as { packages?: string[] };
	for (const pkg of settings.packages ?? []) {
		if (pkg.startsWith("npm:")) {
			npmIdentities.push(await resolveNpmPackageIdentity(agentDir, pkg));
			continue;
		}
		const pkgDir = join(agentDir, pkg);
		const resolvedEntries = await resolveExtensionDirectory(pkgDir);
		if (resolvedEntries.length) addEntries(resolvedEntries);
		else addEntries(await discoverExtensionEntriesInDir(pkgDir));
	}
	return { entries: [...orderedEntryPoints, ...promptFiles], orderedEntryPoints, npmIdentities };
}

/** Hash causal topology first, then content as an unordered set, then pinned npm
 * identity. Manifest formatting is absent; changing declared order is not. */
export async function hashSurface(baseDir: string, descriptor: SurfaceDescriptor): Promise<string> {
	const label = (file: string) => relative(baseDir, file).split("\\").join("/");
	const relPaths = Array.from(new Set(Array.from(descriptor.files, label))).sort();
	const hash = createHash("sha256");
	hash.update("pi-surface-v2\0", "utf8");
	for (const entry of descriptor.orderedEntryPoints) {
		hash.update("entry\0", "utf8");
		hash.update(label(entry), "utf8");
		hash.update("\0");
	}
	for (const relPath of relPaths) {
		hash.update("file\0", "utf8");
		const bytes = await readFile(join(baseDir, relPath));
		hash.update(relPath, "utf8");
		hash.update("\0");
		hash.update(bytes);
		hash.update("\0");
	}
	for (const pkg of [...(descriptor.npmIdentities ?? [])].sort((a, b) => a.name.localeCompare(b.name))) {
		hash.update(`npm:${pkg.name}`, "utf8");
		hash.update("\0");
		hash.update(`${pkg.version}|${pkg.resolved}|${pkg.integrity}`, "utf8");
		hash.update("\0");
	}
	return hash.digest("hex");
}
