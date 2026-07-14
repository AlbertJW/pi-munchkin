// Integration tests for the plan-runner RUNTIME (the 913-line adapter the pure
// plan-integrity tests never touch): /plan flow + plan-mode block, plan_write
// persistence + gates against a REAL shell, escalation, integrity reattach,
// abort observability, plus the micro-gate extension end-to-end (whose exec
// field-name bug pure tests could not see).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, fire, makeCtx, makeFakePi } from "./integration-harness.ts";

// module-load envs BEFORE importing the extensions
process.env.PLAN_GATE_MAX = "2";
process.env.MICRO_GATE = "on";
const planRunner = (await import("../extensions/plan-runner.ts")).default;
const microGate = (await import("../extensions/micro-gate.ts")).default;

const tmp = () => mkdtempSync(join(tmpdir(), "pi-int-"));

function freshPlanRunner() {
	const fp = makeFakePi();
	planRunner(fp.pi as any);
	return fp;
}

test("integration: /plan arms plan mode — mutations blocked, persistence written, prompt sent", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add a widget", ctx);

	assert.ok(fp.sent[0].includes("MODE: PLAN"), "plan prompt sent to the model");
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.autonomy, "lean");
	assert.equal(state.phase, "planned");

	const blocked = await fire(fp, "tool_call", { toolName: "edit", input: {} });
	assert.equal(blocked?.block, true, "edit blocked during PLAN phase");
	assert.ok(blocked.reason.includes("plan_mode_violation"));
	const bashMut = await fire(fp, "tool_call", { toolName: "bash", input: { command: "rm -rf src" } });
	assert.equal(bashMut?.block, true, "mutating bash blocked during PLAN phase");
	const read = await fire(fp, "tool_call", { toolName: "read", input: { path: "x" } });
	assert.equal(read, undefined, "read-only stays allowed while planning");
});

test("integration: plan_write persists items; /plan-go disarms the block and prompts RUN", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("do the thing", ctx);
	const r = await callTool(fp, "plan_write", {
		items: [{ title: "step one", status: "pending" }, { title: "step two", status: "pending" }],
		request: "do the thing", summary: "two steps",
	}, cwd);
	assert.ok(r.content[0].text.includes("Plan updated (2 items"));
	assert.equal(r.terminate, false, "plan_write must not end the turn");
	assert.ok(readFileSync(join(cwd, ".pi", "TODO.md"), "utf8").includes("step one"), "TODO.md rendered");

	await fp.commands.get("plan-go").handler("", ctx);
	assert.ok(fp.sent.at(-1)!.includes("MODE: RUN"), "execution prompt sent");
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.phase, "executing");
	const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} });
	assert.equal(edit, undefined, "mutation block disarmed after /plan-go");
});

test("integration: gate runs a REAL shell command — green keeps done, red reverts then blocks at GATE_MAX", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	writeFileSync(join(cwd, "good.sh"), "echo ok\n");
	writeFileSync(join(cwd, "bad.sh"), "if [ ; then fi\n"); // bash -n fails

	// green gate: stays done
	const g = await callTool(fp, "plan_write", {
		items: [{ title: "good work", status: "done", gate: "bash -n good.sh" }], request: "r", summary: "s",
	}, cwd);
	let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.items[0].status, "done", `green gate keeps done: ${g.content[0].text}`);

	// red gate: revert to in_progress with the gate error surfaced
	const r1 = await callTool(fp, "plan_write", {
		items: [{ title: "good work", status: "done", gate: "bash -n good.sh" },
			{ title: "bad work", status: "done", gate: "bash -n bad.sh" }], request: "r", summary: "s",
	}, cwd);
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	const bad = state.items.find((i: any) => i.title === "bad work");
	assert.equal(bad.status, "in_progress", "red gate reverts done");
	assert.equal(bad.gate_fails, 1);
	assert.ok(r1.content[0].text.includes("fix and re-run"), r1.content[0].text);

	// second red -> blocked at GATE_MAX=2
	await callTool(fp, "plan_write", {
		items: [{ title: "good work", status: "done", gate: "bash -n good.sh" },
			{ title: "bad work", status: "done", gate: "bash -n bad.sh" }], request: "r", summary: "s",
	}, cwd);
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.items.find((i: any) => i.title === "bad work").status, "blocked", "escalates at GATE_MAX");
});

test("integration: a mutating gate is rejected and dropped, item not trapped", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const r = await callTool(fp, "plan_write", {
		items: [{ title: "sneaky", status: "done", gate: "npm install leftpad" }], request: "r", summary: "s",
	}, cwd);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.notEqual(state.items[0].status, "done", "mutating gate cannot bless done");
	assert.equal(state.items[0].gate, undefined, "rejected gate dropped so it cannot re-trap");
	assert.ok(r.content[0].text.includes("dropped"), r.content[0].text);
});

test("integration: rewrite that omits a done item gets it reattached + warned", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	await callTool(fp, "plan_write", {
		items: [{ title: "finished thing", status: "done" }, { title: "next thing", status: "in_progress" }],
		request: "r", summary: "s",
	}, cwd);
	const r = await callTool(fp, "plan_write", {
		items: [{ title: "next thing", status: "in_progress" }], request: "r", summary: "s",
	}, cwd);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.ok(state.items.some((i: any) => i.title === "finished thing" && i.status === "done"),
		"done item reattached — work is never silently un-recorded");
	assert.ok(r.content[0].text.includes("plan integrity"), r.content[0].text);
});

test("integration: agent_end with open items writes the abort-observability trace", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("thing yolo", ctx); // yolo -> phase executing immediately
	await callTool(fp, "plan_write", { items: [{ title: "open item", status: "in_progress" }], request: "r", summary: "s" }, cwd);
	await fire(fp, "agent_end", {});
	const trace = readFileSync(join(cwd, ".pi", "traces", "plan-runner.jsonl"), "utf8");
	assert.ok(trace.includes("ended_without_completion"), "open-items end is observable in the trace");
});

test("integration: micro-gate fires a followUp on a REAL broken edit (would catch the exitCode-vs-code bug)", async () => {
	const fp = makeFakePi();
	microGate(fp.pi as any);
	const cwd = tmp();
	writeFileSync(join(cwd, "broken.js"), "function f( {\n"); // node --check fails
	await fire(fp, "turn_end", {
		message: { role: "assistant", content: [
			{ type: "toolCall", name: "edit", arguments: { input: "[broken.js#A1B2]\n@@\n-x\n+y" } },
		] },
	}, { cwd });
	assert.equal(fp.sent.length, 1, "micro-gate must FIRE on a file that fails node --check");
	assert.ok(fp.sent[0].includes("[micro-gate]") && fp.sent[0].includes("broken.js"), fp.sent[0]);

	// clean edit -> silent
	writeFileSync(join(cwd, "fine.js"), "export const x = 1;\n");
	await fire(fp, "turn_end", {
		message: { role: "assistant", content: [
			{ type: "toolCall", name: "edit", arguments: { input: "[fine.js#B2C3]\n@@\n-a\n+b" } },
		] },
	}, { cwd });
	assert.equal(fp.sent.length, 1, "no followUp for a parsing file");
});
