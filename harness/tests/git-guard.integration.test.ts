import assert from "node:assert/strict";
import test from "node:test";
import { fire, makeCtx, makeFakePi } from "./integration-harness.ts";

test("git guard blocks unresolved dynamic targets without executing status", async () => {
	const fp = makeFakePi();
	let execCalls = 0;
	(fp.pi as any).exec = async () => { execCalls++; return { stdout: "", stderr: "", code: 0 }; };
	const guard = (await import(`../extensions/git-guard.ts?dynamic=${Math.random()}`)).default;
	guard(fp.pi as any);
	const { ctx } = makeCtx("/work");
	const result = await fire(fp, "tool_call", { toolName: "bash", input: { command: "git -C $TARGET reset --hard" } }, ctx);
	assert.equal(result?.block, true);
	assert.match(result?.reason, /Refusing destructive git command/);
	assert.equal(execCalls, 0);
});

test("git guard fails closed when targeted status cannot be verified", async () => {
	const fp = makeFakePi();
	let args: string[] = [];
	(fp.pi as any).exec = async (_cmd: string, nextArgs: string[]) => { args = nextArgs; return { stdout: "", stderr: "bad repo", code: 128 }; };
	const guard = (await import(`../extensions/git-guard.ts?status=${Math.random()}`)).default;
	guard(fp.pi as any);
	const { ctx } = makeCtx("/work");
	const result = await fire(fp, "tool_call", { toolName: "bash", input: { command: `git -C "repo one" reset --hard` } }, ctx);
	assert.equal(result?.block, true);
	assert.deepEqual(args, ["-C", "repo one", "status", "--porcelain"]);
	assert.match(result?.reason, /fail-closed/);
});
