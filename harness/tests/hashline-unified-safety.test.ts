import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyHunks, decodeDocument, fileTag, parsePatch, serializeDocument } from "../lib/hashline-core.ts";
import { registerHashline } from "../extensions/hashline.ts";
import { callTool, makeFakePi } from "./integration-harness.ts";

function apply(source: string, body: string): string {
	const [section] = parsePatch(`[a.txt#${fileTag(source)}]\n${body}`);
	return serializeDocument(applyHunks(decodeDocument(Buffer.from(source)), section.hunks).document).toString();
}

test("unified patches reject incomplete sides and stale counts before any file write", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "hashline-unified-atomic-"));
	try {
		for (const name of ["a.txt", "b.txt"]) writeFileSync(join(cwd, name), "old\nkeep\n");
		let writes = 0;
		const fp = makeFakePi();
		registerHashline(fp.pi as any, { writeTarget: async () => { writes += 1; } });
		for (const body of [
			"@@ -1,1 +1,1 @@\n+new",
			"@@ -1,1 +1,1 @@\n-old",
			"@@ -1,2 +1,2 @@\n-old\n+new",
			"@@ -1,0 +1,1 @@\n-old\n+new",
		]) {
			const tag = fileTag("old\nkeep\n");
			const result = await callTool(fp, "edit", { input: `[a.txt#${tag}]\n@@ -1,1 +1,1 @@\n-old\n+new\n[b.txt#${tag}]\n${body}` }, cwd);
			assert.equal(result.isError, true, `incomplete patch must fail: ${body}`);
			assert.equal(writes, 0, "even the valid first file must remain unwritten");
			assert.equal(readFileSync(join(cwd, "a.txt"), "utf8"), "old\nkeep\n");
			assert.equal(readFileSync(join(cwd, "b.txt"), "utf8"), "old\nkeep\n");
		}
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("unified context resembling a wrapper is checked as source data", () => {
	const body = "@@ -1,2 +1,2 @@\n-old\n+new\n *** End Patch";
	assert.throws(() => apply("old\nwrong\n", body), /source mismatch/);
	assert.equal(apply("old\n*** End Patch\n", body), "new\n*** End Patch\n");
	assert.equal(apply("old\n*** Begin Patch\n", body.replace("End Patch", "Begin Patch")), "new\n*** Begin Patch\n");
});

test("unified context preserves its exact mixed EOL and BOM bytes", () => {
	for (const bom of ["", "\uFEFF"]) {
		for (const final of ["\n", "\r\n", ""]) {
			const source = `${bom}prefix\nold\r\nkeep\rsuffix${final}`;
			assert.equal(apply(source, "@@ -1,4 +1,4 @@\n prefix\n-old\n+new\n keep\n suffix"), `${bom}prefix\nnew\r\nkeep\rsuffix${final}`);
		}
	}
});

test("unified change runs preserve intervening context and validate the whole old span", () => {
	const body = "@@ -1,5 +1,5 @@\n a\n-old1\n+new1\n keep\n-old2\n+new2\n z";
	assert.equal(apply("a\nold1\r\nkeep\rold2\nz\n", body), "a\nnew1\r\nkeep\rnew2\nz\n");
	assert.throws(() => apply("a\nold1\r\nWRONG\rold2\nz\n", body), /source mismatch/);
});

test("native and unified sections compose in one atomic edit", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "hashline-mixed-"));
	try {
		const tag = fileTag("old\n");
		for (const name of ["a.txt", "b.txt"]) writeFileSync(join(cwd, name), "old\n");
		const fp = makeFakePi(); registerHashline(fp.pi as any);
		const result = await callTool(fp, "edit", { input: `[a.txt#${tag}]\nreplace 1:\n+new\n[b.txt#${tag}]\n@@ -1 +1 @@\n-old\n+new` }, cwd);
		assert.equal(result.isError, false, JSON.stringify(result.content));
		for (const name of ["a.txt", "b.txt"]) assert.equal(readFileSync(join(cwd, name), "utf8"), "new\n");
	} finally { rmSync(cwd, { recursive: true, force: true }); }
});

test("explicit zero-count unified inserts and deletes retain their boundary semantics", () => {
	assert.equal(apply("", "@@ -0,0 +1,1 @@\n+first"), "first");
	assert.equal(apply("a\nb\n", "@@ -1,0 +2,1 @@\n+between"), "a\nbetween\nb\n");
	assert.equal(apply("a\nb\n", "@@ -1,1 +0,0 @@\n-a"), "b\n");
	assert.equal(apply("a\nb", "@@ -2,0 +3,1 @@\n+tail"), "a\nb\ntail");
	assert.throws(() => apply("a\n", "@@ -0,1 +1,1 @@\n-a\n+b"));
	assert.throws(() => apply("a\n", "@@ -1,1 +0,1 @@\n-a\n+b"));
});

test("overlapping unified change runs are rejected without fuzzy relocation", () => {
	assert.throws(() => apply("old\nkeep\n", "@@ -1 +1 @@\n-old\n+new\n@@ -1 +1 @@\n-old\n+other"), /overlapping/);
});
