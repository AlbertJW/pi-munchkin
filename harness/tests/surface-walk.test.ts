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
	const forward = await hashSurface(dir, [join(dir, "a.ts"), join(dir, "b.ts")]);
	const reversed = await hashSurface(dir, [join(dir, "b.ts"), join(dir, "a.ts")]);
	assert.equal(forward, reversed, "iteration order must not affect the digest (paths are sorted internally)");
	const again = await hashSurface(dir, [join(dir, "a.ts"), join(dir, "b.ts")]);
	assert.equal(forward, again, "same input twice yields the same digest");
	await writeFile(join(dir, "a.ts"), "export const a = 2;\n"); // content change
	const changed = await hashSurface(dir, [join(dir, "a.ts"), join(dir, "b.ts")]);
	assert.notEqual(forward, changed, "a content change must change the digest");
	await rm(dir, { recursive: true, force: true });
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
	const withNpm = await hashSurface(dir, [join(dir, "a.ts")], identities);
	const reversed = await hashSurface(dir, [join(dir, "a.ts")], [...identities].reverse());
	assert.equal(withNpm, reversed, "npm identity order must not affect the digest (sorted internally)");
	const withoutNpm = await hashSurface(dir, [join(dir, "a.ts")]);
	assert.notEqual(withNpm, withoutNpm, "npm identities must actually change the digest");
	const changedIdentity = await hashSurface(dir, [join(dir, "a.ts")],
		[{ ...identities[0], version: "1.0.1" }, identities[1]]);
	assert.notEqual(withNpm, changedIdentity, "a changed npm package version must change the digest");
	await rm(dir, { recursive: true, force: true });
});
