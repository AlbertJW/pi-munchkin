import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createHmac } from "node:crypto";
import { encodeTelemetryRow, isAuthoritativeTelemetryRow, record } from "../lib/telemetry.ts";

const TELEMETRY_ENV = ["TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_FD", "TELEMETRY_HMAC_FD", "TELEMETRY_MAX_BYTES", "TELEMETRY_SOURCE", "TELEMETRY_STRICT"] as const;

function restoreEnv(snapshot: Map<string, string | undefined>): void {
	for (const key of TELEMETRY_ENV) {
		const value = snapshot.get(key);
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

function withFile<T>(fn: (file: string) => T): T {
	const dir = mkdtempSync(join(tmpdir(), "tele-"));
	const file = join(dir, "sub", "events.jsonl"); // sub: proves mkdir -p
	const env = new Map(TELEMETRY_ENV.map((key) => [key, process.env[key]]));
	process.env.TELEMETRY_FILE = file;
	try {
		return fn(file);
	} finally {
		restoreEnv(env);
		rmSync(dir, { recursive: true, force: true });
	}
}

test("record: appends valid JSONL with ts/ext/kind + detail", () => {
	withFile((file) => {
		record("loop-breaker", "steer", { tier: 2, byTool: true, byReason: false, repeat: 5, streak: 5, injected_chars: 12, turnIndex: 1 });
		record("verify-gate", "steer", { failed: true, fires: 1, sessionFires: 1, injected_chars: 8, turnIndex: 1 });
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
		record("verify-gate", "gate-green-consumed", {}); // creates the dir + file
		process.env.TELEMETRY_MAX_BYTES = "64";
		writeFileSync(file, "x".repeat(100)); // oversize it
		record("verify-gate", "gate-green-consumed", {});
		assert.ok(existsSync(`${file}.old`), "oversized file must rotate to .old");
		const fresh = readFileSync(file, "utf8").trim().split("\n");
		assert.equal(fresh.length, 1, "new file starts with just the new event");
		assert.equal(JSON.parse(fresh[0]).ext, "verify-gate");
	});
});

test("record: never throws even with an unwritable path", () => {
	const env = new Map(TELEMETRY_ENV.map((key) => [key, process.env[key]]));
	process.env.TELEMETRY_FILE = "/dev/null/impossible/events.jsonl";
	try {
		assert.doesNotThrow(() => record("verify-gate", "gate-green-consumed", {}));
	} finally {
		restoreEnv(env);
	}
});

test("events carry the session key (exact enrichment join)", () => {
	const f = join(tmpdir(), `tel-sk-${Date.now()}.jsonl`);
	const env = new Map(TELEMETRY_ENV.map((key) => [key, process.env[key]]));
	try {
		process.env.TELEMETRY_FILE = f;
		record("verify-gate", "gate-green-consumed", {});
		const row = JSON.parse(readFileSync(f, "utf8").trim());
		assert.ok(typeof row.sk === "string" && row.sk.length > 0, "sk key present");
	} finally {
		restoreEnv(env);
		rmSync(f, { force: true });
	}
});

test("strict telemetry rejects unknown kinds and fields", () => {
	withFile(() => {
		process.env.TELEMETRY_STRICT = "1";
		assert.throws(() => record("unknown", "event", {}), /unknown event/);
		assert.throws(() => record("verify-gate", "gate-green-consumed", { raw_prompt: "secret" }), /forbidden field/);
	});
});

test("a detail field may NOT shadow a telemetry envelope key", () => {
	// appendRow spreads detail OVER the envelope, so a detail field named `source`
	// silently replaces TELEMETRY_SOURCE — and context_telemetry.py drops every event
	// whose source != "gate". A shadowing field therefore makes the event VANISH from
	// gate extraction, reading as a mechanism that never fired. Introduced and caught
	// the same day (2026-07-31: plan-runner's go/go-blocked used `source`, now
	// `activation`). Guarded for every envelope key, not just the one that bit us.
	withFile(() => {
		process.env.TELEMETRY_STRICT = "1";
		for (const field of ["source", "seq", "sk", "ts", "schema", "ext", "kind", "harness_surface_sha256", "config_sha256"]) {
			assert.throws(() => record("verify-gate", "gate-green-consumed", { [field]: "x" }),
				/shadows a telemetry envelope key/, `detail.${field} must be rejected`);
		}
	});
	// run_id/provider/model are deliberately NOT reserved: envelope() reads them from
	// detail on purpose and writes back the same value, so they must still be allowed.
	withFile((file) => {
		process.env.TELEMETRY_STRICT = "0";
		record("plan-runner", "go", { resumed: false, stale: 0, activation: "command", run_id: "r1" });
		const row = JSON.parse(readFileSync(file, "utf8").trim());
		assert.equal(row.kind, "go", "a legitimate row must still be written");
		assert.equal(row.run_id, "r1", "run_id is promoted, not shadowed");
		assert.equal(row.activation, "command");
		assert.notEqual(row.source, "command", "the envelope's source must survive");
	});
});

test("production telemetry fails closed to a minimal schema-reject row", () => {
	withFile((file) => {
		process.env.TELEMETRY_STRICT = "0";
		record("unknown", "event", { raw_prompt: "must-not-leak" });
		const row = JSON.parse(readFileSync(file, "utf8").trim());
		assert.equal(row.ext, "telemetry");
		assert.equal(row.kind, "schema-reject");
		assert.equal(row.rejected_count, 1);
		assert.doesNotMatch(JSON.stringify(row), /must-not-leak|raw_prompt/);
	});
});

test("raw exception text is reduced to class, length, and SHA-256", () => {
	withFile((file) => {
		record("reflect", "review-error", { error: "Authorization bearer super-secret-value" });
		const row = JSON.parse(readFileSync(file, "utf8").trim());
		assert.equal(row.error_class, "auth");
		assert.equal(row.error_length, Buffer.byteLength("Authorization bearer super-secret-value"));
		assert.match(row.error_sha256, /^[0-9a-f]{64}$/);
		assert.doesNotMatch(JSON.stringify(row), /super-secret-value|Authorization bearer/);
	});
});

test("source defaults to interactive and unknown values cannot become authoritative", () => {
	withFile((file) => {
		delete process.env.TELEMETRY_SOURCE;
		record("verify-gate", "gate-green-consumed", {});
		let row = JSON.parse(readFileSync(file, "utf8").trim());
		assert.equal(row.source, "interactive");
		process.env.TELEMETRY_SOURCE = "misspelled";
		record("verify-gate", "gate-green-consumed", {});
		row = JSON.parse(readFileSync(file, "utf8").trim().split("\n").at(-1)!);
		assert.equal(row.source, "unknown");
		assert.equal(isAuthoritativeTelemetryRow({ ...row, mac: "valid-shape" }), false);
	});
});

test("v2 authority requires authenticated gate source; legacy MAC rows remain readable", () => {
	assert.equal(isAuthoritativeTelemetryRow({ schema: "pi.harness-event/v2", source: "gate", mac: "a" }), true);
	assert.equal(isAuthoritativeTelemetryRow({ schema: "pi.harness-event/v2", source: "test", mac: "a" }), false);
	assert.equal(isAuthoritativeTelemetryRow({ schema: "pi.harness-event/v2", source: "unknown", mac: "a" }), false);
	assert.equal(isAuthoritativeTelemetryRow({ ext: "legacy", mac: "a" }), true);
});

test("authenticated rows MAC the exact flat JSON payload", () => {
	const key = "k".repeat(32);
	const line = encodeTelemetryRow({ sk: "gate-a", ext: "context-watcher", kind: "compact-requested" }, key);
	const match = line.match(/^(.*),"mac":"([0-9a-f]{64})"}$/);
	assert.ok(match);
	const payload = `${match[1]}}`;
	assert.equal(match[2], createHmac("sha256", key).update(payload).digest("hex"));
	assert.deepEqual(JSON.parse(line), { sk: "gate-a", ext: "context-watcher", kind: "compact-requested", mac: match[2] });
});

test("si: one stable per-process session id, shared across module instances", async () => {
	// `run_id` falls back to the cwd key, so it is NOT session identity (the
	// 29%-then-0% exposure bug). `si` is one random id per pi process, stored on
	// globalThis so pi's per-extension jiti instances agree on it.
	withFile((file) => {
		record("loop-breaker", "steer", { tier: 1, byTool: true, byReason: false, repeat: 3, streak: 3, injected_chars: 4, turnIndex: 1 });
		record("verify-gate", "steer", { failed: true, fires: 1, sessionFires: 1, injected_chars: 8, turnIndex: 2 });
		const [a, b] = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.match(a.si, /^[0-9a-f-]{36}$/, "si must be a UUID");
		assert.equal(a.si, b.si, "one process = one si");
		assert.notEqual(a.si, a.sk, "si must not be the cwd key");
	});
	// A second module instance (fresh cache-busted import = pi's per-extension
	// jiti isolation) must reuse the SAME si via globalThis, not mint a new one.
	const shared = (globalThis as Record<string, unknown>)["__pi_telemetry_session_instance_v1"];
	const fresh = await import(`../lib/telemetry.ts?si-isolation=${Date.now()}`);
	withFile((file) => {
		fresh.record("loop-breaker", "steer", { tier: 1, byTool: true, byReason: false, repeat: 3, streak: 3, injected_chars: 4, turnIndex: 1 });
		const row = JSON.parse(readFileSync(file, "utf8").trim().split("\n").pop() as string);
		assert.equal(row.si, shared, "a fresh module instance must share the process si");
	});
});
