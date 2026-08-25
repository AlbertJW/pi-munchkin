import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

const CHILD = process.env.PLAN_GRAPH_TEST_CHILD === "1";

if (!CHILD) {
	test("hierarchical planner integration passes in an isolated flag-on process", () => {
		const env = { ...process.env, PLAN_GRAPH_TEST_CHILD: "1", PLAN_GRAPH: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_LEDGER: "on", PLAN_STORAGE: "project" };
		delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
		const output = execFileSync(process.execPath, [
			"--experimental-strip-types", "--experimental-loader", resolve("harness/tests/ts-js-resolver.mjs"), "--test", import.meta.filename,
		], { cwd: process.cwd(), env, encoding: "utf8", stdio: "pipe" });
		assert.match(output, /pass 5/);
	});
} else {
	const { mkdtempSync, readFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { callTool, expectToolError, fire, makeCtx, makeFakePi, resetPiGlobals } = await import("./integration-harness.ts");
	const { HARNESS_SIGNAL_CHANNEL } = await import("../lib/harness-signals.ts");
	const planRunner = (await import("../extensions/plan-runner.ts")).default;
	const tmp = () => mkdtempSync(join(tmpdir(), "pi-plan-graph-"));
	function fresh() {
		const fp = makeFakePi();
		for (const name of ["read", "bash", "edit", "write", "capability", "web_search", "web_read", "research_note", "subagent"]) fp.pi.registerTool({ name, parameters: {} } as any);
		planRunner(fp.pi as any);
		fp.pi.setActiveTools([...fp.tools.keys()]);
		return fp;
	}

	test("a v4 plan migrates to a flat v5 graph on its next mutation", async () => {
		const fp = fresh(); const cwd = tmp();
		const dir = join(cwd, ".pi");
		const { mkdirSync, writeFileSync } = await import("node:fs");
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, "plan-state.json"), JSON.stringify({
			schema_version: 4, run_id: "legacy", request: "legacy", summary: "flat", autonomy: "lean", phase: "executing",
			created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z", items: [{ id: "legacy-item", title: "Legacy", status: "pending" }],
		}));
		await callTool(fp, "plan_update", { deltas: [{ item_id: "legacy-item", status: "done" }] }, cwd);
		const migrated = JSON.parse(readFileSync(join(dir, "plan-state.json"), "utf8"));
		assert.equal(migrated.schema_version, 5); assert.equal(migrated.items[0].kind, "work"); assert.equal(migrated.items[0].parent_id, undefined);
		resetPiGlobals();
	});

	test("headless research activation creates a bounded v5 graph and exact delegation contexts", async () => {
		const fp = fresh(); const cwd = tmp();
		const result = await callTool(fp, "research_plan_start", {
			request: "Compare approaches", summary: "two evidence branches", branches: [
				{ title: "Primary evidence", budget: { searches: 2, reads: 3 } },
				{ title: "Counterevidence", budget: { searches: 1, reads: 2 } },
			],
		}, cwd);
		assert.equal(result.isError, false);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.schema_version, 5); assert.equal(state.profile.name, "deep-research");
		assert.equal(result.details.contexts.length, 2); assert.equal(result.details.contexts[0].parent_item_id, state.items[0].id);
		await expectToolError(fp, "research_plan_start", { request: "bad", summary: "over budget", branches: [{ title: "bad", budget: { searches: 4, reads: 6 } }] }, cwd, /active plan already exists/);
		resetPiGlobals();
	});

	test("validated child result merges; settlement waits for parent evidence", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Investigate", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 2, reads: 3 } }] }, cwd);
		const context = started.details.contexts[0];
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "branch synthesized",
			consumed: { searches: 2, reads: 3 }, evidence_gaps: [],
			children: [{ item_id: "leaf-one", title: "Leaf", status: "done", budget: { allocated: { searches: 2, reads: 3 }, used: { searches: 2, reads: 3 } } }],
			source_leads: [{ url: "https://example.test/source", claim: "claim", quote: "quote" }],
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context, report, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items.length, 2); assert.equal(state.items[1].parent_id, state.items[0].id);
		await expectToolError(fp, "plan_settle", { summary: "done" }, cwd, /delegated source not parent-verified/);
		(globalThis as Record<string, unknown>).__pi_plan_validation_urls = ["https://example.test/source", "https://second.example.test/source"];
		assert.equal((await callTool(fp, "plan_settle", { summary: "verified and complete" }, cwd)).isError, false);
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.ok(state.settled_at); assert.equal(fp.pi.getActiveTools().includes("plan_settle"), false);
		resetPiGlobals();
	});

	test("missing report blocks only its branch and subtree status remains available", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Investigate", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 2 } }] }, cwd);
		const context = started.details.contexts[0];
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context, report: null, failureClass: "missing_report" });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked"); assert.match(state.items[0].note, /missing_report/);
		const { ctx, notes } = makeCtx(cwd); await fp.commands.get("plan-status").handler(context.parent_item_id, ctx);
		assert.match(notes.at(-1) ?? "", new RegExp(`Subtree ${context.parent_item_id}`));
		resetPiGlobals();
	});

	test("concurrent branch arrivals serialize without losing either subtree", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", {
			request: "Compare two evidence families", summary: "parallel branches", branches: [
				{ title: "Branch A", budget: { searches: 2, reads: 3 } },
				{ title: "Branch B", budget: { searches: 1, reads: 2 } },
			],
		}, cwd);
		const reports = started.details.contexts.map((context: any, index: number) => ({
			context,
			report: {
				v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: `branch ${index} synthesized`,
				consumed: context.budget, evidence_gaps: [], source_leads: [],
				children: [{ item_id: `parallel-leaf-${index}`, title: `Leaf ${index}`, status: "done", budget: { allocated: context.budget, used: context.budget } }],
			},
		}));
		for (const entry of reports) fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", ...entry, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items.length, 4);
		assert.deepEqual(state.items.filter((item: any) => item.parent_id).map((item: any) => item.id).sort(), ["parallel-leaf-0", "parallel-leaf-1"]);
		resetPiGlobals();
	});
}
