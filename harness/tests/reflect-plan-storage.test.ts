import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { planArtifact } from "../extensions/reflect.ts";
import { runCapsuleDirectory } from "../lib/run-capsule-store.ts";

test("reflect reads the session capsule projection and ignores a stale project TODO", async () => {
	const previous = {
		agent: process.env.PI_CODING_AGENT_DIR,
		storage: process.env.PLAN_STORAGE,
		capsule: process.env.RUN_CAPSULE,
	};
	const cwd = mkdtempSync(join(tmpdir(), "pi-reflect-plan-"));
	const agent = mkdtempSync(join(tmpdir(), "pi-reflect-agent-"));
	const capsuleId = "99999999-9999-4999-8999-999999999999";
	process.env.PI_CODING_AGENT_DIR = agent;
	delete process.env.PLAN_STORAGE;
	process.env.RUN_CAPSULE = "shadow";
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId };
	try {
		const directory = runCapsuleDirectory(agent, cwd, capsuleId);
		mkdirSync(directory, { recursive: true });
		writeFileSync(join(directory, "plan.md"), "# Active Request\nprivate current plan\n");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "TODO.md"), "stale project plan\n");
		assert.equal(await planArtifact(cwd), "# Active Request\nprivate current plan");
	} finally {
		delete (globalThis as Record<string, unknown>).__pi_run_capsule_identity;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agent, { recursive: true, force: true });
		if (previous.agent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous.agent;
		if (previous.storage === undefined) delete process.env.PLAN_STORAGE; else process.env.PLAN_STORAGE = previous.storage;
		if (previous.capsule === undefined) delete process.env.RUN_CAPSULE; else process.env.RUN_CAPSULE = previous.capsule;
	}
});
