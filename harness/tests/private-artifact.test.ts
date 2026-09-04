import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { atomicWritePrivateFiles } from "../lib/private-artifact.ts";

test("durable single-file writers share the private-artifact primitive", () => {
	for (const relative of ["../lib/branch-report.ts", "../lib/loop-recovery.ts", "../extensions/plan-runner.ts", "../extensions/session-blackboard.ts"]) {
		const source = readFileSync(new URL(relative, import.meta.url), "utf8");
		assert.match(source, /atomicWriteFile/, `${relative} must use the shared fsync-and-rename primitive`);
	}
});

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
