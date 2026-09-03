import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { ownerRef } from "../lib/plan-graph.ts";

const CHILD = process.env.PLAN_GRAPH_TEST_CHILD === "1";

if (!CHILD) {
	test("hierarchical planner integration passes in an isolated flag-on process", () => {
		const artifacts = mkdtempSync(join(tmpdir(), "pi-plan-branch-artifacts-"));
		const contextPath = join(artifacts, "context.json");
		writeFileSync(contextPath, JSON.stringify({
			v: 1, profile: "deep-research", run_id: "branch-budget-run", parent_item_id: "branch-budget-root", owner_ref: ownerRef("branch-budget-run", "branch-budget-root"),
			depth: 1, budget: { searches: 2, reads: 3 }, limits: { max_depth: 2, max_children: 2 },
		}));
		const env = {
			...process.env, PLAN_GRAPH_TEST_CHILD: "1", PLAN_GRAPH: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_LEDGER: "on", PLAN_TOOL_GO: "on", PLAN_STORAGE: "project",
			PI_MUNCHKIN_PLAN_CONTEXT_PATH: contextPath, PI_MUNCHKIN_BRANCH_REPORT_PATH: join(artifacts, "report.json"),
		};
		delete (env as Record<string, string | undefined>).NODE_TEST_CONTEXT;
		try {
			const output = execFileSync(process.execPath, [
				"--experimental-strip-types", "--experimental-loader", resolve("harness/tests/ts-js-resolver.mjs"), "--test", import.meta.filename,
			], { cwd: process.cwd(), env, encoding: "utf8", stdio: "pipe" });
			assert.match(output, /pass 33/);
		} finally { rmSync(artifacts, { recursive: true, force: true }); }
	});
} else {
	const { mkdtempSync, readFileSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { callTool, expectToolError, fire, makeCtx, makeFakePi, resetPiGlobals } = await import("./integration-harness.ts");
	const { HARNESS_SIGNAL_CHANNEL } = await import("../lib/harness-signals.ts");
	const planRunnerModule = await import("../extensions/plan-runner.ts");
	const planRunner = planRunnerModule.default;
	const toolActivation = (await import("../extensions/tool-activation.ts")).default;
	const tmp = () => mkdtempSync(join(tmpdir(), "pi-plan-graph-"));
	const coverage = { strategy: "direct", scope: "bounded", returned_count: 1, truncated: false, budget_exhausted: false, failed: false, complete: true };
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
		const { ctx, notes } = makeCtx(cwd); await fp.commands.get("plan-status").handler("", ctx);
		assert.match(notes.at(-1) ?? "", /# Status\ncompleted/, "flat v5 plans preserve ordinary completion behavior");
		resetPiGlobals();
	});

	test("an oversized persisted v5 graph is rejected instead of silently truncated", async () => {
		const fp = fresh(); const cwd = tmp();
		const items = Array.from({ length: 25 }, (_, index) => ({ id: `node-${index + 1}`, title: `Node ${index + 1}`, status: "pending", kind: "work" }));
		const persisted = {
			schema_version: 5, run_id: "oversized", request: "oversized graph", summary: "must fail closed", autonomy: "lean", phase: "executing",
			created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z", items,
		};
		const path = join(cwd, ".pi", "plan-state.json");
		const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const original = `${JSON.stringify(persisted)}\n`;
		writeFileSync(path, original, { mode: 0o600 });
		await expectToolError(fp, "plan_update", { deltas: [{ item_id: "node-1", status: "done" }] }, cwd, /no plan exists yet/);
		assert.equal(readFileSync(path, "utf8"), original, "a malformed oversized graph must remain untouched");
		resetPiGlobals();
	});

	test("a tampered research profile cannot reload as an ordinary settleable graph", async () => {
		const fp = fresh(); const cwd = tmp();
		const persisted = {
			schema_version: 5, run_id: "tampered-profile", request: "research", summary: "must fail closed", autonomy: "lean", phase: "executing",
			created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z",
			profile: { name: "tampered" },
			items: [{ id: "research-root", title: "Research root", status: "done", kind: "research_branch", owner_ref: "a".repeat(24),
				budget: { allocated: { searches: 1, reads: 1 }, used: { searches: 1, reads: 1 } },
				coverage: { strategy: "direct", scope: "bounded", returned_count: 1, truncated: false, budget_exhausted: false, failed: false, complete: true } }],
		};
		const path = join(cwd, ".pi", "plan-state.json");
		const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const original = `${JSON.stringify(persisted)}\n`;
		writeFileSync(path, original, { mode: 0o600 });
		await expectToolError(fp, "plan_settle", { summary: "forged completion" }, cwd, /requires an active graph plan/);
		assert.equal(readFileSync(path, "utf8"), original, "tampered research state must remain untouched");
		resetPiGlobals();
	});

	test("research evidence gaps cannot reload as an ordinary graph without its profile", async () => {
		const fp = fresh(); const cwd = tmp();
		const persisted = {
			schema_version: 5, run_id: "orphaned-gaps", request: "research", summary: "must fail closed", autonomy: "lean", phase: "executing",
			created_at: "2026-08-25T00:00:00.000Z", updated_at: "2026-08-25T00:00:00.000Z",
			items: [{ id: "work-with-gaps", title: "Work with delegated evidence", status: "done", evidence_gaps: ["source:unverified"] }],
		};
		const path = join(cwd, ".pi", "plan-state.json");
		const { mkdirSync, readFileSync, writeFileSync } = await import("node:fs");
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const original = `${JSON.stringify(persisted)}\n`;
		writeFileSync(path, original, { mode: 0o600 });
		await expectToolError(fp, "plan_settle", { summary: "forged completion" }, cwd, /requires an active graph plan/);
		assert.equal(readFileSync(path, "utf8"), original, "orphaned research evidence must remain untouched");
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
		await expectToolError(fp, "research_plan_start", { request: "bad", summary: "over budget", branches: [{ title: "bad", budget: { searches: 4, reads: 6 } }] }, cwd, /active or unsettled graph plan already exists/);
		resetPiGlobals();
	});

	test("durable root dispatch leases are cleared by an explicit terminal update", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Lease branch", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		await expectToolError(fp, "plan_expand", { parent_item_id: context.parent_item_id, children: [{ title: "Concurrent leaf" }] }, cwd, /leased research branch cannot be expanded/);
		let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(typeof state.items[0].lease.lease_id, "string");
		await callTool(fp, "plan_update", { deltas: [{ item_id: context.parent_item_id, status: "blocked", note: "user cancelled delegated branch" }] }, cwd);
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked");
		assert.equal(state.items[0].lease, undefined, "terminal user transition releases the durable lease");
		resetPiGlobals();
	});

	test("validated branch results release their parent dispatch lease", async () => {
		const fp = fresh(); const cwd = tmp();
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		const started = await callTool(fp, "research_plan_start", { request: "Lease merge", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report: {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "blocked", note: "bounded failure",
			consumed: { searches: 0, reads: 0 }, evidence_gaps: ["bounded failure"], source_leads: [], children: [],
			coverage: { strategy: "direct", scope: "bounded", returned_count: 0, truncated: false, budget_exhausted: true, failed: false, complete: false },
		}, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked");
		assert.equal(state.items[0].lease, undefined, "merge closes the lease before publishing the branch outcome");
		resetPiGlobals();
	});

	test("unleased branch results cannot mutate an open research branch", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Unleased report", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "forged report",
			consumed: { searches: 1, reads: 1 }, evidence_gaps: [], source_leads: [], children: [], coverage,
		};
		// A valid owner reference is not proof that this process acquired the
		// parent-owned dispatch lease. Before the fix this signal was merged and
		// could create a child without any corresponding dispatch.
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context, report, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "pending");
		assert.equal(state.items.length, 1, "unleased report must not add child claims");
		resetPiGlobals();
	});

	test("late results from an earlier dispatch generation cannot claim a retried branch", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Late report", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 2, reads: 2 } }] }, cwd);
		const context = started.details.contexts[0];
		const firstLease = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(firstLease.ok, true);
		const firstContext = { ...context, lease_id: firstLease.lease_id, dispatch_epoch: 0 };
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "first generation",
			consumed: { searches: 0, reads: 0 }, evidence_gaps: [], source_leads: [], children: [], coverage,
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: firstContext, report, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		await callTool(fp, "plan_update", { deltas: [{ item_id: context.parent_item_id, status: "pending", note: "retry after first generation" }] }, cwd);
		const refreshed = await planRunnerModule.researchBranchDispatchContext(cwd, context);
		const secondLease = await planRunnerModule.acquireResearchBranchLease(cwd, refreshed!);
		assert.equal(secondLease.ok, true);
		// The old lease and epoch must not be accepted merely because this branch
		// has been reopened and is leased again.
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: firstContext, report: { ...report, note: "late first generation" }, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "pending");
		assert.equal(state.items[0].lease.lease_id, secondLease.lease_id);
		resetPiGlobals();
	});

	test("recovery marks a stale leased branch blocked before it can be retried", async () => {
		const fp = fresh(); const cwd = tmp();
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		const started = await callTool(fp, "research_plan_start", { request: "Lease recovery", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const path = join(cwd, ".pi", "plan-state.json");
		const stale = JSON.parse(readFileSync(path, "utf8")); stale.writer = "previous-parent-process";
		writeFileSync(path, `${JSON.stringify(stale)}\n`, { mode: 0o600 });
		resetPiGlobals();
		const next = makeFakePi();
		const reloaded = await import(`../extensions/plan-runner.ts?stale-recovery=${Date.now()}`);
		reloaded.default(next.pi as any);
		await fire(next, "session_start", {}, makeCtx(cwd).ctx);
		const recovered = JSON.parse(readFileSync(path, "utf8"));
		assert.equal(recovered.items[0].status, "blocked");
		assert.equal(recovered.items[0].lease, undefined);
		assert.match(recovered.items[0].note, /interrupted before a validated result/);
		resetPiGlobals();
	});

	test("cross-process plan mutations wait on the parent graph lock", async () => {
		const fp = fresh(); const cwd = tmp();
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		const started = await callTool(fp, "research_plan_start", { request: "Cross-process lock", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const lockPath = join(cwd, ".pi", "plan-state.json.lock");
		writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, token: "test-holder", created_at: new Date().toISOString() })}\n`, { mode: 0o600 });
		const childCode = `import { acquireResearchBranchLease } from ${JSON.stringify(resolve("harness/extensions/plan-runner.ts"))}; process.stdout.write("ready\\n"); const result = await acquireResearchBranchLease(process.env.LEASE_CWD, JSON.parse(process.env.LEASE_CONTEXT)); process.stdout.write(JSON.stringify(result) + "\\n");`;
		const child = spawn(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", childCode], {
			cwd: process.cwd(), env: { ...process.env, LEASE_CWD: cwd, LEASE_CONTEXT: JSON.stringify(context) },
			stdio: ["ignore", "pipe", "pipe"],
		});
		child.stdout.setEncoding("utf8");
		let output = "";
		const ready = new Promise<void>((resolveReady, rejectReady) => {
			const timer = setTimeout(() => rejectReady(new Error("lock child did not initialize")), 5_000);
			child.stdout.on("data", (chunk: string) => { output += chunk; if (output.includes("ready\n")) { clearTimeout(timer); resolveReady(); } });
			child.once("error", (error) => { clearTimeout(timer); rejectReady(error); });
		});
		try {
			await ready;
			await new Promise((resolve) => setTimeout(resolve, 150));
			assert.equal(output.trim(), "ready", "a second parent must wait instead of acquiring during the lock");
			await import("node:fs/promises").then(({ unlink }) => unlink(lockPath));
			await new Promise<void>((resolveDone, rejectDone) => {
				child.once("exit", (code) => code === 0 ? resolveDone() : rejectDone(new Error(`lock child exited ${code}: ${output}`)));
			});
			assert.match(output, /\"ok\":true/);
		} finally {
			await import("node:fs/promises").then(({ unlink }) => unlink(lockPath).catch(() => undefined));
			if (!child.killed) child.kill("SIGTERM");
		}
		resetPiGlobals();
	});

	test("a lock left by a dead parent process is reclaimed safely", async () => {
		const fp = fresh(); const cwd = tmp();
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		const started = await callTool(fp, "research_plan_start", { request: "Dead lock", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const lockPath = join(cwd, ".pi", "plan-state.json.lock");
		writeFileSync(lockPath, `${JSON.stringify({ pid: 9_999_999, lock_id: "dead-parent", created_at: new Date().toISOString() })}\n`, { mode: 0o600 });
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true, "a lock whose owner no longer exists must not strand the graph");
		resetPiGlobals();
	});

	test("starting a research graph activates the parent research and delegation families", async () => {
		const fp = makeFakePi(); const cwd = tmp();
		for (const name of ["read", "bash", "edit", "write", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "web_search", "web_read", "research_note", "research_recall", "subagent"]) {
			fp.pi.registerTool({ name, parameters: {} } as any);
		}
		planRunner(fp.pi as any);
		toolActivation(fp.pi as any);
		fp.pi.setActiveTools([...fp.tools.keys()]);
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		assert.equal(fp.pi.getActiveTools().includes("web_search"), false);
		assert.equal(fp.pi.getActiveTools().includes("subagent"), false);
		await callTool(fp, "capability", { action: "enable", family: "planning" }, cwd);
		await callTool(fp, "research_plan_start", {
			request: "Compare two approaches", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }],
		}, cwd);
		assert.ok(fp.pi.getActiveTools().includes("web_search"), "research graph must expose web search after start");
		assert.ok(fp.pi.getActiveTools().includes("web_read"), "research graph must expose web reads after start");
		assert.ok(fp.pi.getActiveTools().includes("subagent"), "research graph must expose delegation after start");
		resetPiGlobals();
	});

	test("research plan names the role required by the planned delegation contract", async () => {
		const fp = fresh(); const cwd = tmp();
		const result = await callTool(fp, "research_plan_start", {
			request: "Compare approaches", summary: "one evidence branch",
			branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }],
		}, cwd);
		const text = result.content.map((block: any) => block?.text ?? "").join("\n");
		assert.match(text, /research-planner/);
		assert.doesNotMatch(text, /matching researcher subagent/);
		resetPiGlobals();
	});

	test("research planner may finish a bounded branch directly without scout fan-out", () => {
		const instructions = readFileSync(new URL("../agents/research-planner.md", import.meta.url), "utf8");
		assert.match(instructions, /complete the branch directly/i);
		assert.match(instructions, /do not create scout leaves/i);
		assert.match(instructions, /call `branch_plan` once with a terminal status/i);
		assert.doesNotMatch(instructions, /Call `branch_plan` before expanding the branch\. Create at most two pending child leaves/);
	});

	test("research plan rejects over-budget roots with the actionable discovery envelope", async () => {
		const fp = fresh(); const cwd = tmp();
		await expectToolError(fp, "research_plan_start", {
			request: "Compare approaches", summary: "too much discovery", branches: [
				{ title: "Primary evidence", budget: { searches: 4, reads: 6 } },
			],
		}, cwd, /at most 3 searches and 5 reads total/);
		resetPiGlobals();
	});

	test("validated child result merges; settlement waits for parent evidence", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Investigate", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 2, reads: 3 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "branch synthesized",
			consumed: { searches: 2, reads: 3 }, evidence_gaps: [], coverage,
			children: [{ item_id: "leaf-one", title: "Leaf", status: "done", coverage, budget: { allocated: { searches: 2, reads: 3 }, used: { searches: 2, reads: 3 } } }],
			source_leads: [{ url: "https://example.test/source", claim: "claim", quote: "quote" }],
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items.length, 2); assert.equal(state.items[1].parent_id, state.items[0].id);
		const { ctx: statusCtx, notes } = makeCtx(cwd); await fp.commands.get("plan-status").handler("", statusCtx);
		assert.match(notes.at(-1) ?? "", /ready for settlement/);
		await fp.commands.get("plan-export").handler("", makeCtx(cwd).ctx);
		assert.match(readFileSync(join(cwd, ".pi", "TODO.md"), "utf8"), new RegExp(state.items[1].id), "text export must disclose descendants, not only ambient roots");
		await expectToolError(fp, "plan_settle", { summary: "done" }, cwd, /delegated source not parent-verified/);
		(globalThis as Record<string, unknown>).__pi_plan_validation_urls = ["https://example.test/source", "https://second.example.test/source"];
		assert.equal((await callTool(fp, "plan_settle", { summary: "verified and complete" }, cwd)).isError, false);
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.ok(state.settled_at); assert.equal(fp.pi.getActiveTools().includes("plan_settle"), false);
		const frozen = readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8");
		await expectToolError(fp, "plan_update", { deltas: [{ item_id: state.items[0].id, note: "late rewrite" }] }, cwd, /settled plans are immutable/);
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context, report: { ...report, note: "late child result" }, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		assert.equal(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"), frozen, "late child results cannot mutate a settled graph");
		resetPiGlobals();
	});

	test("explicit branch retries receive only the unspent budget and accumulate usage", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Retry bounded research", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 2, reads: 3 } }] }, cwd);
		const context = started.details.contexts[0];
		const firstLease = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(firstLease.ok, true);
		const firstLeasedContext = { ...context, lease_id: firstLease.lease_id, dispatch_epoch: 0 };
		const firstReport = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "first attempt",
			consumed: { searches: 1, reads: 1 }, evidence_gaps: [], source_leads: [], children: [], coverage,
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: firstLeasedContext, report: firstReport, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		assert.deepEqual(JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8")).items[0].budget.used, { searches: 1, reads: 1 }, "first merge should record usage");
		await callTool(fp, "plan_update", { deltas: [{ item_id: context.parent_item_id, status: "pending", note: "explicitly retry with the remaining envelope" }] }, cwd);
		const refreshed = await planRunnerModule.researchBranchDispatchContext(cwd, context);
		assert.deepEqual(refreshed?.budget, { searches: 1, reads: 2 }, "retry context must be rebound to the graph remainder");
		const stale = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.deepEqual(stale, { ok: false, reason: "stale-context" }, "the original full-allocation context must be rejected");
		const leased = await planRunnerModule.acquireResearchBranchLease(cwd, refreshed!);
		assert.equal(leased.ok, true);
		const secondLeasedContext = { ...refreshed!, lease_id: leased.lease_id };
		const secondReport = {
			v: 1, parent_item_id: refreshed!.parent_item_id, owner_ref: refreshed!.owner_ref, status: "done", note: "retry attempt",
			consumed: refreshed!.budget, evidence_gaps: [], source_leads: [], children: [], coverage,
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: secondLeasedContext, report: secondReport, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.deepEqual(state.items[0].budget.used, { searches: 2, reads: 3 }, "merge must retain cumulative usage across retries");
		resetPiGlobals();
	});

	test("reopening a research branch clears stale evidence receipts", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Reopen evidence", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 2, reads: 2 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		const firstReport = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "first evidence",
			consumed: { searches: 1, reads: 1 }, evidence_gaps: [],
			source_leads: [{ url: "https://example.test/old-source", claim: "old claim", quote: "old quote" }], children: [], coverage,
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report: firstReport, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].coverage.complete, true);
		assert.deepEqual(state.items[0].source_leads, ["https://example.test/old-source"]);
		await callTool(fp, "plan_update", { deltas: [{ item_id: context.parent_item_id, status: "pending", note: "retry with fresh evidence" }] }, cwd);
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].coverage, undefined, "a reopened branch must not retain a prior completion receipt");
		assert.equal(state.items[0].source_leads, undefined, "a reopened branch must not retain stale delegated sources");
		assert.equal(state.items[0].defer, undefined, "a reopened branch must not retain a prior deferral");
		resetPiGlobals();
	});

	test("missing report blocks only its branch and subtree status remains available", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Investigate", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 2 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report: null, failureClass: "missing_report" });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked"); assert.match(state.items[0].note, /missing_report/);
		const { ctx, notes } = makeCtx(cwd); await fp.commands.get("plan-status").handler(context.parent_item_id, ctx);
		assert.match(notes.at(-1) ?? "", new RegExp(`Subtree ${context.parent_item_id}`));
		resetPiGlobals();
	});

	test("invalid branch reports burn the uncertain discovery envelope before reopen", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Invalid report", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 2, reads: 2 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report: null, failureClass: "invalid_report" });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked");
		assert.deepEqual(state.items[0].budget.used, state.items[0].budget.allocated, "unknown report usage must be conservatively consumed");
		await callTool(fp, "plan_update", { deltas: [{ item_id: context.parent_item_id, status: "pending", note: "reopen must not regain uncertain budget" }] }, cwd);
		const refreshed = await planRunnerModule.researchBranchDispatchContext(cwd, context);
		assert.deepEqual(refreshed?.budget, { searches: 0, reads: 0 });
		const retry = await planRunnerModule.acquireResearchBranchLease(cwd, refreshed!);
		assert.deepEqual(retry, { ok: false, reason: "budget-exhausted" });
		state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "pending");
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
		const reports = [] as Array<{ context: any; report: any }>;
		for (const [index, context] of started.details.contexts.entries() as IterableIterator<[number, any]>) {
			const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
			assert.equal(acquired.ok, true);
			reports.push({
				context: { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 },
				report: {
					v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: `branch ${index} synthesized`,
					consumed: context.budget, evidence_gaps: [], source_leads: [], coverage,
					children: [{ item_id: `parallel-leaf-${index}`, title: `Leaf ${index}`, status: "done", coverage, budget: { allocated: context.budget, used: context.budget } }],
				},
			});
		}
		for (const entry of reports) fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", ...entry, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items.length, 4);
		assert.deepEqual(state.items.filter((item: any) => item.parent_id).map((item: any) => item.id).sort(), ["parallel-leaf-0", "parallel-leaf-1"]);
		resetPiGlobals();
	});

	test("the first terminal branch result wins and an unsettled graph cannot be overwritten", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", { request: "Investigate", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "first terminal result",
			consumed: context.budget, evidence_gaps: [], source_leads: [], coverage,
			children: [{ item_id: "winning-leaf", title: "Winner", status: "done", coverage, budget: { allocated: context.budget, used: context.budget } }],
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report, failureClass: null });
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report: null, failureClass: "child_failed" });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "done");
		assert.equal(state.items[0].note, "first terminal result");
		await expectToolError(fp, "research_plan_start", { request: "replace", summary: "must not replace", branches: [{ title: "New", budget: { searches: 1, reads: 1 } }] }, cwd, /unsettled graph plan already exists/);
		resetPiGlobals();
	});

	test("a delegated child ID collision blocks the owning branch instead of leaving it open", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", {
			request: "Compare two evidence families", summary: "two branches",
			branches: [
				{ title: "Branch A", budget: { searches: 2, reads: 2 } },
				{ title: "Branch B", budget: { searches: 1, reads: 1 } },
			],
		}, cwd);
		const [context] = started.details.contexts;
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		const stateBefore = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		const collidingId = stateBefore.items[1].id;
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "done", note: "collision",
			consumed: context.budget, evidence_gaps: [], source_leads: [], coverage,
			children: [{ item_id: collidingId, title: "Colliding leaf", status: "done", coverage,
				budget: { allocated: context.budget, used: context.budget } }],
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked");
		assert.match(state.items[0].note, /merge_collision/);
		assert.equal(state.items.length, 2, "the colliding child must not be admitted");
		resetPiGlobals();
	});

	test("a report that violates graph invariants blocks the branch instead of being swallowed", async () => {
		const fp = fresh(); const cwd = tmp();
		const started = await callTool(fp, "research_plan_start", {
			request: "Investigate", summary: "one branch",
			branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }],
		}, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		const incomplete = { strategy: "direct", scope: "bounded", returned_count: 0, truncated: false, budget_exhausted: true, failed: false, complete: false };
		const report = {
			v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "blocked", note: "no allocation",
			consumed: { searches: 0, reads: 0 }, evidence_gaps: ["no allocation"], source_leads: [], coverage: incomplete,
			children: [{ item_id: "zero-budget", title: "Zero budget", status: "blocked", evidence_gaps: ["no allocation"], coverage: incomplete,
				budget: { allocated: { searches: 0, reads: 0 }, used: { searches: 0, reads: 0 } } }],
		};
		fp.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report, failureClass: null });
		await fire(fp, "before_agent_start", {}, makeCtx(cwd).ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked");
		assert.match(state.items[0].note, /merge_rejected/);
		assert.equal(state.items.length, 1, "invalid children must not be admitted");
		resetPiGlobals();
	});

	test("branch_plan reserves only the unspent local remainder for scouts", async () => {
		const fp = fresh(); const cwd = tmp();
		(globalThis as Record<string, unknown>).__pi_research_state = { searches: 1, reads: 1 };
		const base = {
			status: "pending", note: "allocate one scout", consumed: { searches: 1, reads: 1 }, source_leads: [], evidence_gaps: [],
			children: [{ item_id: "reserved-leaf", title: "Reserved leaf", status: "pending", budget: { allocated: { searches: 1, reads: 2 }, used: { searches: 0, reads: 0 } } }],
		};
		assert.equal((await callTool(fp, "branch_plan", base, cwd)).isError, false);
		assert.deepEqual((globalThis as Record<string, unknown>).__pi_research_reserved_budget, { searches: 1, reads: 2 });
		await expectToolError(fp, "branch_plan", {
			...base, children: [{ ...base.children[0], budget: { allocated: { searches: 2, reads: 2 }, used: { searches: 0, reads: 0 } } }],
		}, cwd, /child allocations exceed the branch remainder/);
		resetPiGlobals();
	});

	test("research-planner children retain their branch report tool after startup narrowing", async () => {
		const fp = makeFakePi(); const cwd = tmp();
		for (const name of ["read", "bash", "edit", "write", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "branch_plan", "web_search", "web_read", "subagent"]) {
			fp.pi.registerTool({ name, parameters: {} } as any);
		}
		planRunner(fp.pi as any);
		toolActivation(fp.pi as any);
		fp.pi.setActiveTools([...fp.tools.keys()]);
		await fire(fp, "session_start", {}, makeCtx(cwd).ctx);
		assert.ok(fp.pi.getActiveTools().includes("branch_plan"), "a branch planner must be able to publish its validated report");
		resetPiGlobals();
	});

	test("delegated branch startup never reclaims the parent lease", async () => {
		const parent = fresh(); const cwd = tmp();
		const started = await callTool(parent, "research_plan_start", { request: "Parent lease", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const contextArtifactPath = process.env.PI_MUNCHKIN_PLAN_CONTEXT_PATH!;
		const originalContextArtifact = readFileSync(contextArtifactPath);
		writeFileSync(contextArtifactPath, `${JSON.stringify(context)}\n`, { mode: 0o600 });
		// A real branch planner is a new process. Its plan-runner must not mistake
		// the parent process's writer marker for an interrupted parent session and
		// reclaim the lease before the child can publish its report.
		resetPiGlobals();
		const child = makeFakePi();
		for (const name of ["read", "bash", "edit", "write", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "branch_plan", "web_search", "web_read", "subagent"]) {
			child.pi.registerTool({ name, parameters: {} } as any);
		}
		(await import(`../extensions/plan-runner.ts?delegated-child=${Date.now()}-${Math.random()}`)).default(child.pi as any);
		(await import(`../extensions/tool-activation.ts?delegated-child=${Date.now()}-${Math.random()}`)).default(child.pi as any);
		child.pi.setActiveTools([...child.tools.keys()]);
		await fire(child, "session_start", {}, makeCtx(cwd).ctx);
		child.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "capsule/identity" });
		await fire(child, "before_agent_start", {}, makeCtx(cwd).ctx);
		try {
			const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
			assert.equal(state.items[0].status, "pending", "the branch child must not perform parent stale-lease recovery");
			assert.equal(state.items[0].lease.lease_id, acquired.lease_id, "parent dispatch lease remains authoritative until its result arrives");
		} finally {
			writeFileSync(contextArtifactPath, originalContextArtifact, { mode: 0o600 });
		}
		resetPiGlobals();
	});

	test("ordinary subagent startup never reclaims a parent research lease", async () => {
		const parent = fresh(); const cwd = tmp();
		const started = await callTool(parent, "research_plan_start", { request: "Parent lease", summary: "one branch", branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }] }, cwd);
		const context = started.details.contexts[0];
		const acquired = await planRunnerModule.acquireResearchBranchLease(cwd, context);
		assert.equal(acquired.ok, true);
		const leasedContext = { ...context, lease_id: acquired.lease_id, dispatch_epoch: 0 };
		const path = join(cwd, ".pi", "plan-state.json");
		const stale = JSON.parse(readFileSync(path, "utf8")); stale.writer = "previous-parent-process";
		writeFileSync(path, `${JSON.stringify(stale)}\n`, { mode: 0o600 });
		const previousDepth = process.env.PI_SUBAGENT_DEPTH;
		process.env.PI_SUBAGENT_DEPTH = "1";
		try {
			// Ordinary delegated agents have no plan_context or branch report path,
			// but they still share the project cwd. Parent graph recovery must remain
			// disabled for them just as it is for planned research children.
			resetPiGlobals();
			const child = makeFakePi();
			for (const name of ["read", "bash", "edit", "write", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "plan_go", "web_search", "web_read", "subagent"]) {
				child.pi.registerTool({ name, parameters: {} } as any);
			}
			(await import(`../extensions/plan-runner.ts?ordinary-child=${Date.now()}-${Math.random()}`)).default(child.pi as any);
			child.pi.setActiveTools([...child.tools.keys()]);
			await fire(child, "session_start", {}, makeCtx(cwd).ctx);
			const parentOnly = /persistent plan mutation is parent-owned/i;
			await expectToolError(child, "plan_write", { items: [{ title: "forbidden" }] }, cwd, parentOnly);
			await expectToolError(child, "plan_update", { deltas: [{ item_id: context.parent_item_id, status: "done" }] }, cwd, parentOnly);
			await expectToolError(child, "plan_expand", { parent_item_id: context.parent_item_id, children: [{ title: "forbidden", budget: { searches: 1, reads: 0 } }] }, cwd, parentOnly);
			await expectToolError(child, "plan_settle", { summary: "forbidden" }, cwd, parentOnly);
			await expectToolError(child, "research_plan_start", { request: "forbidden", summary: "forbidden", branches: [{ title: "forbidden", budget: { searches: 1, reads: 1 } }] }, cwd, parentOnly);
			await expectToolError(child, "plan_go", {}, cwd, parentOnly);
			await assert.rejects(
				() => child.commands.get("plan-cancel")!.handler("", makeCtx(cwd).ctx),
				parentOnly,
			);
			await assert.rejects(
				() => child.commands.get("plan")!.handler("forbidden", makeCtx(cwd).ctx),
				parentOnly,
			);
			await assert.rejects(
				() => child.commands.get("plan-go")!.handler("", makeCtx(cwd).ctx),
				parentOnly,
			);
			await assert.rejects(
				() => child.commands.get("plan-export")!.handler("", makeCtx(cwd).ctx),
				parentOnly,
			);
			// A child must not turn a local lifecycle signal into a parent graph
			// mutation either. The signal is intentionally forged here to exercise
			// the subscriber boundary directly; model-callable paths are covered
			// above, while real child processes have their own event bus.
			child.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "plan/branch-result", context: leasedContext, report: {
				v: 1, parent_item_id: context.parent_item_id, owner_ref: context.owner_ref, status: "blocked", note: "forged child merge",
				consumed: { searches: 0, reads: 0 }, evidence_gaps: ["forged"], source_leads: [], children: [], coverage,
			}, failureClass: null });
			await fire(child, "before_agent_start", {}, makeCtx(cwd).ctx);
			child.pi.events.emit(HARNESS_SIGNAL_CHANNEL, { v: 1, type: "capsule/identity" });
			await fire(child, "before_agent_start", {}, makeCtx(cwd).ctx);
			const recovered = JSON.parse(readFileSync(path, "utf8"));
			assert.equal(recovered.items[0].status, "pending", "ordinary children must not perform parent stale-lease recovery");
			assert.equal(recovered.items[0].lease.lease_id, acquired.lease_id, "the parent dispatch lease remains authoritative");
		} finally {
			if (previousDepth === undefined) delete process.env.PI_SUBAGENT_DEPTH;
			else process.env.PI_SUBAGENT_DEPTH = previousDepth;
		}
		resetPiGlobals();
	});

	test("branch reports cannot drop a scout after it has been dispatched", async () => {
		const fp = fresh(); const cwd = tmp();
		const contextKey = "branch-budget-run:branch-budget-root:" + ownerRef("branch-budget-run", "branch-budget-root");
		(globalThis as Record<string, unknown>).__pi_research_scout_dispatched_v1 = { key: contextKey, ids: ["already-dispatched"] };
		await expectToolError(fp, "branch_plan", {
			status: "pending", note: "replace the in-flight scout", consumed: { searches: 0, reads: 0 },
			children: [], source_leads: [], evidence_gaps: [],
		}, cwd, /retain dispatched scout leaf already-dispatched/);
		resetPiGlobals();
	});

	test("branch_plan exposes exact scout contexts in model-visible content", async () => {
		const fp = fresh(); const cwd = tmp();
		const result = await callTool(fp, "branch_plan", {
			status: "pending", note: "allocate one scout", consumed: { searches: 0, reads: 0 }, source_leads: [], evidence_gaps: [],
			children: [{ item_id: "visible-leaf", title: "Visible leaf", status: "pending", budget: { allocated: { searches: 1, reads: 1 }, used: { searches: 0, reads: 0 } } }],
		}, cwd);
		assert.equal(result.isError, false);
		const text = result.content.map((block: any) => block?.text ?? "").join("\n");
		assert.match(text, /visible-leaf/);
		assert.match(text, /\"depth\":2/);
		assert.match(text, /\"owner_ref\":\"[a-f0-9]{24}\"/);
		resetPiGlobals();
	});

	test("branch_plan explains the incomplete-coverage truth table", async () => {
		const fp = fresh(); const cwd = tmp();
		const malformed = {
			status: "pending", note: "incomplete transport probe", consumed: { searches: 0, reads: 0 },
			children: [], source_leads: [], evidence_gaps: ["no retrieval"],
			coverage: { strategy: "direct", scope: "bounded", returned_count: 0, truncated: false, budget_exhausted: false, failed: false, complete: false },
		};
		await expectToolError(fp, "branch_plan", malformed, cwd, /coverage is incomplete.*(?:truncated|budget_exhausted|failed)/i);
		const recovered = await callTool(fp, "branch_plan", malformed, cwd);
		assert.equal(recovered.isError, false, "a repeated malformed report fails closed as a terminal branch");
		const report = JSON.parse(readFileSync(join(process.env.PI_MUNCHKIN_BRANCH_REPORT_PATH!), "utf8"));
		assert.equal(report.status, "blocked");
		assert.equal(report.coverage.failed, true);
		assert.deepEqual(report.consumed, { searches: 2, reads: 3 }, "repeated malformed reports burn the untrusted attempt remainder");
		assert.match(report.evidence_gaps[0], /invalid coverage/i);
		resetPiGlobals();
	});

	test("branch_plan explains missing terminal-child coverage receipts", async () => {
		const fp = fresh(); const cwd = tmp();
		await expectToolError(fp, "branch_plan", {
			status: "blocked", note: "blocked after a bounded probe", consumed: { searches: 0, reads: 0 },
			children: [{ item_id: "missing-receipt", title: "Missing receipt", status: "blocked", budget: { allocated: { searches: 0, reads: 0 }, used: { searches: 0, reads: 0 } } }],
			source_leads: [], evidence_gaps: ["probe stopped"], coverage,
		}, cwd, /terminal child .*coverage/i);
		resetPiGlobals();
	});
}
