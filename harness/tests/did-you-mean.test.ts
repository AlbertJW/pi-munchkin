import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { attemptedPathFrom, closestExistingPath } from "../lib/did-you-mean.ts";

function tree() {
	const d = mkdtempSync(join(tmpdir(), "dym-"));
	mkdirSync(join(d, "src"));
	mkdirSync(join(d, "deep", "nest"), { recursive: true });
	writeFileSync(join(d, "src/util.js"), "");
	writeFileSync(join(d, "src/index.js"), "");
	writeFileSync(join(d, "deep/nest/config.json"), "");
	return d;
}

test("near-basename sibling in an existing parent", async () => {
	const d = tree();
	try {
		assert.equal(await closestExistingPath(d, "src/utils.js"), "src/util.js");   // distance 1
		// A case-only alias already exists on case-insensitive APFS, so no failed
		// lookup needs a hint. On a case-sensitive volume it is absent and the
		// unique distance-0 sibling is the correct suggestion.
		const caseAliasExists = existsSync(join(d, "src/Util.js"));
		assert.equal(await closestExistingPath(d, "src/Util.js"), caseAliasExists ? null : "src/util.js");
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("exact basename found via shallow walk when parent path is wrong", async () => {
	const d = tree();
	try {
		assert.equal(await closestExistingPath(d, "conf/config.json"), "deep/nest/config.json");
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("no suggestion when ambiguous, existing, or hopeless", async () => {
	const d = tree();
	try {
		writeFileSync(join(d, "src/utila.js"), "");
		writeFileSync(join(d, "src/utilb.js"), "");
		assert.equal(await closestExistingPath(d, "src/utilz.js"), null);            // tie -> never guess
		assert.equal(await closestExistingPath(d, "src/index.js"), null);            // exists -> nothing
		assert.equal(await closestExistingPath(d, "src/completely-different.md"), null);
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("entry-budget exhaustion returns no suggestion", async () => {
	const d = mkdtempSync(join(tmpdir(), "dym-budget-"));
	try {
		for (let i = 0; i < 2049; i++) writeFileSync(join(d, `entry-${i}.txt`), "");
		writeFileSync(join(d, "target.json"), "");
		assert.equal(await closestExistingPath(d, "missing/target.json"), null);
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("attemptedPathFrom: input.path wins; edit + ENOENT messages parse", () => {
	assert.equal(attemptedPathFrom("read", { path: "src/x.js" }, "whatever"), "src/x.js");
	assert.equal(attemptedPathFrom("edit", {}, "file not found: src/y.js. Use the file's real relative path"), "src/y.js");
	assert.equal(attemptedPathFrom("read", {}, "ENOENT: no such file or directory, open '/tmp/z.js'"), "/tmp/z.js");
	assert.equal(attemptedPathFrom("read", {}, "some other error"), null);
});
