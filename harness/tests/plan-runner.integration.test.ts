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

test("integration: PLAN_SUBAGENT_ONLY blocks direct edits AND mutating bash during execution, points at subagent only when it's actually available", async () => {
	process.env.PLAN_SUBAGENT_ONLY = "1";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?so=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("add a widget", ctx);

		// still planning: the ordinary plan-mode block fires first, subagent-only
		// branch is never reached.
		const duringPlan = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(duringPlan?.block, true, "plan-mode block still fires while planning");
		assert.ok(duringPlan.reason.includes("plan_mode_violation"));

		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }],
			request: "add a widget", summary: "one step",
		}, cwd);
		await fp.commands.get("plan-go").handler("", ctx);

		// fake harness defaults getActiveTools() to [] — subagent not available here.
		const editNoSubagent = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(editNoSubagent?.block, true, "direct edit blocked during execution under PLAN_SUBAGENT_ONLY");
		assert.ok(editNoSubagent.reason.includes("PLAN_SUBAGENT_ONLY"));
		assert.ok(!editNoSubagent.reason.includes("subagent(executor"),
			"must not tell the model to use a tool that isn't actually available");
		assert.ok(editNoSubagent.reason.includes("no subagent tool is available"));

		const bashMut = await fire(fp, "tool_call", { toolName: "bash", input: { command: "sed -i s/a/b/ file" } }, ctx);
		assert.equal(bashMut?.block, true, "mutating bash blocked too, not just edit/write/multiedit");

		const bashReadonly = await fire(fp, "tool_call", { toolName: "bash", input: { command: "cat file" } }, ctx);
		assert.equal(bashReadonly, undefined, "read-only bash stays allowed");

		const read = await fire(fp, "tool_call", { toolName: "read", input: { path: "x" } }, ctx);
		assert.equal(read, undefined, "read-only tool calls stay allowed");

		// now with subagent genuinely available: the reason should point at it.
		fp.pi.getActiveTools = () => ["subagent"];
		const editWithSubagent = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(editWithSubagent?.block, true);
		assert.ok(editWithSubagent.reason.includes("subagent(executor"));
	} finally {
		delete process.env.PLAN_SUBAGENT_ONLY;
	}
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
	// ladder rung 1: locality protocol with the actual failing output embedded
	assert.ok(r1.content[0].text.includes("LOCALIZE"), r1.content[0].text);
	assert.ok(r1.content[0].text.includes("Failing output"), r1.content[0].text);

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
	await fire(fp, "agent_end", {}, ctx);
	const trace = readFileSync(join(cwd, ".pi", "traces", "plan-runner.jsonl"), "utf8");
	assert.ok(trace.includes("ended_without_completion"), "open-items end is observable in the trace");
});

test("integration: micro-gate steers immediately on a REAL broken edit (would catch delivery/API-shape bugs)", async () => {
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
	assert.equal(fp.deliveries[0].deliverAs, "steer", "parse failure must reach the next model call, not wait as a follow-up");

	// clean edit -> silent
	writeFileSync(join(cwd, "fine.js"), "export const x = 1;\n");
	await fire(fp, "turn_end", {
		message: { role: "assistant", content: [
			{ type: "toolCall", name: "edit", arguments: { input: "[fine.js#B2C3]\n@@\n-a\n+b" } },
		] },
	}, { cwd });
	assert.equal(fp.sent.length, 1, "no steer for a parsing file");

	// Python syntax checking must be side-effect free (py_compile created
	// __pycache__ in the candidate worktree).
	writeFileSync(join(cwd, "fine.py"), "x = 1\n");
	await fire(fp, "turn_end", {
		message: { role: "assistant", content: [
			{ type: "toolCall", name: "write", arguments: { path: "fine.py", content: "x = 1\n" } },
		] },
	}, { cwd });
	assert.equal(existsSync(join(cwd, "__pycache__")), false, "ast.parse must not create bytecode residue");
});

