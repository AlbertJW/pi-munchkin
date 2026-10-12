// An active goal must not restart parent-led research that is paused, awaiting the
// user's /research-extend, or blocked (audit 2026-10 V8). Offline fake Pi.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { mutateResearchAggregate, researchAggregatePath, transitionAggregate } from "../lib/research-aggregate.ts";
import { onContinuationRequest } from "../lib/continuation-authority.ts";
import { createGoal, mutateGoal } from "../lib/goal-state.ts";
import { claimIdForText } from "../lib/research-evidence.ts";
import { callTool, fire, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

const FLAGS = { RESEARCH_WORKFLOW: "parent", PLAN_GRAPH: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_LEDGER: "on", PLAN_STORAGE: "project" };

async function goalOffersWithResearch(phase: "active" | "awaiting_extension" | "paused"): Promise<number> {
	const cwd = mkdtempSync(join(tmpdir(), "pi-goal-research-hold-"));
	const previous = Object.fromEntries([...Object.keys(FLAGS), "PI_CODING_AGENT_DIR"].map((key) => [key, process.env[key]]));
	Object.assign(process.env, FLAGS, { PI_CODING_AGENT_DIR: mkdtempSync(join(tmpdir(), "pi-goal-research-agent-")) });
	try {
		const fp = makeFakePi();
		for (const name of ["read", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "research_round", "web_search", "web_read", "research_note", "research_finish", "subagent"]) {
			fp.pi.registerTool({ name, parameters: {} } as any);
		}
		const tag = `${Date.now()}-${Math.random()}`;
		(await import(`../extensions/plan-runner.ts?hold=${tag}`)).default(fp.pi as any);
		(await import(`../extensions/control-arbiter.ts?hold=${tag}`)).default(fp.pi as any);
		fp.pi.setActiveTools([...fp.tools.keys()]);
		const ctx = { cwd, sessionManager: { getSessionId: () => "hold-session", getEntries: () => [] }, ui: { notify() {} }, model: undefined };
		await fire(fp, "session_start", { reason: "startup" }, ctx);
		const claim = claimIdForText("held claim");
		const started = await callTool(fp, "research_plan_start", {
			request: "Paused research", summary: "one branch",
			claim_obligations: [{ claim_id: claim, text: "held claim", required: true, missing: "evidence", why: "required", next_action: "validate" }],
			branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }],
		}, cwd);
		assert.equal(started.isError, false);
		const runId: string = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8")).run_id;
		if (phase !== "active") {
			await mutateResearchAggregate(researchAggregatePath(cwd, runId, process.env), (state) => ({ state: transitionAggregate(state, { phase }), result: undefined }));
		}
		await mutateGoal(cwd, async () => ({ goal: createGoal({ cwd, objective: "Finish the research" }), result: undefined }));
		let offers = 0;
		onContinuationRequest(fp.pi.events as never, (envelope) => { if (envelope.request.reason === "goal") offers += 1; });
		await fire(fp, "agent_end", {}, ctx);
		await new Promise((resolve) => setTimeout(resolve, 20));
		return offers;
	} finally {
		for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
		resetPiGlobals();
	}
}

test("an active goal is offered a continuation while parent research is active", async () => {
	assert.equal(await goalOffersWithResearch("active"), 1);
});

for (const phase of ["awaiting_extension", "paused"] as const) {
	test(`an active goal cannot restart parent research that is ${phase}`, async () => {
		assert.equal(await goalOffersWithResearch(phase), 0);
	});
}
