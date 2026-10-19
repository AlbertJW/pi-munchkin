// Mechanical patch repairs (2026-10 traces) and contract-style errors. The #TAG check
// still guards every edit; nothing that needs a guess about intent is accepted.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	applyHunks,
	decodeDocument,
	fileTag,
	normalizePatchText,
	parsePatch,
	serializeDocument,
} from "../lib/hashline-core.ts";
import { registerHashline } from "../extensions/hashline.ts";
import { callTool, makeFakePi } from "./integration-harness.ts";

const TAG = "a".repeat(64);

test("a double-escaped one-line patch is read with real newlines", () => {
	const r = normalizePatchText(`[a.ts#${TAG}]\\nreplace 1..1:\\n+x`);
	assert.equal(r.text, `[a.ts#${TAG}]\nreplace 1..1:\n+x`);
	assert.equal(r.notes.length, 1);
	assert.deepEqual(parsePatch(r.text)[0].hunks, [{ op: "replace", start: 1, end: 1, body: ["x"] }]);
});

test("a stray trailing backslash is removed from command lines only, never from body rows", () => {
	const r = normalizePatchText(`[a.ts#${TAG}]\nreplace 1..1:\\\n+keep this \\`);
	assert.equal(r.text, `[a.ts#${TAG}]\nreplace 1..1:\n+keep this \\`);
});

test("well-formed patches are untouched, and text with real newlines is never unescaped", () => {
	const ok = `[a.ts#${TAG}]\nreplace 1..1:\n+const s = "a\\nb";`;
	assert.deepEqual(normalizePatchText(ok), { text: ok, notes: [] });
});

test("errors that need a guess stay errors but show the exact expected shape", () => {
	assert.throws(() => parsePatch(`[a.ts#${TAG}]\nreplace 1..1:\n});`), /Every replacement line starts with "\+"[\s\S]*Expected shape:/);
	assert.throws(() => parsePatch("replace 1..1:\n+x"), /before any \[path#TAG\] header[\s\S]*Expected shape:/);
});

test("a complete tagged unified diff is converted deterministically", () => {
	const source = "old\nkeep\n";
	const input = `*** Begin Patch
[a.ts#${fileTag(source)}]
@@ -1,1 +1,1 @@
-old
+new
*** End Patch`;
	const [section] = parsePatch(input);
	assert.equal(section.format, "tagged-unified");
	assert.deepEqual(section.hunks, [{ op: "replace", start: 1, end: 1, body: ["new"], source: { start: 1, lines: ["old"] } }]);
	const result = applyHunks(decodeDocument(Buffer.from(source)), section.hunks);
	assert.equal(serializeDocument(result.document).toString(), "new\nkeep\n");
});

test("tagged unified diffs validate their old/context rows instead of relocating", () => {
	const source = "actual\nkeep\n";
	const [section] = parsePatch(`[a.ts#${fileTag(source)}]\n@@ -1,1 +1,1 @@\n-wrong\n+new`);
	assert.throws(
		() => applyHunks(decodeDocument(Buffer.from(source)), section.hunks),
		/tagged unified source mismatch at lines 1\.\.1/,
	);
	assert.throws(
		() => parsePatch("*** Begin Patch\n*** Update File: a.ts\n@@ -1,1 +1,1 @@\n-old\n+new\n*** End Patch"),
		/tagged hashline header.*untagged Update File/s,
	);
});

test("tagged unified context, deletion, and insertion retain exact line semantics", () => {
	const source = "alpha\nold\nkeep\ntail\n";
	const [section] = parsePatch(`[a.ts#${fileTag(source)}]
@@ -1,3 +1,3 @@
 alpha
-old
+new
 keep
@@ -4,1 +4,0 @@
-tail
@@ -3,0 +4,1 @@
+added`);
	const result = applyHunks(decodeDocument(Buffer.from(source)), section.hunks);
	assert.equal(serializeDocument(result.document).toString(), "alpha\nnew\nkeep\nadded\n");
});

test("the edit tool accepts a tagged unified diff through the full transaction", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "hashline-unified-"));
	const file = join(cwd, "a.txt");
	writeFileSync(file, "one\ntwo\n");
	const fp = makeFakePi();
	registerHashline(fp.pi as any);
	const tag = fileTag(readFileSync(file));
	const result = await callTool(fp, "edit", {
		input: `[a.txt#${tag}]\n@@ -1,2 +1,2 @@\n one\n-two\n+TWO`,
	}, cwd);
	assert.equal(result.isError, false, JSON.stringify(result.content));
	assert.equal(readFileSync(file, "utf8"), "one\nTWO\n");
});

test("the edit tool applies a double-escaped patch and says what it normalized", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "hashline-normalize-"));
	const file = join(cwd, "a.txt");
	writeFileSync(file, "one\ntwo\n");
	const fp = makeFakePi();
	registerHashline(fp.pi as any);
	const tag = fileTag(readFileSync(file));
	const result = await callTool(fp, "edit", { input: `[a.txt#${tag}]\\nreplace 2..2:\\n+TWO` }, cwd);
	assert.equal(result.isError, false, JSON.stringify(result.content));
	assert.equal(readFileSync(file, "utf8"), "one\nTWO\n");
	assert.match(JSON.stringify(result.content), /literal \\\\\\\\n sequences|literal \\\\n sequences/);
});
