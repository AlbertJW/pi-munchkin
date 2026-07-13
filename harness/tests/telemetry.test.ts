import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { record } from "../lib/telemetry.ts";

function withFile<T>(fn: (file: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "tele-"));
	const file = join(dir, "sub", "events.jsonl"); // sub: proves mkdir -p
	process.env.TELEMETRY_FILE = file;
	try {
		return fn(file);
	} finally {
		delete process.env.TELEMETRY_FILE;
		delete process.env.TELEMETRY_MAX_BYTES;
		rmSync(dir, { recursive: true, force: true });
	}
}

test("record: appends valid JSONL with ts/ext/kind + detail", () => {
	withFile((file) => {
		record("loop-breaker", "steer", { tier: 2, streak: 5 });
		record("verify-gate", "steer", { failed: true });
		const lines = readFileSync(file, "utf8").trim().split("\n");
		assert.equal(lines.length, 2);
		const first = JSON.parse(lines[0]);
		assert.equal(first.ext, "loop-breaker");
		assert.equal(first.kind, "steer");
		assert.equal(first.tier, 2);
		assert.ok(!Number.isNaN(Date.parse(first.ts)), "ts must be a valid timestamp");
	});
});

test("record: TELEMETRY=off writes nothing", () => {
	withFile((file) => {
		process.env.TELEMETRY = "off";
		try {
			record("x", "y", {});
			assert.equal(existsSync(file), false, "off switch must suppress all writes");
		} finally {
			delete process.env.TELEMETRY;
		}
	});
});

test("record: rotates at TELEMETRY_MAX_BYTES keeping one .old", () => {
	withFile((file) => {
		record("seed", "seed", {}); // creates the dir + file
		process.env.TELEMETRY_MAX_BYTES = "64";
		writeFileSync(file, "x".repeat(100)); // oversize it
		record("ext", "kind", {});
		assert.ok(existsSync(`${file}.old`), "oversized file must rotate to .old");
		const fresh = readFileSync(file, "utf8").trim().split("\n");
		assert.equal(fresh.length, 1, "new file starts with just the new event");
		assert.equal(JSON.parse(fresh[0]).ext, "ext");
	});
});

test("record: never throws even with an unwritable path", () => {
	process.env.TELEMETRY_FILE = "/dev/null/impossible/events.jsonl";
	try {
		assert.doesNotThrow(() => record("x", "y", {}));
	} finally {
		delete process.env.TELEMETRY_FILE;
	}
});

test("events carry the session key (exact enrichment join)", () => {
	const f = join(tmpdir(), `tel-sk-${Date.now()}.jsonl`);
	process.env.TELEMETRY_FILE = f;
	record("t", "k", { a: 1 });
	const row = JSON.parse(readFileSync(f, "utf8").trim());
	assert.ok(typeof row.sk === "string" && row.sk.length > 0, "sk key present");
	delete process.env.TELEMETRY_FILE;
});
