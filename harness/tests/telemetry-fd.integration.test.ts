import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("gate telemetry uses inherited authenticated fds that tool children cannot write", () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-telemetry-fd-"));
	const keyPath = join(dir, "key");
	const outputPath = join(dir, "events.jsonl");
	const key = "a".repeat(64);
	writeFileSync(keyPath, key);
	const keyFd = openSync(keyPath, "r");
	const outputFd = openSync(outputPath, "w+");
	try {
		const telemetryUrl = pathToFileURL(join(import.meta.dirname, "../lib/telemetry.ts")).href;
		const source = [
			`import { spawnSync } from "node:child_process";`,
			`import { record } from ${JSON.stringify(telemetryUrl)};`,
			`record("context-watcher", "session-config", { enabled: false });`,
			`const attempted = spawnSync("/bin/sh", ["-c", "printf forged >&8"], { encoding: "utf8" });`,
			`if (attempted.status === 0) process.exit(42);`,
		].join("\n");
		const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
			env: { ...process.env, TELEMETRY: "on", TELEMETRY_HMAC_FD: "3", TELEMETRY_FD: "8" },
			stdio: ["ignore", "pipe", "pipe", keyFd, "ignore", "ignore", "ignore", "ignore", outputFd],
			encoding: "utf8",
		});
		assert.equal(child.status, 0, child.stderr);
		const line = readFileSync(outputPath, "utf8").trim();
		assert.doesNotMatch(line, /forged/);
		const match = line.match(/^(.*),"mac":"([0-9a-f]{64})"}$/);
		assert.ok(match);
		const payload = `${match[1]}}`;
		assert.equal(match[2], createHmac("sha256", key).update(payload).digest("hex"));
	} finally {
		closeSync(keyFd);
		closeSync(outputFd);
		rmSync(dir, { recursive: true, force: true });
	}
});

test("two independent module instances of telemetry.ts (jiti's per-extension moduleCache:false) both sign correctly", () => {
	// pi's extension loader gives each extension its own jiti instance with
	// module caching OFF (dist/core/extensions/loader.js), so lib/telemetry.ts's
	// module-level MAC_KEY resolution runs once PER EXTENSION that imports it,
	// not once per process. Reading fd 3 directly (a real POSIX descriptor that
	// gets drained on read) would make only the FIRST extension's copy signed —
	// reproduced live: a context-watcher.ts event went out unsigned in a real
	// gate session while later events from other extensions were signed.
	// Simulate two separate module instances via distinct query-string
	// specifiers (the same trick this suite's own tests use for fresh instances)
	// and confirm BOTH end up signed with the SAME key, proving the fd is only
	// ever actually read once (via the globalThis cache) rather than drained by
	// the first importer and left empty for the second.
	const dir = mkdtempSync(join(tmpdir(), "pi-telemetry-fd-multi-"));
	const keyPath = join(dir, "key");
	const outputPath = join(dir, "events.jsonl");
	const key = "b".repeat(64);
	writeFileSync(keyPath, key);
	const keyFd = openSync(keyPath, "r");
	const outputFd = openSync(outputPath, "w+");
	try {
		const telemetryUrl = pathToFileURL(join(import.meta.dirname, "../lib/telemetry.ts")).href;
		const source = [
			`import { record as recordA } from ${JSON.stringify(`${telemetryUrl}?instance=a`)};`,
			`import { record as recordB } from ${JSON.stringify(`${telemetryUrl}?instance=b`)};`,
			`recordA("verify-gate", "gate-green-consumed", {});`,
			`recordB("verify-gate", "gate-green-consumed", {});`,
		].join("\n");
		const child = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], {
			env: { ...process.env, TELEMETRY: "on", TELEMETRY_HMAC_FD: "3", TELEMETRY_FD: "8" },
			stdio: ["ignore", "pipe", "pipe", keyFd, "ignore", "ignore", "ignore", "ignore", outputFd],
			encoding: "utf8",
		});
		assert.equal(child.status, 0, child.stderr);
		const lines = readFileSync(outputPath, "utf8").trim().split("\n");
		assert.equal(lines.length, 2, "both module instances must have written a row");
		for (const line of lines) {
			const match = line.match(/^(.*),"mac":"([0-9a-f]{64})"}$/);
			assert.ok(match, `every row must be signed, got: ${line}`);
			const payload = `${match[1]}}`;
			assert.equal(match[2], createHmac("sha256", key).update(payload).digest("hex"));
		}
	} finally {
		closeSync(keyFd);
		closeSync(outputFd);
		rmSync(dir, { recursive: true, force: true });
	}
});
