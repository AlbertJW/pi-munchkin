import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverEntryPoints, hashSurface, resolveNpmPackageIdentity, walkRelativeImports } from "../lib/surface-walk.ts";

async function tmp(): Promise<string> {
	return mkdtemp(join(tmpdir(), "surface-walk-"));
}

test("walkRelativeImports follows the relative-import chain, entry points included", async () => {
	const dir = await tmp();
	await writeFile(join(dir, "entry.ts"), 'import { helper } from "./helper.ts";\nhelper();\n');
	await writeFile(join(dir, "helper.ts"), 'export function helper() {}\n');
	await writeFile(join(dir, "unrelated.ts"), "// never imported\n");
	const found = await walkRelativeImports([join(dir, "entry.ts")]);
	assert.deepEqual([...found].sort(), [join(dir, "entry.ts"), join(dir, "helper.ts")].sort());
	await rm(dir, { recursive: true, force: true });
});

test("walkRelativeImports never crosses a bare-specifier (npm package) import", async () => {
	const dir = await tmp();
	await writeFile(join(dir, "entry.ts"), 'import { Type } from "typebox";\n');
	const found = await walkRelativeImports([join(dir, "entry.ts")]);
	assert.deepEqual([...found], [join(dir, "entry.ts")]);
	await rm(dir, { recursive: true, force: true });
});

test("hashSurface is deterministic and sensitive to content, not iteration order", async () => {
	const dir = await tmp();
	await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
	await writeFile(join(dir, "b.ts"), "export const b = 2;\n");
	const forward = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts"), join(dir, "b.ts")] });
	const reversed = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "b.ts"), join(dir, "a.ts")] });
	assert.equal(forward, reversed, "iteration order must not affect the digest (paths are sorted internally)");
	const again = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts"), join(dir, "b.ts")] });
	assert.equal(forward, again, "same input twice yields the same digest");
	await writeFile(join(dir, "a.ts"), "export const a = 2;\n"); // content change
	const changed = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts"), join(dir, "b.ts")] });
	assert.notEqual(forward, changed, "a content change must change the digest");
	await rm(dir, { recursive: true, force: true });
});

test("hashSurface treats extension order as causal topology", async () => {
	const dir = await tmp();
	const a = join(dir, "a.ts");
	const b = join(dir, "b.ts");
	await writeFile(a, "export const a = 1;\n");
	await writeFile(b, "export const b = 2;\n");
	const files = [a, b];
	const forward = await hashSurface(dir, { orderedEntryPoints: [a, b], files });
	const reversed = await hashSurface(dir, { orderedEntryPoints: [b, a], files });
	assert.notEqual(forward, reversed, "the same bytes in a different load order are a different surface");
	await rm(dir, { recursive: true, force: true });
});

test("discoverEntryPoints matches Pi package order and includes project-local extensions first", async () => {
	const agentDir = await tmp();
	const cwd = await tmp();
	await mkdir(join(agentDir, "extensions", "bundle"), { recursive: true });
	await writeFile(join(agentDir, "extensions", "bundle", "one.ts"), "export {};\n");
	await writeFile(join(agentDir, "extensions", "bundle", "two.ts"), "export {};\n");
	const manifestPath = join(agentDir, "extensions", "bundle", "package.json");
	await writeFile(manifestPath, JSON.stringify({ pi: { extensions: ["./two.ts", "./one.ts"] } }));
	await writeFile(join(agentDir, "settings.json"), JSON.stringify({ packages: [] }));
	await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
	const local = join(cwd, ".pi", "extensions", "local.ts");
	await writeFile(local, "export {};\n");

	const first = await discoverEntryPoints(agentDir, cwd);
	assert.deepEqual(first.orderedEntryPoints, [
		local,
		join(agentDir, "extensions", "bundle", "two.ts"),
		join(agentDir, "extensions", "bundle", "one.ts"),
	]);
	const files = await walkRelativeImports(first.orderedEntryPoints);
	const before = await hashSurface(agentDir, { orderedEntryPoints: first.orderedEntryPoints, files });

	await writeFile(manifestPath, '{\n  "pi": { "extensions": ["./two.ts", "./one.ts"] }\n}\n');
	const reformatted = await discoverEntryPoints(agentDir, cwd);
	assert.equal(before, await hashSurface(agentDir, {
		orderedEntryPoints: reformatted.orderedEntryPoints,
		files: await walkRelativeImports(reformatted.orderedEntryPoints),
	}), "manifest whitespace is not runtime topology");

	await writeFile(manifestPath, JSON.stringify({ pi: { extensions: ["./one.ts", "./two.ts"] } }));
	const reordered = await discoverEntryPoints(agentDir, cwd);
	assert.notEqual(before, await hashSurface(agentDir, {
		orderedEntryPoints: reordered.orderedEntryPoints,
		files: await walkRelativeImports(reordered.orderedEntryPoints),
	}), "declared order must move the digest");
	await rm(agentDir, { recursive: true, force: true });
	await rm(cwd, { recursive: true, force: true });
});

