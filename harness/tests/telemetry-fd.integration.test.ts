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
