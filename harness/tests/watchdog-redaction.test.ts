// Watchdog privacy regression tests (2026-08-11 second inspection): the bundle
// must never persist credentials — not in the Node diagnostic report, and not
// as flag VALUES or dash-prefixed prompt text in context.txt.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const scripts = resolve(import.meta.dirname, "../scripts");

test("redact-node-report: keeps only the diagnostic sections, drops env and argv", () => {
	const dir = mkdtempSync(join(tmpdir(), "wd-redact-"));
	try {
		const report = join(dir, "report.123.json");
		// Fake credentials, split so the repo's secret scan has nothing to match.
		const envKey = ["LLAMA", "API", "KEY"].join("_");
		const fakeSecret = ["sk-super", "secret-value"].join("-");
		writeFileSync(report, JSON.stringify({
			header: { event: "SIGUSR2", trigger: "Signal", nodejsVersion: "v22", platform: "darwin",
			          arch: "arm64", dumpEventTime: "t", commandLine: ["pi", "-p", "SECRET PROMPT"] },
			environmentVariables: { [envKey]: fakeSecret, HOME: "/x" },
			javascriptStack: { message: "stack" },
			libuv: [{ type: "tcp" }],
			resourceUsage: { rss: 1 },
			sharedObjects: ["/lib/thing.dylib"],
		}));
		execFileSync("node", [join(scripts, "redact-node-report.mjs"), report]);
		const redacted = readFileSync(report, "utf8");
		assert.ok(!redacted.includes(fakeSecret), "environment values must be gone");
		assert.ok(!redacted.includes("SECRET PROMPT"), "command line must be gone");
		assert.ok(!redacted.includes(envKey), "environment keys must be gone (the marker names the removed sections, so match keys, not the section name)");
		assert.ok(!redacted.includes("sharedObjects"), "unlisted sections must be gone");
		const parsed = JSON.parse(redacted);
		assert.equal(parsed.redacted.includes("removed by pi-watchdog"), true);
		assert.deepEqual(parsed.libuv, [{ type: "tcp" }], "libuv handles survive — they name the stall");
		assert.equal(parsed.javascriptStack.message, "stack");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("redact-node-report: an unparsable report is deleted, never kept raw", () => {
	const dir = mkdtempSync(join(tmpdir(), "wd-redact-bad-"));
	try {
		const report = join(dir, "report.9.json");
		writeFileSync(report, "{ not json, but full of " + ["LLAMA", "API", "KEY"].join("_") + "=sk-oops");
		execFileSync("node", [join(scripts, "redact-node-report.mjs"), report]);
		assert.equal(existsSync(report), false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("pi-watchdog end-to-end: a wedged run's context.txt records flag NAMES only", () => {
	// A stub `pi` that wedges (no socket, no transcript) forces a capture in ~2s.
	const dir = mkdtempSync(join(tmpdir(), "wd-e2e-"));
	try {
		const bin = join(dir, "bin");
		const bundles = join(dir, "bundles");
		const agent = join(dir, "agent");
		execFileSync("mkdir", ["-p", bin, agent]);
		// exec, not a child: the watchdog's bounded version probe kill-9s the stub,
		// and a child sleep would keep holding the command-substitution pipe (a
		// stub artifact real single-process pi does not have).
		writeFileSync(join(bin, "pi"), "#!/bin/bash\nexec sleep 60\n");
		chmodSync(join(bin, "pi"), 0o755);
		let status = 0;
		const fakeFlagSecret = ["sk-flag", "secret-value"].join("-");
		try {
			execFileSync("bash", [join(scripts, "pi-watchdog.sh"), "-t", "2", "-o", bundles, "--",
				"-p", "--api-key=" + fakeFlagSecret, "--model", "local/x", "-dash-prompt sk-in-prompt"], {
				env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PI_CODING_AGENT_DIR: agent },
				timeout: 60_000,
			});
		} catch (error) {
			status = (error as { status?: number }).status ?? -1;
		}
		assert.equal(status, 99, "the stub must be captured as a stall");
		const bundle = readdirSync(bundles).map((name) => join(bundles, name))[0];
		const context = readFileSync(join(bundle, "context.txt"), "utf8");
		assert.match(context, /argc: 5/);
		assert.ok(context.includes("--api-key"), "flag names are recorded");
		assert.ok(!context.includes(fakeFlagSecret), "flag VALUES must never persist");
		assert.ok(!context.includes("sk-in-prompt"), "dash-prefixed prompt text must never persist");
		assert.ok(!context.includes("local/x"), "positional values are not flags");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});