function lockEntry(version: string, integrity = `sha512-${version}fakehash`) {
	return { version, resolved: `https://registry.npmjs.org/some-package/-/some-package-${version}.tgz`, integrity };
}

async function agentDirWithLock(dir: string, lockPackages: Record<string, unknown>): Promise<void> {
	await mkdir(join(dir, "npm"), { recursive: true });
	await writeFile(join(dir, "npm", "package-lock.json"), JSON.stringify({
		lockfileVersion: 3, name: "pi-extensions", packages: lockPackages,
	}));
}

test("discoverEntryPoints: top-level extensions/*.ts, non-npm: settings.json packages, npm: entries resolved via lockfile", async () => {
	const dir = await tmp();
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(join(dir, "extensions", "foo.ts"), "export default function () {}\n");
	await writeFile(join(dir, "extensions", "bar.ts"), "export default function () {}\n");
	await mkdir(join(dir, "extensions", "nested"), { recursive: true });
	await writeFile(join(dir, "extensions", "nested", "not-top-level.ts"), "// must be ignored\n");

	await mkdir(join(dir, "vendor", "pi-subagent"), { recursive: true });
	await writeFile(join(dir, "vendor", "pi-subagent", "index.ts"), "export {};\n");
	await writeFile(join(dir, "vendor", "pi-subagent", "package.json"),
		JSON.stringify({ pi: { extensions: ["./index.ts"] } }));

	await writeFile(join(dir, "settings.json"), JSON.stringify({
		packages: ["npm:some-package@1.0.0", "vendor/pi-subagent"],
	}));
	await agentDirWithLock(dir, { "node_modules/some-package": lockEntry("1.0.0") });

	await mkdir(join(dir, "agents"), { recursive: true });
	await writeFile(join(dir, "agents", "explorer.md"), "# explorer role prompt\n");
	await writeFile(join(dir, "agents", "notes.txt"), "ignored: not .md\n");

	const { entries, npmIdentities } = await discoverEntryPoints(dir);
	assert.deepEqual(entries.sort(), [
		join(dir, "agents", "explorer.md"),
		join(dir, "extensions", "bar.ts"),
		join(dir, "extensions", "foo.ts"),
		join(dir, "vendor", "pi-subagent", "index.ts"),
	].sort());
	assert.deepEqual(npmIdentities, [{
		name: "some-package", version: "1.0.0",
		resolved: "https://registry.npmjs.org/some-package/-/some-package-1.0.0.tgz",
		integrity: "sha512-1.0.0fakehash",
	}]);
	await rm(dir, { recursive: true, force: true });
});

test("discoverEntryPoints: a missing agents/ dir contributes nothing rather than failing", async () => {
	const dir = await tmp();
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(join(dir, "extensions", "foo.ts"), "export default function () {}\n");
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [] }));
	// no agents/ dir written at all
	const { entries } = await discoverEntryPoints(dir);
	assert.deepEqual(entries, [join(dir, "extensions", "foo.ts")]);
	await rm(dir, { recursive: true, force: true });
});

test("discoverEntryPoints fails closed when an npm: package has no lockfile at all", async () => {
	const dir = await tmp();
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:some-package@1.0.0"] }));
	// no npm/package-lock.json written
	await assert.rejects(discoverEntryPoints(dir), /lockfile unreadable/);
	await rm(dir, { recursive: true, force: true });
});

test("discoverEntryPoints fails closed when the lockfile has no entry for the package", async () => {
	const dir = await tmp();
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:missing-package@2.0.0"] }));
	await agentDirWithLock(dir, { "node_modules/some-other-package": lockEntry("1.0.0") });
	await assert.rejects(discoverEntryPoints(dir), /no usable lockfile identity/);
	await rm(dir, { recursive: true, force: true });
});

