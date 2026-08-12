import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { callTool, makeCtx, makeFakePi, resetPiGlobals } from "./integration-harness.ts";
import { runCapsuleDirectory } from "../lib/run-capsule-store.ts";

test("adaptive mode stores new plans privately, exposes ID deltas, and exports explicitly", async () => {
	const previous = {
		mode: process.env.PLAN_MODE,
		agent: process.env.PI_CODING_AGENT_DIR,
		capsule: process.env.RUN_CAPSULE,
		telemetry: process.env.TELEMETRY,
	};
	const cwd = mkdtempSync(join(tmpdir(), "pi-adaptive-"));
	const agent = mkdtempSync(join(tmpdir(), "pi-adaptive-agent-"));
	const capsuleId = "11111111-1111-4111-8111-111111111111";
	process.env.PLAN_MODE = "adaptive";
	process.env.PI_CODING_AGENT_DIR = agent;
	process.env.RUN_CAPSULE = "shadow";
	process.env.TELEMETRY = "off";
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId };
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?adaptive=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("plan").handler("one bounded fix", ctx);
		assert.ok(fp.commands.has("plan-direct"));
		assert.ok(fp.tools.has("plan_update"));
		await callTool(fp, "plan_write", { items: [{ title: "one", status: "pending" }], request: "one bounded fix", summary: "one" }, cwd);
		const privateDir = runCapsuleDirectory(agent, cwd, capsuleId);
		const privateState = join(privateDir, "plan-state.json");
		assert.equal(existsSync(privateState), true);
		assert.equal(existsSync(join(cwd, ".pi", "plan-state.json")), false);
		assert.equal(existsSync(join(cwd, ".pi", "TODO.md")), false);
		const itemId = JSON.parse(readFileSync(privateState, "utf8")).items[0].id;
		const delta = await callTool(fp, "plan_update", { deltas: [{ item_id: itemId, status: "done", note: "verified" }] }, cwd);
		assert.match(delta.content[0].text, /1 changed/);
		assert.equal(JSON.parse(readFileSync(privateState, "utf8")).items[0].status, "done");
		await fp.commands.get("plan-export").handler("", ctx);
		assert.match(readFileSync(join(cwd, ".pi", "TODO.md"), "utf8"), /one/);
		await fp.commands.get("plan-direct").handler("rm the old file", ctx);
		assert.equal(fp.sent.length, 1, "risky direct request is refused");
		await fp.commands.get("plan-direct").handler("fix one typo", ctx);
		assert.equal(fp.sent.length, 2, "explicit bounded direct request is delivered once");
	} finally {
		resetPiGlobals();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agent, { recursive: true, force: true });
		if (previous.mode === undefined) delete process.env.PLAN_MODE; else process.env.PLAN_MODE = previous.mode;
		if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agent;
		if (previous.capsule === undefined) delete process.env.RUN_CAPSULE; else process.env.RUN_CAPSULE = previous.capsule;
		if (previous.telemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previous.telemetry;
	}
});

test("adaptive rebind: a private interrupted plan is found when capsule identity arrives AFTER session_start", async () => {
	const { mkdirSync, writeFileSync } = await import("node:fs");
	const { emitHarnessSignal } = await import("../lib/harness-signals.ts");
	const previous = {
		mode: process.env.PLAN_MODE,
		agent: process.env.PI_CODING_AGENT_DIR,
		capsule: process.env.RUN_CAPSULE,
		telemetry: process.env.TELEMETRY,
	};
	const cwd = mkdtempSync(join(tmpdir(), "pi-adaptive-order-"));
	const agent = mkdtempSync(join(tmpdir(), "pi-adaptive-order-agent-"));
	const capsuleId = "22222222-2222-4222-8222-222222222222";
	process.env.PLAN_MODE = "adaptive";
	process.env.PI_CODING_AGENT_DIR = agent;
	process.env.RUN_CAPSULE = "shadow";
	process.env.TELEMETRY = "off";
	try {
		// An interrupted PRIVATE plan from a previous process, unknown to this one.
		const privateDir = runCapsuleDirectory(agent, cwd, capsuleId);
		mkdirSync(privateDir, { recursive: true });
		writeFileSync(join(privateDir, "plan-state.json"), JSON.stringify({
			schema_version: 3, run_id: "r-private", request: "resume me", phase: "executing",
			writer: "some-other-process", items: [{ id: "i1", title: "one", status: "pending" }],
		}));

		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?adaptiveorder=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		const { ctx } = makeCtx(cwd);
		const g = globalThis as Record<string, unknown>;
		// session_start fires BEFORE run-capsule publishes the identity (real load order).
		await fp.handlers.get("session_start")![0]({ reason: "resume" }, ctx);
		const before = g.__pi_active_plan_context as { run_id?: string } | undefined;
		assert.notEqual(before?.run_id, "r-private", "identity absent: the private plan cannot be visible yet");

		// run-capsule now publishes identity and announces it.
		g.__pi_run_capsule_identity = { cwd, capsuleId };
		emitHarnessSignal(fp.pi.events as never, { v: 1, type: "capsule/identity" });
		// No timed sleep: the CONTRACT is that the next agent boundary awaits the
		// pending rebind. Firing before_agent_start must be sufficient.
		await fp.handlers.get("before_agent_start")![0]({}, ctx);
		const after = g.__pi_active_plan_context as { run_id?: string } | undefined;
		assert.equal(after?.run_id, "r-private", "identity announced: the private interrupted plan is rebound");
	} finally {
		resetPiGlobals();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agent, { recursive: true, force: true });
		if (previous.mode === undefined) delete process.env.PLAN_MODE; else process.env.PLAN_MODE = previous.mode;
		if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agent;
		if (previous.capsule === undefined) delete process.env.RUN_CAPSULE; else process.env.RUN_CAPSULE = previous.capsule;
		if (previous.telemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previous.telemetry;
	}
});

