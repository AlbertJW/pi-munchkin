import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { makeFakePi } from "./integration-harness.ts";

async function withTelemetryFile<T>(fn: (file: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), "surface-receipt-"));
	const file = join(dir, "events.jsonl");
	const prior = {
		TELEMETRY: process.env.TELEMETRY,
		TELEMETRY_FILE: process.env.TELEMETRY_FILE,
		TELEMETRY_FD: process.env.TELEMETRY_FD,
		TELEMETRY_HMAC_FD: process.env.TELEMETRY_HMAC_FD,
	};
	process.env.TELEMETRY_FILE = file;
	delete process.env.TELEMETRY_FD;
	try {
		return await fn(file);
	} finally {
		for (const [key, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
		rmSync(dir, { recursive: true, force: true });
	}
}

async function fireSessionStart(): Promise<void> {
	const fp = makeFakePi();
	const mod = await import(`../extensions/surface-receipt.ts?t=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi);
	for (const fn of fp.handlers.get("session_start") ?? []) await fn({}, {});
}

test("a valid HARNESS_SURFACE_SHA256 records a surface-receipt telemetry row", async () => {
	const previous = process.env.HARNESS_SURFACE_SHA256;
	process.env.HARNESS_SURFACE_SHA256 = "a".repeat(64);
	try {
		await withTelemetryFile(async (file) => {
			await fireSessionStart();
			const row = JSON.parse(readFileSync(file, "utf8").trim());
			assert.equal(row.ext, "surface-receipt");
			assert.equal(row.kind, "surface");
			assert.equal(row.sha256, "a".repeat(64));
		});
	} finally {
		if (previous === undefined) delete process.env.HARNESS_SURFACE_SHA256;
		else process.env.HARNESS_SURFACE_SHA256 = previous;
	}
});

test("no env var: no telemetry write at all (interactive/non-gate sessions unaffected)", async () => {
	await withTelemetryFile(async (file) => {
		await fireSessionStart();
		assert.equal(existsSync(file), false);
	});
});

test("a malformed (non-hex-64) HARNESS_SURFACE_SHA256 is never recorded", async () => {
	const previous = process.env.HARNESS_SURFACE_SHA256;
	process.env.HARNESS_SURFACE_SHA256 = "not-a-hash";
	try {
		await withTelemetryFile(async (file) => {
			await fireSessionStart();
			assert.equal(existsSync(file), false);
		});
	} finally {
		if (previous === undefined) delete process.env.HARNESS_SURFACE_SHA256;
		else process.env.HARNESS_SURFACE_SHA256 = previous;
	}
});
