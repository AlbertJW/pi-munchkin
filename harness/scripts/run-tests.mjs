#!/usr/bin/env node

import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "pi-munchkin-tests-"));
const testFile = join(tempDir, "telemetry", "events.jsonl");
// Isolation by construction: test children get a throwaway HOME, so even
// fallback telemetry paths (~/.pi/agent/telemetry) resolve inside the temp
// tree. The previous approach — snapshotting the LIVE telemetry file and
// blaming any change on the tests — false-failed whenever a concurrent
// interactive pi session appended its own legitimate rows mid-run.
const tempHome = join(tempDir, "home");
mkdirSync(join(tempHome, ".config"), { recursive: true });

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
	HOME: tempHome,
	XDG_CONFIG_HOME: join(tempHome, ".config"),
});
try {
	const result = spawnSync(
		process.execPath,
		["--experimental-strip-types", "--test", ...tests],
		{
			cwd: process.cwd(),
			env: childEnv,
			stdio: "inherit",
		},
	);
	process.exitCode = result.status ?? 1;
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