test("plan_update runs the SAME mature gate machinery as plan_write: ladder, dedupe, identity, honest output", async () => {
	const { writeFileSync } = await import("node:fs");
	const previous = {
		mode: process.env.PLAN_MODE,
		agent: process.env.PI_CODING_AGENT_DIR,
		capsule: process.env.RUN_CAPSULE,
		telemetryFile: process.env.TELEMETRY_FILE,
		telemetrySource: process.env.TELEMETRY_SOURCE,
	};
	const cwd = mkdtempSync(join(tmpdir(), "pi-adaptive-gate-"));
	const agent = mkdtempSync(join(tmpdir(), "pi-adaptive-gate-agent-"));
	const telemetry = join(agent, "telemetry.jsonl");
	const capsuleId = "33333333-3333-4333-8333-333333333333";
	process.env.PLAN_MODE = "adaptive";
	process.env.PI_CODING_AGENT_DIR = agent;
	process.env.RUN_CAPSULE = "shadow";
	process.env.TELEMETRY_FILE = telemetry;
	process.env.TELEMETRY_SOURCE = "test";
	const previousGateMax = process.env.PLAN_GATE_MAX;
	process.env.PLAN_GATE_MAX = "2";
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId };
	try {
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-runner.ts?adaptivegate=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		writeFileSync(join(cwd, "bad.sh"), "if [ ; then fi\n"); // bash -n fails
		await callTool(fp, "plan_write", {
			items: [
				{ title: "alpha", status: "pending", gate: "bash -n bad.sh" },
				{ title: "beta", status: "pending", gate: "bash -n bad.sh" },
			], request: "r", summary: "s",
		}, cwd);
		const privateState = join(runCapsuleDirectory(agent, cwd, capsuleId), "plan-state.json");
		const ids = JSON.parse(readFileSync(privateState, "utf8")).items.map((i: { id: string }) => i.id);

		// First failure: rung 1 leads with bounded, explicitly untrusted evidence;
		// the first version reported "status updated" over a silently reverted item.
		const first = await callTool(fp, "plan_update", { deltas: [{ item_id: ids[0], status: "done" }] }, cwd);
		assert.ok(first.content[0].text.includes("UNTRUSTED_GATE_DIAGNOSTIC"), first.content[0].text);
		assert.ok(first.content[0].text.includes("change the implementation"), first.content[0].text);
		assert.equal(first.details.success, false, "a failed gate is not a success");
		let state = JSON.parse(readFileSync(privateState, "utf8"));
		assert.equal(state.items[0].status, "in_progress");
		assert.equal(state.items[0].gate_fails, 1, "the escalation ladder counts this failure");

		// Repeating the exact same call ESCALATES instead of looping: rung 2, then blocked.
		const second = await callTool(fp, "plan_update", { deltas: [{ item_id: ids[0], status: "done" }] }, cwd);
		assert.match(second.content[0].text, /blocked|different strategy|subagent/, second.content[0].text);
		state = JSON.parse(readFileSync(privateState, "utf8"));
		assert.equal(state.items[0].status, "blocked", "GATE_MAX blocks — repeat plan_update(done) cannot spiral");
		assert.equal(state.items[0].gate_fails, 2);

		// Identity + dedupe: gate telemetry rows carry gate_sha256; two items sharing
		// one normalized gate in ONE call produce per-item rows but ONE kernel signal.
		const rows = readFileSync(telemetry, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		const gateRows = rows.filter((row) => row.ext === "plan-runner" && row.kind === "gate");
		assert.ok(gateRows.length >= 2, "plan_update gates emit gate telemetry");
		assert.ok(gateRows.every((row) => /^[a-f0-9]{64}$/.test(row.gate_sha256)), "every gate row carries identity");
	} finally {
		resetPiGlobals();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agent, { recursive: true, force: true });
		if (previous.mode === undefined) delete process.env.PLAN_MODE; else process.env.PLAN_MODE = previous.mode;
		if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agent;
		if (previous.capsule === undefined) delete process.env.RUN_CAPSULE; else process.env.RUN_CAPSULE = previous.capsule;
		if (previous.telemetryFile === undefined) delete process.env.TELEMETRY_FILE; else process.env.TELEMETRY_FILE = previous.telemetryFile;
		if (previous.telemetrySource === undefined) delete process.env.TELEMETRY_SOURCE; else process.env.TELEMETRY_SOURCE = previous.telemetrySource;
		if (previousGateMax === undefined) delete process.env.PLAN_GATE_MAX; else process.env.PLAN_GATE_MAX = previousGateMax;
	}
});
