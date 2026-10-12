// Plan item dependencies through the real plan_write / plan_update tools: structure
// validation, the waiting rule, "now ready" reporting, stuck plans, revisions,
// persistence across a restart, legacy migration, and graph (v5) plans.
import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callTool, expectToolError, fire, makeCtx, makeFakePi, resetPiGlobals } from "./integration-harness.ts";
import { privatePlanStatePath } from "../lib/plan-state-storage.ts";
import { validateGraph, type GraphPlanState } from "../lib/plan-graph.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-plan-deps-agent-"));
delete process.env.PLAN_STORAGE;
const planRunner = (await import("../extensions/plan-runner.ts")).default;
const stateFile = (cwd: string) => privatePlanStatePath(cwd) ?? join(cwd, ".pi", "plan-state.json");
const readState = (cwd: string) => JSON.parse(readFileSync(stateFile(cwd), "utf8"));

function setup() {
	const cwd = mkdtempSync(join(tmpdir(), "pi-plan-deps-"));
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId: randomUUID(), runIdHash: null };
	const fp = makeFakePi();
	for (const name of ["read", "bash", "edit", "write", "capability"]) fp.pi.registerTool({ name, parameters: {} } as any);
	planRunner(fp.pi as any);
	fp.pi.setActiveTools([...fp.tools.keys()]);
	return { fp, cwd, ctx: makeCtx(cwd).ctx };
}
const text = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text ?? "").join("\n");
const chain = [
	{ item_id: "schema", title: "Design schema" },
	{ item_id: "api", title: "Build API", depends_on: ["schema"] },
	{ item_id: "ui", title: "Build UI", depends_on: ["api"] },
	{ item_id: "docs", title: "Write docs" },
];

test("plan_write stores dependencies and reports them; the next item is the first ready one", async () => {
	const { fp, cwd } = setup();
	try {
		const result = await callTool(fp, "plan_write", { items: chain }, cwd);
		assert.equal(result.isError, false, text(result));
		assert.match(text(result), /api Build API \(after schema\)/);
		const state = readState(cwd);
		assert.deepEqual(state.items.map((i: any) => [i.id, i.depends_on ?? null]), [["schema", null], ["api", ["schema"]], ["ui", ["api"]], ["docs", null]]);
		assert.equal((globalThis as any).__pi_active_plan_context.item_id, "schema");
	} finally { resetPiGlobals(); }
});

test("an item cannot start or finish before its dependencies; finishing and starting together works", async () => {
	const { fp, cwd } = setup();
	try {
		await callTool(fp, "plan_write", { items: chain }, cwd);
		await expectToolError(fp, "plan_update", { deltas: [{ item_id: "api", status: "in_progress" }] }, cwd, /api cannot be in_progress yet: it depends on schema \(pending\)/);
		await expectToolError(fp, "plan_update", { deltas: [{ item_id: "ui", status: "done" }] }, cwd, /ui cannot be done yet: it depends on api \(pending\)/);
		await callTool(fp, "plan_update", { deltas: [{ item_id: "schema", status: "in_progress" }] }, cwd);
		const together = await callTool(fp, "plan_update", { deltas: [{ item_id: "schema", status: "done" }, { item_id: "api", status: "in_progress" }] }, cwd);
		assert.equal(together.isError, false, text(together));
		const finished = await callTool(fp, "plan_update", { deltas: [{ item_id: "api", status: "done" }] }, cwd);
		assert.match(text(finished), /Now ready: ui\./);
		await callTool(fp, "plan_update", { deltas: [{ item_id: "ui", status: "in_progress" }] }, cwd);
		await expectToolError(fp, "plan_update", { deltas: [{ item_id: "api", status: "pending" }] }, cwd, /ui cannot be in_progress yet: it depends on api \(pending\)/);
		assert.equal(readState(cwd).items.find((i: any) => i.id === "ui").status, "in_progress", "a rejected update changes nothing");
	} finally { resetPiGlobals(); }
});

test("unknown, self, cyclic and over-limit dependencies are rejected before anything is saved", async () => {
	const { fp, cwd } = setup();
	try {
		await callTool(fp, "plan_write", { items: [{ item_id: "a", title: "A" }] }, cwd);
		const before = readFileSync(stateFile(cwd), "utf8");
		await expectToolError(fp, "plan_write", { items: [{ item_id: "a", title: "A", depends_on: ["ghost"] }] }, cwd, /a depends on unknown item ghost \(valid: a\)[\s\S]*Give every item you depend on an item_id/);
		await expectToolError(fp, "plan_write", { items: [{ item_id: "a", title: "A", depends_on: ["a"] }] }, cwd, /a cannot depend on itself/);
		await expectToolError(fp, "plan_write", { items: [
			{ item_id: "a", title: "A", depends_on: ["c"] }, { item_id: "b", title: "B", depends_on: ["a"] }, { item_id: "c", title: "C", depends_on: ["b"] },
		] }, cwd, /dependency cycle: a -> c -> b -> a/);
		await expectToolError(fp, "plan_write", { items: [{ title: "untagged" }, { item_id: "x", title: "X", depends_on: ["untagged"] }] }, cwd, /x depends on unknown item untagged/);
		assert.equal(readFileSync(stateFile(cwd), "utf8"), before, "no rejected write reached the file");
	} finally { resetPiGlobals(); }
});

