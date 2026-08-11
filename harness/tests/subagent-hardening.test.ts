import assert from "node:assert/strict";
import test from "node:test";
import { parseInheritedCliArgs } from "../vendor/pi-subagent/runner-cli.js";
import { buildSubagentEnv } from "../vendor/pi-subagent/runner-env.js";
import { normalizeCompletedResult, emptyUsage, isResultSuccess, type SingleResult } from "../vendor/pi-subagent/types.ts";

test("subagent argv never inherits API keys", () => {
	const parsed = parseInheritedCliArgs(["node", "pi", "--provider", "openai", "--api-key", "super-secret", "--model", "gpt"]);
	assert.deepEqual(parsed.alwaysProxy, ["--provider", "openai"]);
	assert.equal(JSON.stringify(parsed).includes("super-secret"), false);
});

test("subagent environment is reduced and excludes unrelated secrets and shell injection", () => {
	const env = buildSubagentEnv({ PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "needed", LLAMA_API_KEY: "dummy-llama", AWS_SECRET_ACCESS_KEY: "drop", NODE_OPTIONS: "--require evil", SSH_AUTH_SOCK: "/sock" });
	assert.deepEqual(env, { PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "needed", LLAMA_API_KEY: "dummy-llama" });
});

test("subagent explicit environment allowlist accepts valid names only", () => {
	const env = buildSubagentEnv({
		PATH: "/bin", PI_SUBAGENT_ENV_ALLOW: "CUSTOM_SENTINEL,bad-name, ALSO_OK ",
		CUSTOM_SENTINEL: "dummy-one", ALSO_OK: "dummy-two", "bad-name": "drop",
	});
	// PI_SUBAGENT_ENV_ALLOW itself propagates so nested children honor the same list.
	assert.deepEqual(env, {
		PATH: "/bin", PI_SUBAGENT_ENV_ALLOW: "CUSTOM_SENTINEL,bad-name, ALSO_OK ",
		CUSTOM_SENTINEL: "dummy-one", ALSO_OK: "dummy-two",
	});
});

test("abort and signal/nonzero failures cannot be overridden by semantic output", () => {
	const base: SingleResult = { agent: "a", agentSource: "project", task: "t", exitCode: 143, messages: [{ role: "assistant", content: [{ type: "text", text: "done" }], api: "x", provider: "x", model: "x", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: 0 } as any], stderr: "signal", usage: emptyUsage(), sawAgentEnd: true };
	const signaled = normalizeCompletedResult({ ...base }, false);
	assert.equal(signaled.exitCode, 143);
	assert.equal(signaled.stopReason, "error");
	assert.equal(isResultSuccess(signaled), false);
	const aborted = normalizeCompletedResult({ ...base, exitCode: 0 }, true);
	assert.equal(aborted.exitCode, 130);
	assert.equal(aborted.stopReason, "aborted");
});

test("c36: executor description rewritten to spawn at injection time; other roles and flag-off untouched", async () => {
	const { agentDescriptionForPrompt } = await import("../vendor/pi-subagent/types.ts");
	const executor = "Isolated single-change worker. Delegate ONE bounded, fully-specified edit here when you want it done off the main window. Use mode=fork so it has surrounding context. Reports exact changed files. Prefer doing trivial edits yourself.";
	const explorer = "Read-only context gatherer. Returns distilled facts.";
	const previous = process.env.SPAWN_DELEGATION;
	try {
		// ADOPTED 2026-08-07: default-on (was dark candidate c36) — unset must rewrite.
		process.env.SPAWN_DELEGATION = "on";
		const rewritten = agentDescriptionForPrompt(executor);
		assert.ok(rewritten.includes("Use mode=spawn with a fully self-contained task — the child sees nothing else."), rewritten);
		assert.ok(!rewritten.includes("mode=fork"), rewritten);
		assert.equal(agentDescriptionForPrompt(explorer), explorer, "roles without the fork sentence pass through");

		delete process.env.SPAWN_DELEGATION;
		assert.equal(agentDescriptionForPrompt(executor), rewritten, "unset = default-on: rewrite");
		process.env.SPAWN_DELEGATION = "banana";
		assert.equal(agentDescriptionForPrompt(executor), rewritten, "junk env = default-on: rewrite");
		process.env.SPAWN_DELEGATION = "off";
		assert.equal(agentDescriptionForPrompt(executor), executor, "SPAWN_DELEGATION=off is the kill switch — identity");
	} finally {
		if (previous === undefined) delete process.env.SPAWN_DELEGATION;
		else process.env.SPAWN_DELEGATION = previous;
	}
});

test("every env key harness code reads is classified for subagent propagation", async () => {
	const { readdirSync, readFileSync, statSync } = await import("node:fs");
	const { join } = await import("node:path");
	const { CHILD_ENV_KEYS, EXCLUDED_HARNESS_ENV_KEYS, HARNESS_CONFIG_KEYS } = await import("../vendor/pi-subagent/runner-env.js");
	const classified = new Set([...CHILD_ENV_KEYS, ...HARNESS_CONFIG_KEYS, ...EXCLUDED_HARNESS_ENV_KEYS]);
	for (const key of HARNESS_CONFIG_KEYS) {
		assert.ok(!EXCLUDED_HARNESS_ENV_KEYS.includes(key), `${key} is both propagated and excluded`);
	}
	const roots = ["extensions", "lib", "vendor"].map((d) => join(import.meta.dirname, "..", d));
	const unclassified = new Set<string>();
	const walk = (dir: string): void => {
		for (const name of readdirSync(dir)) {
			const path = join(dir, name);
			if (statSync(path).isDirectory()) { walk(path); continue; }
			if (!/\.(ts|js|mjs)$/.test(name)) continue;
			const source = readFileSync(path, "utf8");
			for (const match of source.matchAll(/env\.([A-Z][A-Z0-9_]{2,})/g)) {
				if (!classified.has(match[1])) unclassified.add(`${match[1]} (${name})`);
			}
		}
	};
	for (const root of roots) walk(root);
	assert.deepEqual([...unclassified].sort(), [],
		"new env reads must be added to HARNESS_CONFIG_KEYS (propagate to subagents) or EXCLUDED_HARNESS_ENV_KEYS (with a reason)");
});

test("explicit =off suppression survives into the subagent environment", () => {
	// The 2026-08-07 flips made unset mean ON; a child env that drops the
	// parent's explicit `=off` silently re-enables the mechanism mid-arm.
	const env = buildSubagentEnv({
		PATH: "/bin", FORCE_PLAN_WRITE: "off", SPAN_TOOLS: "off", RUN_KERNEL: "shadow",
		TELEMETRY_FD: "7", CHAOS: "bash:2:enoent", PI_RUN_ID: "parent-run",
	});
	assert.equal(env.FORCE_PLAN_WRITE, "off");
	assert.equal(env.SPAN_TOOLS, "off");
	assert.equal(env.RUN_KERNEL, "shadow");
	assert.equal(env.TELEMETRY_FD, undefined, "process-local fds never cross");
	assert.equal(env.CHAOS, undefined, "fault injection stays parent-scoped");
	assert.equal(env.PI_RUN_ID, undefined, "child derives its own run identity");
});
