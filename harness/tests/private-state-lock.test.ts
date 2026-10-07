import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { withPrivateStateLock } from "../lib/private-state-lock.ts";

test("private state lock releases after success and reducer failure", async () => {
	const root = mkdtempSync(join(tmpdir(), "private-lock-")), path = join(root, "state.json");
	try {
		assert.equal(await withPrivateStateLock(path, async () => 42), 42);
		assert.equal(existsSync(`${path}.lock`), false);
		await assert.rejects(withPrivateStateLock(path, async () => { throw new Error("reducer failed"); }), /reducer failed/);
		assert.equal(existsSync(`${path}.lock`), false);
		await withPrivateStateLock(path, async () => undefined);
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("unknown and abandoned locks are never stolen", async () => {
	const root = mkdtempSync(join(tmpdir(), "private-lock-")), path = join(root, "state.json");
	try {
		mkdirSync(`${path}.lock`);
		for (const owner of ["{broken", JSON.stringify({ pid: 999999999, token: "old", created_at: "2000-01-01" })]) {
			writeFileSync(join(`${path}.lock`, "owner.json"), owner);
			let called = false;
			await assert.rejects(withPrivateStateLock(path, async () => { called = true; }, { timeoutMs: 30 }), /stop all sessions.*preserve the ledger/);
			assert.equal(called, false);
			assert.equal(readFileSync(join(`${path}.lock`, "owner.json"), "utf8"), owner);
		}
	} finally { rmSync(root, { recursive: true, force: true }); }
});

test("cleanup preserves a replaced owner", async () => {
	const root = mkdtempSync(join(tmpdir(), "private-lock-")), path = join(root, "state.json");
	try {
		await withPrivateStateLock(path, async () => {
			writeFileSync(join(`${path}.lock`, "owner.json"), JSON.stringify({ token: "replacement" }));
		});
		assert.equal(existsSync(`${path}.lock`), true);
	} finally { rmSync(root, { recursive: true, force: true }); }
});
