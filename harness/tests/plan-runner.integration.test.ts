// Integration tests for the plan-runner RUNTIME (the 913-line adapter the pure
// plan-integrity tests never touch): /plan flow + plan-mode block, plan_write
// persistence + gates against a REAL shell, escalation, integrity reattach,
// abort observability, plus the micro-gate extension end-to-end (whose exec
// field-name bug pure tests could not see).
import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, fire, makeCtx, makeFakePi, expectToolError, resetPiGlobals } from "./integration-harness.ts";
import { consumePlanGateReceipt } from "../lib/plan-gate-receipt.ts";

// module-load envs BEFORE importing the extensions
process.env.PLAN_GATE_MAX = "2";
process.env.MICRO_GATE = "on";
const planRunnerModule = await import("../extensions/plan-runner.ts");
const planRunner = planRunnerModule.default;
const policyBlock = planRunnerModule.policyBlock;
const microGate = (await import("../extensions/micro-gate.ts")).default;

const tmp = () => mkdtempSync(join(tmpdir(), "pi-int-"));

function freshPlanRunner() {
	const fp = makeFakePi();
	planRunner(fp.pi as any);
	return fp;
}

test("lean and YOLO differ in pacing, never in safety authority", () => {
	const lean = policyBlock("lean", false);
	const yolo = policyBlock("yolo", false);
	const safety = "ask before deletion, destructive git, deployment, migration, restart/kill, secrets or permissions, and irreversible external effects";
	assert.ok(lean.toLowerCase().includes(safety), lean);
	assert.ok(yolo.toLowerCase().includes(safety), yolo);
	assert.ok(yolo.includes("without routine progress check-ins"));
	assert.ok(!yolo.includes("Risky/destructive → act directly"));
});

test("runtime status distinguishes active override from configured default", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx, notes } = makeCtx(cwd);
	await fp.commands.get("runtime-status").handler("", ctx);
	assert.ok(notes.at(-1)?.includes("Active provider: test-provider"), notes.at(-1));
	assert.ok(notes.at(-1)?.includes("Active model: test-model"), notes.at(-1));
	assert.ok(notes.at(-1)?.includes("Configured default provider:"), notes.at(-1));
});

test("plan telemetry and traces carry the active model override plus run id", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("model override test", ctx);
		await callTool(fp, "plan_write", {
			items: [{ title: "one", status: "pending" }], request: "model override test", summary: "one",
		}, cwd);
		// A REAL rejection, not a hand-built event: the previous version fabricated a
		// tool_result that pi never emits (validation failures produce no tool_result
		// at all), so it proved the observer fires on an impossible input. Driving it
		// through the actual throwing path is what the observer really covers.
		await expectToolError(fp, "plan_write", {
			items: [{ title: "x", status: "pending", depends_on: ["nonexistent"] }],
			request: "model override test", summary: "one",
		}, cwd, /plan_write rejected/);
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const planRows = rows.filter((row) => row.ext === "plan-runner");
		assert.ok(planRows.length > 0);
		assert.ok(planRows.every((row) => row.run_id && row.provider === "test-provider" && row.model === "test-model"));
		assert.ok(planRows.some((row) => row.kind === "write-rejected" && row.reason_class === "schema_or_execution"));
		assert.doesNotMatch(JSON.stringify(planRows), /raw invalid args/);
		const traces = readFileSync(join(cwd, ".pi", "traces", "plan-runner.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.ok(traces.every((row) => row.model.provider === "test-provider" && row.model.id === "test-model"));
	} finally {
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

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
	// Rejections must THROW: pi 0.83 ignores a returned isError (docs
	// extensions.md:1959), so asserting the return value tested our own test
	// double rather than pi's contract — and hid the defect until 2026-07-30.
	await expectToolError(fp, "plan_write", {
		items: [{ title: "a", status: "pending", depends_on: ["ghost"] }], request: "r", summary: "s",
	}, cwd, /ghost/);
	assert.ok(!existsSync(join(cwd, ".pi", "plan-state.json")), "no state written on rejection");

	await expectToolError(fp, "plan_write", {
		items: [
			{ title: "a", status: "pending", depends_on: ["b"] },
			{ title: "b", status: "pending", depends_on: ["a"] },
		], request: "r", summary: "s",
	}, cwd, /cycle/);
	assert.ok(!existsSync(join(cwd, ".pi", "plan-state.json")), "still no state written");

	await expectToolError(fp, "plan_write", {
		items: [
			{ title: "Fix `Parser`", status: "pending" },
			{ title: " fix parser ", status: "pending" },
		], request: "r", summary: "s",
	}, cwd, /plan_write rejected/);

	await expectToolError(fp, "plan_write", {
		items: [
			{ title: "build", status: "pending" },
			{ title: "ship", status: "pending", depends_on: ["build", "BUILD"] },
		], request: "r", summary: "s",
	}, cwd, /plan_write rejected/);
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
	// A SECOND session in the same process (pi caches the extension factory) must
	// re-surface a still-foreign interrupted plan. The old assertion here pinned
	// "notice fires once per process" — which was the module-scope-lifetime bug
	// (triage #26): /new, /fork and same-cwd /resume sessions never saw the
	// notice at all. Per-session is the contract; the writer === PROC_MARK check
	// is what suppresses it once THIS process takes the plan over.
	await fire(fp, "session_start", { reason: "startup" }, ctx);
	assert.ok(notes.some((n) => n.includes("Interrupted plan")),
		"a new session re-surfaces a still-foreign interrupted plan");
	notes.length = 0;

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

test("integration: reloading the extension in the same process does not invent an interrupted plan", async () => {
	const cwd = tmp();
	const first = makeFakePi();
	const firstModule = await import(`../extensions/plan-runner.ts?reload-first=${Date.now()}-${Math.random()}`);
	firstModule.default(first.pi as any);
	await callTool(first, "plan_write", {
		items: [{ title: "reload-safe work", status: "in_progress" }], request: "r", summary: "s",
	}, cwd);

	const reloaded = makeFakePi();
	const secondModule = await import(`../extensions/plan-runner.ts?reload-second=${Date.now()}-${Math.random()}`);
	secondModule.default(reloaded.pi as any);
	const { ctx, notes } = makeCtx(cwd);
	await fire(reloaded, "session_start", { reason: "extension-reload" }, ctx);
	assert.equal(notes.length, 0, "same-process reload must retain the process writer identity");
	await reloaded.commands.get("plan-go").handler("", ctx);
	assert.ok(!reloaded.sent.at(-1)!.includes("PARTIAL WORK"), "same-process reload is not a crash resume");
});

test("c31: uncertainties hold execution — write steer, /plan-go block, clear-with-[] release, omission-safe", async () => {
	process.env.PLAN_UNCERTAINTY = "on";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?unc=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx, notes } = makeCtx(cwd);
		await fp.commands.get("plan").handler("ambiguous request", ctx);

		const r1 = await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }],
			request: "ambiguous request", summary: "s",
			uncertainties: ["Which database should this target?", "Is backwards compat required?"],
		}, cwd);
		assert.ok(r1.content[0].text.includes("unresolved uncertaint"), r1.content[0].text);
		assert.ok(r1.content[0].text.includes("Which database"), "questions are listed verbatim");
		let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.uncertainties.length, 2, "persisted");

		// /plan-go is deterministically held
		notes.length = 0;
		await fp.commands.get("plan-go").handler("", ctx);
		assert.ok(notes.some((n) => n.includes("Execution held")), `blocked: ${JSON.stringify(notes)}`);
		assert.ok(!fp.sent.some((s) => s.includes("MODE: RUN")), "no execute prompt while held");
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.phase, "planned", "phase must not flip while held");

		// omission preserves (small models drop optional fields on rewrite)
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "ambiguous request", summary: "s",
		}, cwd);
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.uncertainties.length, 2, "omitted field preserves prior uncertainties");

		// explicit [] clears and releases the gate
		const r3 = await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "ambiguous request", summary: "s",
			uncertainties: [],
		}, cwd);
		assert.ok(!r3.content[0].text.includes("unresolved uncertaint"), "steer gone once cleared");
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.uncertainties, undefined, "cleared");
		await fp.commands.get("plan-go").handler("", ctx);
		assert.ok(fp.sent.some((s) => s.includes("MODE: RUN")), "execution released after clearing");

		// agent_end backstop: re-add and end the run
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "in_progress" }], request: "ambiguous request", summary: "s",
			uncertainties: ["Still unresolved?"],
		}, cwd);
		notes.length = 0;
		await fire(fp, "agent_end", {}, ctx);
		assert.ok(notes.some((n) => n.includes("Still unresolved?")), `backstop notify: ${JSON.stringify(notes)}`);
	} finally {
		delete process.env.PLAN_UNCERTAINTY;
	}
});