test("integration: a needs-input block VOICES the question (tool result) + agent_end backstop notify", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx, notes } = makeCtx(cwd);
	await fp.commands.get("plan").handler("do something ambiguous", ctx);
	const r = await callTool(fp, "plan_write", { items: [
		{ id: "i1", title: "Pick the deploy target", status: "blocked",
		  failure_class: "blocked_needs_input", note: "Which environment: staging or prod?" },
	] }, cwd);
	const body = r.content[0].text;
	assert.ok(body.includes("blocked on the user"), "tool result carries the ask-now steer");
	assert.ok(/ask the user/i.test(body), "steer instructs asking in plain text");
	// backstop: run ends without the model asking -> UI notify carries the question
	await fire(fp, "agent_end", {}, ctx);
	assert.ok(notes.some((n) => n.includes("waiting on you") && n.includes("staging or prod")),
		`agent_end notify surfaces the parked question (notes: ${JSON.stringify(notes)})`);
});

test("integration: completing the FINAL item demands a self-contained report; mid-plan does not", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("two step task", ctx);
	const mid = await callTool(fp, "plan_write", { items: [
		{ id: "a", title: "step one", status: "done" },
		{ id: "b", title: "step two", status: "in_progress" },
	] }, cwd);
	assert.ok(!mid.content[0].text.includes("self-contained report"), "no report demand mid-plan");
	const fin = await callTool(fp, "plan_write", { items: [
		{ id: "a", title: "step one", status: "done" },
		{ id: "b", title: "step two", status: "done" },
	] }, cwd);
	assert.ok(fin.content[0].text.includes("self-contained report"), "completion demands the report");
	// idempotence: rewriting an already-completed plan must not re-demand
	const again = await callTool(fp, "plan_write", { items: [
		{ id: "a", title: "step one", status: "done" },
		{ id: "b", title: "step two", status: "done" },
	] }, cwd);
	assert.ok(!again.content[0].text.includes("self-contained report"), "no re-demand on rewrite");
});

test("integration: gate ladder rung 2 — subagent delegation when available, fresh-approach otherwise", async () => {
	// rung 2 needs 2 <= fails < GATE_MAX, so re-import with a higher cap than the
	// module-load PLAN_GATE_MAX=2 pin.
	process.env.PLAN_GATE_MAX = "4";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?ladder=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		writeFileSync(join(cwd, "bad.sh"), "if [ ; then fi\n"); // bash -n fails
		const failOnce = () => callTool(fp, "plan_write", {
			items: [{ title: "bad work", status: "done", gate: "bash -n bad.sh" }], request: "r", summary: "s",
		}, cwd);

		const r1 = await failOnce();
		assert.ok(r1.content[0].text.includes("LOCALIZE"), `rung 1 first: ${r1.content[0].text}`);

		// fake harness getActiveTools() defaults to [] — solo wording, no false tool pointer
		const r2 = await failOnce();
		assert.ok(r2.content[0].text.includes("DIFFERENT approach"), `rung 2 solo: ${r2.content[0].text}`);
		assert.ok(!r2.content[0].text.includes("subagent(executor"),
			"must not point at a subagent tool that isn't available");

		// with subagent available the rung-2 steer delegates
		fp.pi.getActiveTools = () => ["subagent"];
		const r3 = await failOnce();
		assert.ok(r3.content[0].text.includes("subagent(executor"), `rung 2 delegate: ${r3.content[0].text}`);

		// terminal rung: blocked at GATE_MAX=4
		await failOnce();
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked", "escalates at GATE_MAX");
	} finally {
		process.env.PLAN_GATE_MAX = "2";
	}
});

test("integration: plan_write with a broken dependency graph is rejected, state untouched", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const bad = await callTool(fp, "plan_write", {
		items: [{ title: "a", status: "pending", depends_on: ["ghost"] }], request: "r", summary: "s",
	}, cwd);
	assert.equal(bad.isError, true, "unknown dep ref rejects the call");
	assert.ok(bad.content[0].text.includes("ghost"), bad.content[0].text);
	assert.ok(!existsSync(join(cwd, ".pi", "plan-state.json")), "no state written on rejection");

	const cycle = await callTool(fp, "plan_write", {
		items: [
			{ title: "a", status: "pending", depends_on: ["b"] },
			{ title: "b", status: "pending", depends_on: ["a"] },
		], request: "r", summary: "s",
	}, cwd);
	assert.equal(cycle.isError, true, "cycle rejects the call");
	assert.ok(cycle.content[0].text.includes("cycle"), cycle.content[0].text);
	assert.ok(!existsSync(join(cwd, ".pi", "plan-state.json")), "still no state written");
});

