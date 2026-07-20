import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverEntryPoints, hashSurface, walkRelativeImports } from "../lib/surface-walk.ts";

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

test("discoverEntryPoints: top-level extensions/*.ts plus non-npm: settings.json packages, npm: entries skipped", async () => {
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

	const entries = (await discoverEntryPoints(dir)).sort();
	assert.deepEqual(entries, [
		join(dir, "extensions", "bar.ts"),
		join(dir, "extensions", "foo.ts"),
		join(dir, "vendor", "pi-subagent", "index.ts"),
	].sort());
	await rm(dir, { recursive: true, force: true });
});
