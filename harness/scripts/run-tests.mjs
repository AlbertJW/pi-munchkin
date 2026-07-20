#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const liveFile = join(homedir(), ".pi", "agent", "telemetry", "events.jsonl");
const tempDir = mkdtempSync(join(tmpdir(), "pi-munchkin-tests-"));
const testFile = join(tempDir, "telemetry", "events.jsonl");

function snapshot(path) {
	if (!existsSync(path)) return { exists: false };
	const stat = statSync(path);
	return {
		exists: true,
		size: stat.size,
		mtimeMs: stat.mtimeMs,
		sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
	};
}

const before = snapshot(liveFile);
const tests = readdirSync(join(process.cwd(), "harness", "tests"))
	.filter((name) => name.endsWith(".test.ts"))
	.sort()
	.map((name) => join("harness", "tests", name));
const childEnv = { ...process.env };
for (const key of Object.keys(childEnv)) {
	if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete childEnv[key];
}
for (const key of ["TELEMETRY_FD", "TELEMETRY_HMAC_FD", "NODE_OPTIONS", "BASH_ENV", "ENV", "ZDOTDIR"]) {
	delete childEnv[key];
}
Object.assign(childEnv, {
	TELEMETRY: "on",
	TELEMETRY_FILE: testFile,
	TELEMETRY_SOURCE: "test",
	TELEMETRY_STRICT: "1",
});
let result;
try {
	result = spawnSync(
		process.execPath,
		["--experimental-strip-types", "--test", ...tests],
		{
			cwd: process.cwd(),
			env: childEnv,
			stdio: "inherit",
		},
	);
	const after = snapshot(liveFile);
	if (JSON.stringify(before) !== JSON.stringify(after)) {
		console.error(`test telemetry isolation failure: live telemetry changed: ${liveFile}`);
		process.exitCode = 1;
	} else {
		process.exitCode = result.status ?? 1;
	}
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