// ADOPTED 2026-08-07: default-on (was dark candidate c31) — unset must advertise
// the field; PLAN_UNCERTAINTY=off is the kill switch and restores the legacy schema.
test("c31 default-on: unset advertises uncertainties; PLAN_UNCERTAINTY=off restores the legacy schema", async () => {
	const fp = freshPlanRunner(); // module-load env has no PLAN_UNCERTAINTY -> default-on
	assert.ok(JSON.stringify(fp.tools.get("plan_write").parameters).includes("uncertainties"),
		"unset = default-on: the schema field is advertised");

	process.env.PLAN_UNCERTAINTY = "off";
	try {
		const off = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c31off=${Date.now()}-${Math.random()}`);
		mod.default(off.pi as any);
		const cwd = tmp();
		assert.ok(!JSON.stringify(off.tools.get("plan_write").parameters).includes("uncertainties"),
			"PLAN_UNCERTAINTY=off kills it — byte-identical legacy schema");
		const r = await callTool(off, "plan_write", {
			items: [{ title: "a", status: "pending" }], request: "r", summary: "s",
		}, cwd);
		assert.ok(!r.content[0].text.includes("uncertaint"));
	} finally {
		delete process.env.PLAN_UNCERTAINTY;
	}
});

test("c34: flag on swaps the legacy 5-10 item bound for non-numeric guidance", async () => {
	process.env.PLAN_ITEM_GUIDANCE_V2 = "on";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?items=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("add a widget", ctx);
		assert.ok(!fp.sent[0].includes("5-10 ordered items"), "legacy numeric bound must be gone");
		assert.ok(fp.sent[0].includes("no padding, no fake splits"), fp.sent[0]);
	} finally {
		delete process.env.PLAN_ITEM_GUIDANCE_V2;
	}
});

// ADOPTED 2026-08-07: default-on (was dark candidate c34) — unset must use the
// need-sized wording; PLAN_ITEM_GUIDANCE_V2=off restores the legacy numeric bound.
test("c34 default-on: unset uses need-sized wording; =off restores the legacy 5-10 bound", async () => {
	const fp = freshPlanRunner(); // module-load env has no PLAN_ITEM_GUIDANCE_V2 -> default-on
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("add a widget", ctx);
	assert.ok(!fp.sent[0].includes("5-10 ordered items"), "unset = default-on: numeric bound gone");
	assert.ok(fp.sent[0].includes("sized to the real work"), fp.sent[0]);

	process.env.PLAN_ITEM_GUIDANCE_V2 = "off";
	try {
		const off = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c34off=${Date.now()}-${Math.random()}`);
		mod.default(off.pi as any);
		const { ctx: offCtx } = makeCtx(tmp());
		await off.commands.get("plan").handler("add a widget", offCtx);
		assert.ok(off.sent[0].includes("Break REQ into 5-10 ordered items."),
			"PLAN_ITEM_GUIDANCE_V2=off restores the legacy wording");
	} finally {
		delete process.env.PLAN_ITEM_GUIDANCE_V2;
	}
});

