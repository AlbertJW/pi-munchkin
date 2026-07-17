import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
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

test("near-basename sibling in an existing parent", () => {
	const d = tree();
	try {
		assert.equal(closestExistingPath(d, "src/utils.js"), "src/util.js");   // distance 1
		// case slip: on case-insensitive APFS the path EXISTS (read succeeds, no
		// ENOENT ever fires) -> correctly no suggestion. The d=0 branch still
		// matters on case-sensitive volumes.
		assert.equal(closestExistingPath(d, "src/Util.js"), null);
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("exact basename found via shallow walk when parent path is wrong", () => {
	const d = tree();
	try {
		assert.equal(closestExistingPath(d, "conf/config.json"), "deep/nest/config.json");
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("no suggestion when ambiguous, existing, or hopeless", () => {
	const d = tree();
	try {
		writeFileSync(join(d, "src/utila.js"), "");
		writeFileSync(join(d, "src/utilb.js"), "");
		assert.equal(closestExistingPath(d, "src/utilz.js"), null);            // tie -> never guess
		assert.equal(closestExistingPath(d, "src/index.js"), null);            // exists -> nothing
		assert.equal(closestExistingPath(d, "src/completely-different.md"), null);
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("attemptedPathFrom: input.path wins; edit + ENOENT messages parse", () => {
	assert.equal(attemptedPathFrom("read", { path: "src/x.js" }, "whatever"), "src/x.js");
	assert.equal(attemptedPathFrom("edit", {}, "file not found: src/y.js. Use the file's real relative path"), "src/y.js");
	assert.equal(attemptedPathFrom("read", {}, "ENOENT: no such file or directory, open '/tmp/z.js'"), "/tmp/z.js");
	assert.equal(attemptedPathFrom("read", {}, "some other error"), null);
});
