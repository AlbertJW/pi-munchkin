import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakePi, fire } from "./integration-harness.ts";

test("bash-output-guard: withholds oversized bash output when enabled; silent otherwise", async () => {
	const big = "x".repeat(9000);
	const event = () => ({
		toolName: "bash", toolCallId: "t1", input: { command: "find $HOME -name '*.json'" },
		content: [{ type: "text", text: big }],
		details: {}, isError: false,
	});
	// enabled
	process.env.BASH_OUTPUT_GUARD = "on";
	let fp = makeFakePi();
	(await import(`../extensions/bash-output-guard.ts?x=${Math.random()}`)).default(fp.pi);
	const withheld = await fire(fp, "tool_result", event(), { cwd: "/tmp/project" });
	assert.ok(withheld, "handler withheld the result");
	assert.ok(JSON.stringify(withheld.content).includes("too large to use directly"));
	assert.ok(JSON.stringify(withheld.content).includes("searched outside"));
	assert.equal(withheld.isError, true);
	// disabled -> no handler registered
	process.env.BASH_OUTPUT_GUARD = "";
	fp = makeFakePi();
	(await import(`../extensions/bash-output-guard.ts?x=${Math.random()}`)).default(fp.pi);
	const untouched = await fire(fp, "tool_result", event(), { cwd: "/tmp/project" });
	assert.equal(untouched, undefined, "dark by default");
});

test("bash-output-guard: leaves small bash output and non-bash tools untouched", async () => {
	process.env.BASH_OUTPUT_GUARD = "on";
	const fp = makeFakePi();
	(await import(`../extensions/bash-output-guard.ts?x=${Math.random()}`)).default(fp.pi);
	const small = await fire(fp, "tool_result", {
		toolName: "bash", toolCallId: "t2", input: { command: "pwd" },
		content: [{ type: "text", text: "ok" }], details: {}, isError: false,
	}, { cwd: "/tmp/project" });
	assert.equal(small, undefined, "small output is left alone");
	const big = "x".repeat(9000);
	const otherTool = await fire(fp, "tool_result", {
		toolName: "read", toolCallId: "t3", input: {},
		content: [{ type: "text", text: big }], details: {}, isError: false,
	}, { cwd: "/tmp/project" });
	assert.equal(otherTool, undefined, "only bash results are checked");
});