test("c36: SPAWN_DELEGATION=on swaps fork advice for spawn + self-contained everywhere", async () => {
	process.env.SPAWN_DELEGATION = "on";
	process.env.PLAN_SUBAGENT_ONLY = "1";
	process.env.PLAN_GATE_MAX = "4";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c36=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);

		// delegation block (both the c25 wording and the advisory wording route
		// through the same consts; assert via the exported policyBlock)
		const policy = mod.policyBlock("lean", true);
		assert.ok(policy.includes("subagent(executor, …, mode=spawn)"), policy);
		assert.ok(policy.includes("SELF-CONTAINED"), policy);
		assert.ok(!policy.includes("mode=fork"), policy);

		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("add a widget", ctx);
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "add a widget", summary: "one",
		}, cwd);
		await fp.commands.get("plan-go").handler("", ctx);
		fp.pi.getActiveTools = () => ["subagent"];

		// c25 block reason carries spawn wording under the flag
		const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit?.block, true);
		assert.ok(edit.reason.includes("mode=spawn"), edit.reason);
		assert.ok(edit.reason.includes("self-contained"), edit.reason);
		assert.ok(!edit.reason.includes("mode=fork"), edit.reason);

		// gate ladder rung 2 delegates with spawn wording
		writeFileSync(join(cwd, "bad.sh"), "if [ ; then fi\n"); // bash -n fails
		const failOnce = () => callTool(fp, "plan_write", {
			items: [{ title: "bad work", status: "done", gate: "bash -n bad.sh" }], request: "r", summary: "s",
		}, cwd);
		await failOnce(); // rung 1 (LOCALIZE)
		const r2 = await failOnce();
		assert.ok(r2.content[0].text.includes("mode=spawn"), r2.content[0].text);
		assert.ok(r2.content[0].text.includes("SELF-CONTAINED"), r2.content[0].text);
		assert.ok(!r2.content[0].text.includes("mode=fork"), r2.content[0].text);
	} finally {
		delete process.env.SPAWN_DELEGATION;
		delete process.env.PLAN_SUBAGENT_ONLY;
		process.env.PLAN_GATE_MAX = "2";
	}
});

// ADOPTED 2026-08-07: default-on (was dark candidate c36) — unset must recommend
// spawn; SPAWN_DELEGATION=off restores the byte-identical fork wording.
test("c36 default-on: unset recommends spawn; =off restores the fork wording byte-identical", async () => {
	// module-level import was loaded without SPAWN_DELEGATION -> default-on
	const policy = policyBlock("lean", true);
	assert.ok(policy.includes("subagent(executor, …, mode=spawn)"), policy);
	assert.ok(policy.includes("SELF-CONTAINED"), policy);

	process.env.SPAWN_DELEGATION = "off";
	try {
		const mod = await import(`../extensions/plan-runner.ts?c36off=${Date.now()}-${Math.random()}`);
		const offPolicy = mod.policyBlock("lean", true);
		assert.ok(offPolicy.includes("subagent(executor, …, mode=fork). You own the plan; trivial edits yourself."), offPolicy);
		assert.ok(!offPolicy.includes("SELF-CONTAINED"), offPolicy);
	} finally {
		delete process.env.SPAWN_DELEGATION;
	}
});

test("c38: FORCE_PLAN_WRITE blocks the first mutation before any plan_write call, allows reads", async () => {
	process.env.FORCE_PLAN_WRITE = "on";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c38=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		fp.pi.getActiveTools = () => ["plan_write"];
		// no /plan, no plan_write call yet — a model reaching straight for an edit

		const read = await fire(fp, "tool_call", { toolName: "read", input: { path: "x" } }, ctx);
		assert.equal(read, undefined, "reads are never gated by this candidate");

		const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit?.block, true);
		assert.ok(edit.reason.includes("call plan_write"), edit.reason);
		assert.ok(edit.reason.includes("plan_go"), "the block message must name the activation step (the gemma-collapse root cause was omitting it)");

		const bashMut = await fire(fp, "tool_call", { toolName: "bash", input: { command: "sed -i s/a/b/ file" } }, ctx);
		assert.equal(bashMut?.block, true, "mutating bash blocked same as edit");

		const bashRead = await fire(fp, "tool_call", { toolName: "bash", input: { command: "cat file" } }, ctx);
		assert.equal(bashRead, undefined, "read-only bash not gated");
	} finally {
		delete process.env.FORCE_PLAN_WRITE;
	}
});

test("c38: once plan_write has been called even once, later mutations are unaffected", async () => {
	process.env.FORCE_PLAN_WRITE = "on";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c38after=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		await callTool(fp, "plan_write", {
			items: [{ title: "s", status: "pending" }], request: "r", summary: "s",
		}, cwd);
		const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit, undefined, "plan_write already happened — no block, this candidate never re-arms");
	} finally {
		delete process.env.FORCE_PLAN_WRITE;
	}
});

