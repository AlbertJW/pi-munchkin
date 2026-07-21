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
	const env = buildSubagentEnv({ PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "needed", AWS_SECRET_ACCESS_KEY: "drop", NODE_OPTIONS: "--require evil", SSH_AUTH_SOCK: "/sock" });
	assert.deepEqual(env, { PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "needed" });
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

test("c33: SUBAGENT_DEFAULT_MODE=fork flips the default; explicit mode always wins; junk env is inert", async () => {
	const previous = process.env.SUBAGENT_DEFAULT_MODE;
	try {
		delete process.env.SUBAGENT_DEFAULT_MODE;
		const base = await import(`../vendor/pi-subagent/types.ts?mode1=${Date.now()}-${Math.random()}`);
		assert.equal(base.parseDelegationMode(undefined), "spawn", "shipped default is spawn");

		process.env.SUBAGENT_DEFAULT_MODE = "fork";
		assert.equal(base.parseDelegationMode(undefined), "fork", "env flips the default");
		assert.equal(base.parseDelegationMode("spawn"), "spawn", "explicit model choice beats the env default");
		assert.equal(base.parseDelegationMode("fork"), "fork");

		process.env.SUBAGENT_DEFAULT_MODE = "banana";
		assert.equal(base.parseDelegationMode(undefined), "spawn", "unknown env value keeps the shipped default");
		assert.equal(base.parseDelegationMode(42), null, "non-string explicit mode still rejected");
	} finally {
		if (previous === undefined) delete process.env.SUBAGENT_DEFAULT_MODE;
		else process.env.SUBAGENT_DEFAULT_MODE = previous;
	}
});