test("discoverEntryPoints fails closed when the lockfile entry lacks integrity", async () => {
	const dir = await tmp();
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: ["npm:some-package@1.0.0"] }));
	await agentDirWithLock(dir, { "node_modules/some-package": { version: "1.0.0", resolved: "https://registry.npmjs.org/x" } });
	await assert.rejects(discoverEntryPoints(dir), /no usable lockfile identity/);
	await rm(dir, { recursive: true, force: true });
});

test("resolveNpmPackageIdentity: strips npm: prefix and @version, including scoped package names", async () => {
	const dir = await tmp();
	await agentDirWithLock(dir, {
		"node_modules/pi-rtk-optimizer": lockEntry("0.9.0"),
		"node_modules/@scope/pkg": lockEntry("2.0.0"),
	});
	const id = await resolveNpmPackageIdentity(dir, "npm:pi-rtk-optimizer@0.9.0");
	assert.equal(id.name, "pi-rtk-optimizer");
	assert.equal(id.version, "0.9.0");
	const scoped = await resolveNpmPackageIdentity(dir, "npm:@scope/pkg@2.0.0");
	assert.equal(scoped.name, "@scope/pkg", "scope's own @ must survive; only the trailing @version is stripped");
	await rm(dir, { recursive: true, force: true });
});

test("hashSurface: npm identities are folded in deterministically and change the digest", async () => {
	const dir = await tmp();
	await writeFile(join(dir, "a.ts"), "export const a = 1;\n");
	const identities = [
		{ name: "pkg-b", version: "1.0.0", resolved: "r-b", integrity: "i-b" },
		{ name: "pkg-a", version: "1.0.0", resolved: "r-a", integrity: "i-a" },
	];
	const withNpm = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts")], npmIdentities: identities });
	const reversed = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts")], npmIdentities: [...identities].reverse() });
	assert.equal(withNpm, reversed, "npm identity order must not affect the digest (sorted internally)");
	const withoutNpm = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts")] });
	assert.notEqual(withNpm, withoutNpm, "npm identities must actually change the digest");
	const changedIdentity = await hashSurface(dir, { orderedEntryPoints: [], files: [join(dir, "a.ts")],
		npmIdentities: [{ ...identities[0], version: "1.0.1" }, identities[1]] });
	assert.notEqual(withNpm, changedIdentity, "a changed npm package version must change the digest");
	await rm(dir, { recursive: true, force: true });
});

test("discoverEntryPoints: skills/**/*.md and APPEND_SYSTEM.md are prompt surface — in the hash, and content-sensitive", async () => {
	const dir = await tmp();
	await mkdir(join(dir, "extensions"), { recursive: true });
	await writeFile(join(dir, "extensions", "foo.ts"), "export default function () {}\n");
	await writeFile(join(dir, "settings.json"), JSON.stringify({ packages: [] }));
	await mkdir(join(dir, "skills", "deep-research"), { recursive: true });
	await writeFile(join(dir, "skills", "deep-research", "SKILL.md"), "# skill v1\n");
	await writeFile(join(dir, "skills", "deep-research", "helper.py"), "# scripts are behavior: included\n");
	await writeFile(join(dir, "APPEND_SYSTEM.md"), "governor text\n");

	const first = await discoverEntryPoints(dir);
	const { entries } = first;
	assert.deepEqual(entries.sort(), [
		join(dir, "APPEND_SYSTEM.md"),
		join(dir, "extensions", "foo.ts"),
		join(dir, "skills", "deep-research", "SKILL.md"),
		join(dir, "skills", "deep-research", "helper.py"),
	].sort());

	// The 2026-08-06 incident: a skill-text change must move the hash.
	const before = await hashSurface(dir, { orderedEntryPoints: first.orderedEntryPoints, files: entries });
	await writeFile(join(dir, "skills", "deep-research", "SKILL.md"), "# skill v2 — changed\n");
	const second = await discoverEntryPoints(dir);
	const after = await hashSurface(dir, { orderedEntryPoints: second.orderedEntryPoints, files: second.entries });
	assert.notEqual(before, after, "skill edits are model-visible and must change the surface hash");

	// And a skill SCRIPT change must too — executable behavior, same boundary rule.
	await writeFile(join(dir, "skills", "deep-research", "helper.py"), "# changed script\n");
	const third = await discoverEntryPoints(dir);
	const afterScript = await hashSurface(dir, { orderedEntryPoints: third.orderedEntryPoints, files: third.entries });
	assert.notEqual(after, afterScript, "skill script edits must change the surface hash");
	await rm(dir, { recursive: true, force: true });
});
