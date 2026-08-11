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