test("revisions: omitted depends_on is kept, [] clears it, removed items drop out of the list", async () => {
	const { fp, cwd, ctx } = setup();
	try {
		await fp.commands.get("plan").handler("build the feature", ctx); // review phase: dropping items is a legitimate revision
		await callTool(fp, "plan_write", { items: chain }, cwd);
		await callTool(fp, "plan_write", { items: [
			{ item_id: "schema", title: "Design schema" }, { item_id: "api", title: "Build the API" },
			{ item_id: "ui", title: "Build UI", depends_on: [] }, { item_id: "docs", title: "Docs", depends_on: ["api", "ui"] },
		] }, cwd);
		let byId = Object.fromEntries(readState(cwd).items.map((i: any) => [i.id, i.depends_on ?? null]));
		assert.deepEqual(byId, { schema: null, api: ["schema"], ui: null, docs: ["api", "ui"] });
		await callTool(fp, "plan_write", { items: [{ item_id: "api", title: "Build the API" }, { item_id: "docs", title: "Docs" }] }, cwd);
		byId = Object.fromEntries(readState(cwd).items.map((i: any) => [i.id, i.depends_on ?? null]));
		assert.deepEqual(byId, { api: null, docs: ["api"] }, "references to removed items are dropped, others kept");
	} finally { resetPiGlobals(); }
});

test("a plan whose pending work waits on a blocked item reports itself as stuck", async () => {
	const { fp, cwd, ctx } = setup();
	try {
		await callTool(fp, "plan_write", { items: chain }, cwd);
		await callTool(fp, "plan_update", { deltas: [{ item_id: "schema", status: "blocked", note: "waiting for the DBA" }, { item_id: "docs", status: "done" }] }, cwd);
		const notes: string[] = [];
		await fp.commands.get("plan-status").handler("", { ...ctx, ui: { notify: (m: string) => notes.push(m) } });
		const status = notes.join("\n");
		assert.match(status, /stuck: api waits on schema; ui waits on api \(blocked or deferred; re-plan with plan_write\)/);
		assert.match(status, /api  \[pending\] Build API  needs: schema/);
	} finally { resetPiGlobals(); }
});

test("dependencies survive a restart (rebind from disk)", async () => {
	const { fp, cwd } = setup();
	await callTool(fp, "plan_write", { items: chain }, cwd);
	const identity = (globalThis as Record<string, unknown>).__pi_run_capsule_identity;
	resetPiGlobals();
	try {
		(globalThis as Record<string, unknown>).__pi_run_capsule_identity = identity;
		const again = makeFakePi();
		for (const name of ["read", "capability"]) again.pi.registerTool({ name, parameters: {} } as any);
		planRunner(again.pi as any);
		await fire(again, "session_start", {}, { ...makeCtx(cwd).ctx, cwd });
		await expectToolError(again, "plan_update", { deltas: [{ item_id: "api", status: "in_progress" }] }, cwd, /depends on schema/);
	} finally { resetPiGlobals(); }
});

test("legacy migration keeps valid dependencies and drops ones that no longer resolve", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-plan-deps-legacy-"));
	const previous = process.env.PLAN_STORAGE;
	process.env.PLAN_STORAGE = "project";
	try {
		const file = join(cwd, ".pi", "plan-state.json");
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, JSON.stringify({ schema_version: 4, run_id: "plan-legacy", request: "r", summary: "s", autonomy: "lean", phase: "executing",
			created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z",
			items: [{ id: "a", title: "A", status: "pending" }, { id: "b", title: "B", status: "pending", depends_on: ["a", "gone"] }, { id: "bad id!", title: "C", status: "pending" }] }));
		const fp = makeFakePi();
		planRunner(fp.pi as any);
		await expectToolError(fp, "plan_update", { deltas: [{ item_id: "b", status: "in_progress" }] }, cwd, /b cannot be in_progress yet: it depends on a \(pending\)/);
		await callTool(fp, "plan_update", { deltas: [{ item_id: "a", status: "done" }] }, cwd);
		assert.deepEqual(JSON.parse(readFileSync(file, "utf8")).items.find((i: any) => i.id === "b").depends_on, ["a"]);
	} finally {
		if (previous === undefined) delete process.env.PLAN_STORAGE; else process.env.PLAN_STORAGE = previous;
		resetPiGlobals();
	}
});

test("graph (v5) plans validate dependencies too", () => {
	const base = { schema_version: 5, run_id: "plan-g", request: "r", summary: "s", autonomy: "lean", phase: "executing",
		created_at: "2026-10-01T00:00:00.000Z", updated_at: "2026-10-01T00:00:00.000Z" } as const;
	const ok = { ...base, items: [{ id: "a", title: "A", status: "pending", kind: "work" }, { id: "b", title: "B", status: "pending", kind: "work", depends_on: ["a"] }] };
	assert.deepEqual(validateGraph(ok as unknown as GraphPlanState), []);
	const cyclic = { ...base, items: [{ id: "a", title: "A", status: "pending", kind: "work", depends_on: ["b"] }, { id: "b", title: "B", status: "pending", kind: "work", depends_on: ["a"] }] };
	assert.ok(validateGraph(cyclic as unknown as GraphPlanState).some((e) => /dependency cycle/.test(e)));
	const early = { ...base, items: [{ id: "a", title: "A", status: "pending", kind: "work" }, { id: "b", title: "B", status: "in_progress", kind: "work", depends_on: ["a"] }] };
	assert.ok(validateGraph(early as unknown as GraphPlanState).some((e) => /b cannot be in_progress yet/.test(e)));
});
