import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicWritePrivateFiles } from "../lib/private-artifact.ts";

test("a failed private artifact set removes every unpublished temporary file", async () => {
	const root = mkdtempSync(join(tmpdir(), "private-artifact-failure-"));
	const blocked = join(root, "blocked");
	mkdirSync(blocked);
	await assert.rejects(atomicWritePrivateFiles([
		{ path: join(root, "projection.md"), text: "projection\n" },
		{ path: blocked, text: "authority\n" },
	]));
	assert.equal(readdirSync(root).some((name) => name.endsWith(".tmp")), false);
});
