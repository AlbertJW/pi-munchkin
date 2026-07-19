import assert from "node:assert/strict";
import test from "node:test";
import { gateEnvironment, runReadonlyGate } from "../lib/gate-runtime.ts";

test("gate environment keeps runtime basics and drops credentials/hooks", () => {
	const env = gateEnvironment({ PATH: "/bin", HOME: "/home/u", OPENAI_API_KEY: "secret", AWS_SECRET_ACCESS_KEY: "secret", NODE_OPTIONS: "--require evil" });
	assert.deepEqual(env.sort(), ["HOME=/home/u", "PATH=/bin"]);
});

test("gate runtime revalidates policy and executes with env -i, closed stdin, and timeout", async () => {
	const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
	const exec = async (command: string, args: string[], options: any) => {
		calls.push({ command, args, options });
		return { stdout: "12 passed", stderr: "", code: 0, killed: false };
	};
	assert.equal((await runReadonlyGate(exec, "/work", "./unknown-check", 123)).pass, false);
	assert.equal(calls.length, 0, "rejected command is never executed");
	const result = await runReadonlyGate(exec, "/work", "npm test", 123);
	assert.equal(result.pass, true);
	const call = calls[0];
	assert.equal(call.command, "/usr/bin/env");
	assert.equal(call.args[0], "-i");
	assert.ok(call.args.includes("--noprofile"));
	assert.ok(call.args.at(-1)?.includes("exec </dev/null"));
	assert.deepEqual(call.options, { cwd: "/work", timeout: 123, signal: undefined });
});

test("gate runtime treats killed and textual failures as failures", async () => {
	const killed = await runReadonlyGate(async () => ({ stdout: "", stderr: "", code: 0, killed: true }), "/w", "npm test", 5);
	assert.equal(killed.pass, false);
	assert.equal(killed.reason, "timeout");
	const lying = await runReadonlyGate(async () => ({ stdout: "FAIL: 1 failed", stderr: "", code: 0 }), "/w", "npm test", 5);
	assert.equal(lying.pass, false);
	assert.equal(lying.reason, "failing-output");
});
