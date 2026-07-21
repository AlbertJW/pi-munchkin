#!/usr/bin/env node

import { existsSync, mkdirSync, mkdtempSync, openSync, readSync, closeSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempDir = mkdtempSync(join(tmpdir(), "pi-munchkin-tests-"));
const testFile = join(tempDir, "telemetry", "events.jsonl");
// Isolation by construction: test children get a throwaway HOME, so even
// fallback telemetry paths (~/.pi/agent/telemetry) resolve inside the temp
// tree. The earlier snapshot-and-blame approach false-failed whenever a
// concurrent interactive pi session appended legitimate rows mid-run.
const tempHome = join(tempDir, "home");
mkdirSync(join(tempHome, ".config"), { recursive: true });

// Leak detection (acceptance condition): the live telemetry file must gain
// no TEST-tagged rows during the run. Only the region appended during the
// run is inspected, and only rows with source === "test" fail the build —
// an escaped absolute-path write, restored env, or independently spawned
// child would carry that tag, while interactive appends pass through.
const liveFile = join(homedir(), ".pi", "agent", "telemetry", "events.jsonl");
const liveSizeBefore = existsSync(liveFile) ? statSync(liveFile).size : 0;

function escapedTestRows() {
	if (!existsSync(liveFile)) return [];
	const sizeAfter = statSync(liveFile).size;
	// On shrink/rotation the offset is meaningless — rescan the whole file.
	const from = sizeAfter >= liveSizeBefore ? liveSizeBefore : 0;
	const length = sizeAfter - from;
	if (length <= 0) return [];
	const fd = openSync(liveFile, "r");
	let appended;
	try {
		const buf = Buffer.alloc(length);
		const n = readSync(fd, buf, 0, length, from);
		appended = buf.subarray(0, n).toString("utf8");
	} finally {
		closeSync(fd);
	}
	const leaks = [];
	for (const line of appended.split("\n")) {
		if (!line.trim()) continue;
		try {
			const row = JSON.parse(line);
			if (row && row.source === "test") leaks.push(line.slice(0, 200));
		} catch {
			// partial/foreign line — not attributable to the tests
		}
	}
	return leaks;
}

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
	const leaks = escapedTestRows();
	if (leaks.length) {
		console.error(`test telemetry isolation failure: ${leaks.length} test-tagged row(s) escaped to ${liveFile}:`);
		for (const leak of leaks) console.error(`  ${leak}`);
		process.exitCode = 1;
	} else {
		process.exitCode = result.status ?? 1;
	}
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