test("integration: valid deps stored, rendered in TODO.md, unmet-dep work warned (advisory)", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	await callTool(fp, "plan_write", {
		items: [
			{ title: "build", status: "pending" },
			{ title: "ship", status: "pending", depends_on: ["build"] },
		], request: "r", summary: "s",
	}, cwd);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.deepEqual(state.items[1].depends_on, ["build"]);
	assert.ok(readFileSync(join(cwd, ".pi", "TODO.md"), "utf8").includes("(after: build)"), "TODO shows ordering");

	// working the dependent while its dep is open → advisory warn, NO reversion
	const r = await callTool(fp, "plan_write", {
		items: [
			{ title: "build", status: "pending" },
			{ title: "ship", status: "in_progress", depends_on: ["build"] },
		], request: "r", summary: "s",
	}, cwd);
	assert.ok(r.content[0].text.includes("depends on unfinished"), r.content[0].text);
	const after = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(after.items[1].status, "in_progress", "advisory only — status untouched");
});

test("integration: interrupted plan from another process — session_start notice, /plan-go partial-work block, plan_write one-shot warn", async () => {
	const fp = makeFakePi();
	const mod = await import(`../extensions/plan-runner.ts?resume=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as any);
	const cwd = tmp();
	const { ctx, notes } = makeCtx(cwd);
	const foreignState = () => JSON.stringify({
		schema_version: 3, run_id: "prev-run", request: "half-done refactor", summary: "s",
		autonomy: "lean", phase: "executing", created_at: "2026-07-20T00:00:00Z",
		updated_at: "2026-07-20T00:00:00Z", writer: "other-process",
		items: [
			{ id: "i1", title: "rename module", status: "in_progress" },
			{ id: "i2", title: "update callers", status: "pending" },
		],
	});
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(join(cwd, ".pi", "plan-state.json"), foreignState());

	await fire(fp, "session_start", { reason: "startup" }, ctx);
	assert.ok(notes.some((n) => n.includes("Interrupted plan") && n.includes("/plan-status")),
		`session_start surfaces the interrupted plan (notes: ${JSON.stringify(notes)})`);
	assert.ok(notes[0].includes("may have partial work"), notes[0]);
	notes.length = 0;
	await fire(fp, "session_start", { reason: "startup" }, ctx);
	assert.equal(notes.length, 0, "notice fires once per process");

	// /plan-go: execute prompt carries the partial-work inspection block
	await fp.commands.get("plan-go").handler("", ctx);
	assert.ok(fp.sent.at(-1)!.includes("PARTIAL WORK") && fp.sent.at(-1)!.includes("rename module"),
		`resume prompt flags partial work: ${fp.sent.at(-1)}`);

	// headless path: restore a foreign-writer state, first plan_write carries the one-shot warn
	writeFileSync(join(cwd, ".pi", "plan-state.json"), foreignState());
	const r = await callTool(fp, "plan_write", {
		items: [
			{ title: "rename module", status: "in_progress" },
			{ title: "update callers", status: "pending" },
		], request: "half-done refactor", summary: "s",
	}, cwd);
	assert.ok(r.content[0].text.includes("PARTIAL WORK"), r.content[0].text);
	const again = await callTool(fp, "plan_write", {
		items: [
			{ title: "rename module", status: "done" },
			{ title: "update callers", status: "in_progress" },
		], request: "half-done refactor", summary: "s",
	}, cwd);
	assert.ok(!again.content[0].text.includes("PARTIAL WORK"), "one-shot: not repeated");
});

test("integration: a state written by THIS process triggers no resume machinery", async () => {
	const fp = makeFakePi();
	const mod = await import(`../extensions/plan-runner.ts?ownwriter=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as any);
	const cwd = tmp();
	const { ctx, notes } = makeCtx(cwd);
	await callTool(fp, "plan_write", {
		items: [{ title: "own work", status: "in_progress" }], request: "r", summary: "s",
	}, cwd);
	await fire(fp, "session_start", { reason: "startup" }, ctx);
	assert.equal(notes.length, 0, "no interrupted-plan notice for our own state");
	await fp.commands.get("plan-go").handler("", ctx);
	assert.ok(!fp.sent.at(-1)!.includes("PARTIAL WORK"), "no partial-work block for our own state");
});