test("c38: fails open when plan_write is not an active tool — no deadlock", async () => {
	process.env.FORCE_PLAN_WRITE = "on";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c38noplantool=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		// fake harness getActiveTools() defaults to [] — plan_write absent, exactly
		// the deadlock scenario a --tools list without plan_write produced live
		const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit, undefined, "mutation NOT blocked when the demanded tool cannot be called");
	} finally {
		delete process.env.FORCE_PLAN_WRITE;
	}
});

// ADOPTED 2026-08-07: default-on (was dark candidate c38) — the kill-switch case
// pins plan_write as ACTIVE so it cannot pass vacuously through the fail-open path.
test("c38 kill switch: FORCE_PLAN_WRITE=off — the very first mutation proceeds with no plan_write required", async () => {
	process.env.FORCE_PLAN_WRITE = "off";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c38off=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);
		fp.pi.getActiveTools = () => ["plan_write"]; // fail-open path unavailable — off must be the reason
		const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit, undefined, "FORCE_PLAN_WRITE=off kills the gate");
	} finally {
		delete process.env.FORCE_PLAN_WRITE;
	}
});

test("c38 default-on: unset blocks the first unplanned mutation; gemma-family models are skipped with a receipt", async () => {
	// no FORCE_PLAN_WRITE in env -> default-on
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c38gemma=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		fp.pi.getActiveTools = () => ["plan_write"];

		// Non-gemma model: blocked (default-on is live).
		const { ctx } = makeCtx(cwd);
		const blocked = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(blocked?.block, true, "unset = default-on: unplanned mutation blocked");

		// Gemma-family model: the standing verdict is honored in code — no block,
		// and the skip leaves a telemetry receipt.
		const gemmaCtx = {
			cwd: tmp(),
			model: { provider: "local-llamacpp", id: "gemma-4-e2b" },
			ui: { notify: () => {}, confirm: async () => true },
		};
		const skipped = await fire(fp, "tool_call", { toolName: "edit", input: {} }, gemmaCtx);
		assert.equal(skipped, undefined, "gemma family is never gated (measured 0/9 collapse)");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const skip = rows.find((row) => row.ext === "plan-runner" && row.kind === "force-plan-write-skip");
		assert.ok(skip, "force-plan-write-skip recorded");
		assert.equal(skip.model_class, "gemma");
	} finally {
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

test("c38: telemetry — force-plan-write-block recorded on the gated first mutation", async () => {
	process.env.FORCE_PLAN_WRITE = "on";
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c38tel=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const { ctx } = makeCtx(cwd);
		fp.pi.getActiveTools = () => ["plan_write"];
		await fire(fp, "tool_call", { toolName: "write", input: {} }, ctx);
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const block = rows.find((row) => row.ext === "plan-runner" && row.kind === "force-plan-write-block");
		assert.ok(block, "force-plan-write-block recorded");
		assert.equal(block.toolName, "write");
	} finally {
		delete process.env.FORCE_PLAN_WRITE;
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

// ADOPTED 2026-08-07: default-on (was dark candidate c39) — unset must register
// the tool; PLAN_TOOL_GO=off is the kill switch.
test("c39 default-on: unset registers plan_go; PLAN_TOOL_GO=off removes it", async () => {
	const fp = freshPlanRunner(); // module-load env has no PLAN_TOOL_GO -> default-on
	assert.ok(fp.tools.get("plan_go"), "unset = default-on: plan_go is registered");
	const planWrite = fp.tools.get("plan_write");
	assert.ok(!JSON.stringify({ description: planWrite.description, promptSnippet: planWrite.promptSnippet }).includes("plan_go"),
		"plan_write's own schema/description stays untouched either way");

	process.env.PLAN_TOOL_GO = "off";
	try {
		const off = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39off=${Date.now()}-${Math.random()}`);
		mod.default(off.pi as any);
		assert.equal(off.tools.get("plan_go"), undefined, "PLAN_TOOL_GO=off kills the tool");
	} finally {
		delete process.env.PLAN_TOOL_GO;
	}
});

test("c39: plan_go blocked — no plan exists", async () => {
	process.env.PLAN_TOOL_GO = "on";
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39noplan=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		// plan_go rejections THROW (pi ignores a returned isError — docs 1959).
		await expectToolError(fp, "plan_go", {}, cwd, /plan_write/);
		assert.equal(existsSync(join(cwd, ".pi", "plan-state.json")), false, "no state file must be created");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const blocked = rows.find((row) => row.ext === "plan-runner" && row.kind === "go-blocked");
		assert.ok(blocked, "go-blocked telemetry recorded");
		assert.equal(blocked.reason, "no-plan");
	} finally {
		delete process.env.PLAN_TOOL_GO;
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

test("c39: plan_go blocked — plan exists but has no open items", async () => {
	process.env.PLAN_TOOL_GO = "on";
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39noopen=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		await callTool(fp, "plan_write", {
			items: [{ title: "already done", status: "done" }], request: "r", summary: "s",
		}, cwd);
		await expectToolError(fp, "plan_go", {}, cwd, /complete/);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.phase, "planned", "phase must not flip with no open items");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const blocked = rows.find((row) => row.ext === "plan-runner" && row.kind === "go-blocked");
		assert.ok(blocked, "go-blocked telemetry recorded");
		assert.equal(blocked.reason, "no-open-items");
	} finally {
		delete process.env.PLAN_TOOL_GO;
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

test("c39: plan_go blocked under a PLAN_UNCERTAINTY hold, does not flip phase", async () => {
	process.env.PLAN_TOOL_GO = "on";
	process.env.PLAN_UNCERTAINTY = "on";
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39hold=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "r", summary: "s",
			uncertainties: ["Which environment: staging or prod?"],
		}, cwd);
		await expectToolError(fp, "plan_go", {}, cwd, /Which environment: staging or prod\?/);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.phase, "planned", "phase must not flip while uncertainties remain");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const hold = rows.find((row) => row.ext === "plan-runner" && row.kind === "uncertainty-hold" && row.gate === "plan-go-tool");
		assert.ok(hold, "uncertainty-hold telemetry recorded with gate=plan-go-tool");
	} finally {
		delete process.env.PLAN_TOOL_GO;
		delete process.env.PLAN_UNCERTAINTY;
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

// REVISED 2026-08-11: this test used to assert that the plan_go TOOL disarms the
// lean plan-mode block. That is the human checkpoint `/plan` exists to create, and
// letting the model clear it is self-approval (Albert's inspection). The activation
// path c39 was built for is unaffected: real_gate.sh dispatches no slash commands,
// so isPlanning() is false in every gate session — see the c25 test below, which is
// the tool-only case. What this test now pins is that the USER's /plan-go performs
// exactly the transition the tool used to perform.
test("c39: the user's /plan-go transitions phase to executing and disarms isPlanning()", async () => {
	process.env.PLAN_TOOL_GO = "on";
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39go=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("add a widget", ctx); // lean -> arms isPlanning()
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "add a widget", summary: "one",
		}, cwd);

		// still planning: the ordinary plan-mode block fires before plan_go ever runs
		const duringPlan = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(duringPlan?.block, true, "plan-mode block still fires before plan_go");

		// The model may NOT clear the user's review checkpoint itself.
		await expectToolError(fp, "plan_go", {}, cwd, /awaiting the user's review/);
		const stillPlanned = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(stillPlanned.phase, "planned", "the tool must not flip phase during review");

		await fp.commands.get("plan-go").handler("", ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.phase, "executing");
		assert.ok(fp.entries.some((e) => e.type === "plan_spine"), "plan_spine entry recorded");
		const trace = readFileSync(join(cwd, ".pi", "traces", "plan-runner.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
		assert.ok(trace.some((row) => row.tool_name === "plan" || row.tool_name === "plan-go"), "go trace row recorded");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.ok(rows.some((row) => row.ext === "plan-runner" && row.kind === "go" && row.resumed === false), "plan-runner/go telemetry recorded");

		// isPlanning() must actually be disarmed -- not just phase reading correctly on disk
		const afterGo = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(afterGo, undefined, "structural plan-mode block must be genuinely disarmed after the user's /plan-go");

		// ...and only now may the model use the tool (resume is idempotent).
		const resumed = await callTool(fp, "plan_go", {}, cwd);
		assert.equal(resumed.isError, false, resumed.content?.[0]?.text);
	} finally {
		// This flag is process-global: leaving it armed leaks the plan-mode block
		// into every later test in this file (it did, before the guard existed).
		delete (globalThis as Record<string, unknown>).__pi_plan_phase_active;
		delete process.env.PLAN_TOOL_GO;
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});

test("c39 + c25: plan_go unlocks PLAN_SUBAGENT_ONLY's block on a direct edit — pure tool-only session, no slash commands", async () => {
	process.env.PLAN_TOOL_GO = "on";
	process.env.PLAN_SUBAGENT_ONLY = "1";
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39c25=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const cwd = tmp();
		const { ctx } = makeCtx(cwd);

		// deliberately never calling /plan or /plan-go -- mirrors a real real_gate.sh
		// `pi -p` session, which never dispatches a slash command at all. This is
		// also the case that proves the 2026-08-11 review guard cannot touch a gate
		// round: with no /plan, isPlanning() is false and plan_go activates freely.
		delete (globalThis as Record<string, unknown>).__pi_plan_phase_active;
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "r", summary: "s",
		}, cwd);
		const go = await callTool(fp, "plan_go", {}, cwd);
		// pi sets isError:false on every successful tool result — `undefined` was
		// only ever true of the old double echoing the raw return value.
		assert.equal(go.isError, false, go.content?.[0]?.text);

		const edit = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit?.block, true, "PLAN_SUBAGENT_ONLY must now block a direct edit -- purely via tool calls, no slash command ever dispatched");
		assert.ok(edit.reason.includes("PLAN_SUBAGENT_ONLY"), edit.reason);
	} finally {
		delete process.env.PLAN_TOOL_GO;
		delete process.env.PLAN_SUBAGENT_ONLY;
	}
});

test("persistence is ATOMIC: no reader can observe a torn plan-state.json", async () => {
	// A torn state file loses the session's spine. rename(2) makes the swap atomic,
	// so a reader sees either the old file or the new one — never a prefix.
	const fp = freshPlanRunner();
	const cwd = tmp();
	await callTool(fp, "plan_write", {
		items: [{ title: "first", status: "pending" }], request: "r", summary: "s",
	}, cwd);

	const statePath = join(cwd, ".pi", "plan-state.json");
	let torn = 0;
	let reads = 0;
	// Poll the file while a large rewrite lands; every observed byte-image must parse.
	const poller = setInterval(() => {
		try {
			const raw = readFileSync(statePath, "utf8");
			reads += 1;
			JSON.parse(raw);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") torn += 1;
		}
	}, 1);
	// Big enough that a plain writeFile cannot land in one syscall (~2 MB).
	const bulky = Array.from({ length: 200 }, (_, i) => ({
		title: `item ${i} ${"padding ".repeat(1200)}`, status: "pending" as const,
	}));
	for (let round = 0; round < 4; round++) {
		await callTool(fp, "plan_write", { items: bulky, request: "r", summary: `round ${round}` }, cwd);
	}
	clearInterval(poller);
	assert.ok(reads > 0, "the poller must actually have sampled the file");
	assert.equal(torn, 0, "every observed state file parsed — no torn writes");

	// And no temp files are left behind.
	const strays = readdirSync(join(cwd, ".pi")).filter((f) => f.includes(".tmp-"));
	assert.deepEqual(strays, [], "atomic writes must not leak temp files");
});

test("a FAILED rename cleans up its temp file instead of orphaning it in .pi/", async () => {
	// The success-path test above cannot see this: it only ever renames
	// successfully. Nothing sweeps .pi/, so a leak here is permanent and
	// accumulates one file per failure. Forced by making the destination a
	// DIRECTORY, which rename(2) refuses.
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("do the thing", ctx);
	rmSync(join(cwd, ".pi", "plan-state.json"), { force: true });
	mkdirSync(join(cwd, ".pi", "plan-state.json"));

	await expectToolError(fp, "plan_write", {
		items: [{ title: "step one", status: "pending" }], request: "r", summary: "s",
	}, cwd, /./);

	const strays = readdirSync(join(cwd, ".pi")).filter((f) => f.includes(".tmp-"));
	assert.deepEqual(strays, [], "a failed rename must unlink its temp file");
});

test("/plan-go prompts from the POST-queue state, not the snapshot it read first", async () => {
	// pi runs extension commands above the isStreaming guard (SESSION:792-828,
	// "execute immediately, even during streaming"), so /plan-go can be typed
	// while a plan_write is in flight. goCommand read state ONCE up front, wrote
	// through mutatePlan's queue (which re-reads), then built the RUN prompt and
	// the plan_spine run_id from the stale snapshot — so the model was told to
	// execute an item list that no longer matched the disk.
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("do the thing", ctx);
	await callTool(fp, "plan_write", {
		items: [{ title: "alpha", status: "pending" }], request: "do the thing", summary: "one",
	}, cwd);

	// Interleave: a second plan_write is queued but NOT awaited, so /plan-go
	// blocks on the same file queue and its `prev` is strictly newer.
	const inflight = callTool(fp, "plan_write", {
		items: [{ title: "alpha", status: "pending" }, { title: "beta", status: "pending" }],
		request: "do the thing", summary: "two",
	}, cwd);
	// The intended interleaving is "the write is IN the queue before /plan-go
	// enters". Whether that happens used to hinge on how many awaits each path
	// performed before withFileMutationQueue — the unified goCommand does fewer
	// than the old one, which exposed this as a scheduling race (observed flake:
	// /plan-go occasionally won the queue and prompted the pre-write state, a
	// legitimate ordering in production but not the one this test exists to pin).
	// A few macrotask turns let plan_write's pre-queue awaits complete without
	// awaiting its completion.
	for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
	await fp.commands.get("plan-go").handler("", ctx);
	await inflight;

	const prompt = fp.sent.at(-1)!;
	assert.ok(prompt.includes("beta"), `RUN prompt must enumerate the item added while it waited:\n${prompt}`);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	assert.equal(state.phase, "executing");
	assert.equal(state.items.length, 2, "and neither write was lost");
});

test("a bailed /plan-go (no plan written yet) must NOT disarm the plan-mode mutation block", async () => {
	// goCommand used to run setPlanning(false)/replanStreak=0 BEFORE its guards,
	// so the exact live sequence "user types /plan, then /plan-go before the model
	// ever calls plan_write" silently disarmed the mutation block the /plan had
	// just armed. goTransition now disarms only on the ok arm.
	const fp = freshPlanRunner();
	const cwd = tmp();
	const { ctx, notes } = makeCtx(cwd);
	try {
		await fp.commands.get("plan").handler("add a widget", ctx); // arms isPlanning(); state has items: []
		await fp.commands.get("plan-go").handler("", ctx);
		assert.ok(notes.some((n) => n.includes("No plan to run")), "bail was notified");
		assert.ok(!fp.sent.some((s) => s.includes("MODE: RUN")), "no execute prompt on a bail");
		const edit: any = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit?.block, true, "plan-mode block must survive a bailed /plan-go");
		assert.ok(edit.reason.includes("plan_mode_violation"), edit.reason);
	} finally {
		resetPiGlobals(); // this test deliberately leaves planning armed — don't leak it
	}
});

test("a HELD /plan-go (c31 uncertainty) must NOT disarm the plan-mode mutation block either", async () => {
	// Same defect class, second arm: the pre-guard disarm also fired when the
	// uncertainty hold then refused execution. New import so PLAN_UNCERTAINTY is
	// read fresh at module load.
	const prev = process.env.PLAN_UNCERTAINTY;
	process.env.PLAN_UNCERTAINTY = "on";
	const cwd = tmp();
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?heldgo=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const { ctx, notes } = makeCtx(cwd);
		await fp.commands.get("plan").handler("deploy the service", ctx);
		await callTool(fp, "plan_write", {
			items: [{ title: "deploy", status: "pending" }],
			request: "deploy the service", summary: "one step",
			uncertainties: ["Which environment: staging or prod?"],
		}, cwd);
		await fp.commands.get("plan-go").handler("", ctx);
		assert.ok(notes.some((n) => n.includes("Execution held")), "hold was notified");
		const edit: any = await fire(fp, "tool_call", { toolName: "edit", input: {} }, ctx);
		assert.equal(edit?.block, true, "plan-mode block must survive a held /plan-go");
	} finally {
		if (prev === undefined) delete process.env.PLAN_UNCERTAINTY; else process.env.PLAN_UNCERTAINTY = prev;
		resetPiGlobals();
	}
});

test("/plan-go emits go/go-blocked telemetry with activation:command (parity with the tool)", async () => {
	// The slash path used to emit NOTHING on success or hard bails — only the
	// tool did — so command-driven activations were invisible to exposure counts.
	const fp = freshPlanRunner();
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan-go").handler("", ctx); // no plan at all
		await fp.commands.get("plan").handler("do the thing", ctx);
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "do the thing", summary: "one",
		}, cwd);
		await fp.commands.get("plan-go").handler("", ctx);

		// Telemetry rows are FLAT: detail fields sit beside kind/ext (see the
		// model-override test above), not under a `detail` key.
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((l) => JSON.parse(l));
		const blocked = rows.find((r) => r.ext === "plan-runner" && r.kind === "go-blocked");
		assert.ok(blocked, "bail must be visible in telemetry");
		assert.equal(blocked.reason, "no-plan");
		assert.equal(blocked.activation, "command");
		const go = rows.find((r) => r.ext === "plan-runner" && r.kind === "go");
		assert.ok(go, "successful activation must be visible in telemetry");
		assert.equal(go.resumed, false);
		assert.equal(go.activation, "command");
	} finally {
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
		resetPiGlobals();
	}
});

test("/plan and /plan-go prompts survive a STREAMING session (steer, not lost)", async () => {
	// pi executes extension commands even mid-stream, but sendUserMessage with no
	// deliverAs THROWS while streaming and the throw is swallowed into emitError —
	// so /plan-go typed mid-stream committed phase=executing and then silently
	// lost the execute prompt (triage #0). deliverAs:"steer" queues it instead;
	// while idle, prompt() ignores the option entirely.
	const fp = makeFakePi({ streaming: true });
	planRunner(fp.pi as any);
	const cwd = tmp();
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler("do the thing", ctx);
	await callTool(fp, "plan_write", {
		items: [{ title: "step one", status: "pending" }], request: "do the thing", summary: "one",
	}, cwd);
	await fp.commands.get("plan-go").handler("", ctx);

	assert.equal(fp.deliveries.filter((d) => d.effective === "lost").length, 0,
		"no prompt may be swallowed while streaming");
	const planDelivery = fp.deliveries.find((d) => d.text.includes("MODE: PLAN") || d.text.includes("plan"));
	assert.ok(planDelivery, "the /plan prompt was delivered");
	const goDelivery = fp.deliveries.find((d) => d.text.includes("MODE: RUN"));
	assert.ok(goDelivery, "the execute prompt was delivered");
	assert.equal(goDelivery.effective, "queued-steer", "mid-stream delivery queues as steer");
	resetPiGlobals();
});

test("session_start clears __pi_active_plan_context (no run_id bleed across /new, /fork, /resume)", async () => {
	// writeStateAndTodo publishes this key and NOTHING deleted it. pi's loader returns
	// the CACHED factory across session replacement, so a later session in the same
	// process inherited the dead plan's run_id — and telemetry.ts lets detail.run_id
	// WIN the envelope join key, so the new session's receipts filed under the old
	// plan. Both readers (context-surface.ts:29, blackboard.ts:131) stamp it verbatim.
	// (No gate impact: real_gate.sh runs one `pi -p` session per process.)
	const g = globalThis as Record<string, unknown>;
	const fp = freshPlanRunner();
	const cwd = tmp();
	try {
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("first plan", ctx);
		await callTool(fp, "plan_write", {
			items: [{ title: "one", status: "pending" }], request: "first plan", summary: "one",
		}, cwd);
		const first = g.__pi_active_plan_context as { run_id?: string } | undefined;
		assert.ok(first?.run_id, "the plan must actually publish a context, or this test proves nothing");

		// A second session through the same cached factory, in a DIFFERENT cwd so no
		// state file is found — the path that used to leave the stale key in place.
		await fire(fp, "session_start", {}, makeCtx(tmp()).ctx);
		assert.equal(g.__pi_active_plan_context, undefined,
			`session_start must clear the plan context, still holding run_id ${first?.run_id}`);

		// ...but a same-cwd /resume of a LIVE plan must RE-BIND, not stay blank. Clearing
		// alone was a half-fix: it discarded a run_id that was correct, so receipts went
		// unattributed until the next writeStateAndTodo.
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		const resumed = g.__pi_active_plan_context as { run_id?: string } | undefined;
		assert.equal(resumed?.run_id, first.run_id,
			"a same-cwd resume must re-bind to the plan on disk, not blank the run_id");

		// And a cwd whose plan is gone must not resurrect it from the previous session.
		await fire(fp, "session_start", {}, makeCtx(tmp()).ctx);
		assert.equal(g.__pi_active_plan_context, undefined, "a planless cwd must leave the key cleared");
	} finally {
		delete g.__pi_active_plan_context;
		resetPiGlobals();
	}
});

test("plan gate receipt is aggregate and independent of green/red item order", async () => {
	const fp = freshPlanRunner();
	const cwd = tmp();
	writeFileSync(join(cwd, "good.sh"), "echo ok\n");
	try {
		await callTool(fp, "plan_write", {
			items: [
				{ title: "good work", status: "done", gate: "bash -n good.sh" },
				{ title: "sneaky", status: "done", gate: "npm install leftpad" },
			], request: "r", summary: "s",
		}, cwd);
		const first = consumePlanGateReceipt();
		assert.equal(first?.allPassed, false, "one rejected gate makes green/rejected aggregate red");

		const cwd2 = tmp();
		writeFileSync(join(cwd2, "good.sh"), "echo ok\n");
		await callTool(fp, "plan_write", {
			items: [
				{ title: "sneaky", status: "done", gate: "npm install leftpad" },
				{ title: "good work", status: "done", gate: "bash -n good.sh" },
			], request: "r", summary: "s",
		}, cwd2);
		const second = consumePlanGateReceipt();
		assert.equal(second?.allPassed, false, "rejected/green must be red too");
	} finally {
		resetPiGlobals();
	}
});

test("duplicate normalized plan gates execute once and fan out", async () => {
	const fp = makeFakePi();
	let executions = 0;
	const realExec = fp.pi.exec;
	fp.pi.exec = async (...args: Parameters<typeof realExec>) => {
		executions += 1;
		return realExec(...args);
	};
	planRunner(fp.pi as any);
	const cwd = tmp();
	writeFileSync(join(cwd, "good.sh"), "echo ok\n");
	try {
		await callTool(fp, "plan_write", {
			items: [
				{ title: "one", status: "done", gate: "bash -n good.sh" },
				{ title: "two", status: "done", gate: "  bash   -n   good.sh  " },
			], request: "r", summary: "s",
		}, cwd);
		assert.equal(executions, 1, "equivalent gates execute once");
		const receipt = consumePlanGateReceipt();
		assert.equal(receipt?.outcomes.length, 1, "receipt also deduplicates normalized commands");
		assert.equal(receipt?.allPassed, true);
	} finally {
		resetPiGlobals();
	}
});

test("partialWorkNoted is per-SESSION: session_start re-arms the partial-work warning", async () => {
	// Same lifetime bug as the removed resumeNotified: a module-scoped boolean under
	// pi's cached factory means "once per PROCESS", so session 2 after a /new or
	// /fork was never told half-finished work may sit on disk.
	const fp = freshPlanRunner();
	const foreignResume = (cwd: string) => {
		const sp = join(cwd, ".pi", "plan-state.json");
		const state = JSON.parse(readFileSync(sp, "utf8"));
		state.writer = "some-other-process";
		state.items[0].status = "in_progress";
		writeFileSync(sp, JSON.stringify(state, null, 2));
	};
	const cwd1 = tmp();
	try {
		await callTool(fp, "plan_write", { items: [{ title: "one", status: "pending" }], request: "r", summary: "s" }, cwd1);
		foreignResume(cwd1);
		const r1 = await callTool(fp, "plan_write", { items: [{ title: "one", status: "in_progress" }], request: "r", summary: "s" }, cwd1);
		assert.ok(r1.content[0].text.includes("PARTIAL WORK"), `first foreign resume must warn: ${r1.content[0].text}`);

		// New session, new cwd, another foreign resume — the warning must re-arm.
		const cwd2 = tmp();
		await fire(fp, "session_start", {}, makeCtx(cwd2).ctx);
		await callTool(fp, "plan_write", { items: [{ title: "two", status: "pending" }], request: "r", summary: "s" }, cwd2);
		foreignResume(cwd2);
		const r2 = await callTool(fp, "plan_write", { items: [{ title: "two", status: "in_progress" }], request: "r", summary: "s" }, cwd2);
		assert.ok(r2.content[0].text.includes("PARTIAL WORK"),
			"session 2 must be warned too — the note is per-session, not once per process");
	} finally {
		resetPiGlobals();
	}
});

test("c39: plan_go cannot self-approve a plan that is awaiting the user's review", async () => {
	process.env.PLAN_TOOL_GO = "on";
	const cwd = tmp();
	const telemetry = join(cwd, "telemetry.jsonl");
	const priorFile = process.env.TELEMETRY_FILE;
	const priorSource = process.env.TELEMETRY_SOURCE;
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	const g = globalThis as Record<string, unknown>;
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?c39review=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as any);
		const { ctx } = makeCtx(cwd);
		// /plan (lean) arms the human checkpoint: the user reviews, then runs /plan-go.
		await fp.commands.get("plan").handler("build the thing", ctx);
		assert.equal(g.__pi_plan_phase_active, true, "lean /plan arms the plan-mode block");
		await callTool(fp, "plan_write", {
			items: [{ title: "step one", status: "pending" }], request: "build the thing", summary: "s",
		}, cwd);

		// The model tries to start execution itself, in the same turn.
		await expectToolError(fp, "plan_go", {}, cwd, /awaiting the user's review|\/plan-go/);
		assert.equal(g.__pi_plan_phase_active, true, "the checkpoint stays armed — mutations remain blocked");
		const held = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(held.phase, "planned", "phase must not flip without the user");
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const blocked = rows.filter((row) => row.ext === "plan-runner" && row.kind === "go-blocked");
		assert.ok(blocked.some((row) => row.reason === "awaiting-user-review" && row.activation === "tool"),
			"the refusal is recorded as a distinct reason");

		// The USER's /plan-go still works, and the tool works once the flag is down.
		await fp.commands.get("plan-go").handler("", ctx);
		assert.equal(g.__pi_plan_phase_active, false, "the user's approval disarms the checkpoint");
		const started = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(started.phase, "executing");
		const resumed = await callTool(fp, "plan_go", {}, cwd);
		assert.match(resumed.content[0].text, /execution started|resume/,
			"outside review mode the tool behaves exactly as before");
	} finally {
		delete g.__pi_plan_phase_active;
		delete process.env.PLAN_TOOL_GO;
		if (priorFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = priorFile;
		if (priorSource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = priorSource;
	}
});
