import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, expectToolError, fire, makeCtx, makeFakePi, resetPiGlobals } from "./integration-harness.ts";
import { HARNESS_SIGNAL_CHANNEL } from "../lib/harness-signals.ts";
import { captureInitialToolSurface } from "../lib/session-bootstrap.ts";
import { privatePlanStatePath } from "../lib/plan-state-storage.ts";

// This suite used to pin `PLAN_STORAGE=project` at module scope, so all fifteen of
// its tests ran in the ROLLBACK configuration and none of them ever exercised what
// users actually get. That is why the capsule-mode handoff defects were invisible
// here (see plan-surface-handoff.test.ts). It now runs in the shipped default, with
// one explicit project-mode case below for the rollback it documents.
const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-plan-agent-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
delete process.env.PLAN_STORAGE;
const planRunner = (await import("../extensions/plan-runner.ts")).default;

/** Where the plan actually lives, resolved through the SAME function production
 *  uses. Hardcoding `.pi/plan-state.json` is what silently pinned this suite to
 *  project mode: the literal only exists in the rollback configuration. */
const stateFile = (cwd: string) => privatePlanStatePath(cwd) ?? join(cwd, ".pi", "plan-state.json");

/** A cwd with the run-capsule identity already published — what manifest index 26
 *  does at session_start, and what capsule plan storage needs to resolve a path. */
const tmp = () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-plan-bounded-"));
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId: randomUUID(), runIdHash: null };
	return cwd;
};

function fresh() {
	const fp = makeFakePi();
	for (const name of [
		"read", "grep", "find", "ls", "bash", "edit", "write", "search_spans", "read_span",
		"recall", "capability", "web_search", "web_read", "subagent", "browser_open", "tldraw_create",
	]) fp.pi.registerTool({ name, parameters: {} } as any);
	planRunner(fp.pi as any);
	fp.pi.setActiveTools([...fp.tools.keys()]);
	return fp;
}

async function begin(fp: ReturnType<typeof fresh>, cwd: string, request = "process meetings") {
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("plan").handler(request, ctx);
	return ctx;
}

test("ordinary sessions default to explicit planning and expose no plan mutation tools", async () => {
	const fp = fresh();
	const cwd = tmp();
	await fire(fp, "session_start", {}, { ...makeCtx(cwd).ctx, cwd });
	assert.equal(fp.pi.getActiveTools().includes("plan_write"), false);
	assert.equal(fp.pi.getActiveTools().includes("plan_update"), false);
	const ordinaryEdit = await fire(fp, "tool_call", { toolCallId: "ordinary-edit", toolName: "edit", input: { path: "x" } });
	assert.equal(ordinaryEdit, undefined, "ordinary mutation is not forced through planning");
	await begin(fp, cwd);
	assert.equal(fp.pi.getActiveTools().includes("plan_write"), true);
	assert.equal(fp.pi.getActiveTools().includes("edit"), false);
	resetPiGlobals();
});

test("/plan exposes only the bounded read-only planning surface", async () => {
	const fp = fresh();
	const cwd = tmp();
	await begin(fp, cwd);
	assert.deepEqual(fp.pi.getActiveTools().sort(), [
		"capability", "find", "grep", "ls", "plan_write", "read", "read_span", "recall", "search_spans",
	].sort());
	assert.match(fp.sent.at(-1) ?? "", /1-24 short top-level items/);
	const blocked = await fire(fp, "tool_call", { toolCallId: "blocked-edit", toolName: "edit", input: { path: "x" } });
	assert.equal(blocked?.block, true);
	assert.match(blocked.reason, /Planning is read-only/);
	resetPiGlobals();
});

test("AlbertWork-sized plan succeeds and exposes stable IDs", async () => {
	const fp = fresh();
	const cwd = tmp();
	await begin(fp, cwd);
	const result = await callTool(fp, "plan_write", {
		summary: "one bounded item per meeting",
		items: Array.from({ length: 20 }, (_, i) => ({ title: `Process meeting ${i + 1}`, note: "Read; extract; update" })),
	}, cwd);
	assert.equal(result.isError, false);
	const state = JSON.parse(readFileSync(stateFile(cwd), "utf8"));
	assert.equal(state.schema_version, 4);
	assert.equal(state.items.length, 20);
	assert.ok(state.items.every((item: any) => /^[A-F0-9]{16}$/.test(item.id)));
	assert.ok(result.content[0].text.includes(state.items[0].id));
	resetPiGlobals();
});

test("58-item rewrite is rejected before persistence and preserves the valid plan", async () => {
	const fp = fresh();
	const cwd = tmp();
	await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "Keep me" }] }, cwd);
	const before = readFileSync(stateFile(cwd), "utf8");
	await expectToolError(fp, "plan_write", {
		items: Array.from({ length: 58 }, (_, i) => ({ title: `Fragment ${i + 1}` })),
	}, cwd, /provide 1-24 top-level items/);
	assert.equal(readFileSync(stateFile(cwd), "utf8"), before);
	resetPiGlobals();
});

test("sanitized AlbertWork replay stops plan expansion without replaying the valid plan", async () => {
	const replay = JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", "albertwork-plan-failure.json"), "utf8"));
	const fp = fresh();
	const cwd = tmp();
	await begin(fp, cwd);
	await callTool(fp, "plan_write", {
		items: Array.from({ length: replay.initial_plan_items }, (_, i) => ({
			title: `Process meeting ${i + 1}`,
			note: "Read; extract; update",
		})),
	}, cwd);
	const before = readFileSync(stateFile(cwd), "utf8");
	await expectToolError(fp, "plan_write", {
		items: Array.from({ length: replay.expanded_plan_items }, (_, i) => ({ title: `Micro-step ${i + 1}` })),
	}, cwd, /provide 1-24 top-level items/);
	assert.equal(readFileSync(stateFile(cwd), "utf8"), before);
	const state = JSON.parse(before);
	await callTool(fp, "plan_update", { deltas: [{ item_id: state.items[0].id, status: "in_progress" }] }, cwd);
	assert.equal(JSON.parse(readFileSync(stateFile(cwd), "utf8")).items.length, replay.initial_plan_items);
	resetPiGlobals();
});

test("structural replan retains IDs and cannot silently omit unresolved work", async () => {
	const fp = fresh();
	const cwd = tmp();
	const ctxGo = await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "One" }, { title: "Two" }] }, cwd);
	let state = JSON.parse(readFileSync(stateFile(cwd), "utf8"));
	const [one, two] = state.items;
	// The omission protection begins at /plan-go (review-phase drops are legitimate
	// revision — audit A4, 2026-08-25).
	await fp.commands.get("plan-go").handler("", ctxGo);
	await expectToolError(fp, "plan_write", { items: [{ item_id: one.id, title: "One renamed" }] }, cwd, new RegExp(two.id));
	await callTool(fp, "plan_write", { items: [
		{ item_id: one.id, title: "One renamed" }, { item_id: two.id, title: "Two" }, { title: "Three" },
	] }, cwd);
	state = JSON.parse(readFileSync(stateFile(cwd), "utf8"));
	assert.equal(state.items[0].id, one.id);
	assert.equal(state.items[0].title, "One renamed");
	assert.equal(state.items[2].status, "pending");
	resetPiGlobals();
});

test("plan_update owns small status/note deltas and enforces one in_progress", async () => {
	const fp = fresh();
	const cwd = tmp();
	await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "One" }, { title: "Two" }] }, cwd);
	let state = JSON.parse(readFileSync(stateFile(cwd), "utf8"));
	const [one, two] = state.items;
	await callTool(fp, "plan_update", { deltas: [{ item_id: one.id, status: "in_progress", note: "Inspect current state" }] }, cwd);
	await expectToolError(fp, "plan_update", { deltas: [{ item_id: two.id, status: "in_progress" }] }, cwd, /at most one item/);
	await expectToolError(fp, "plan_update", { deltas: [{ item_id: one.id, status: "blocked" }] }, cwd, /blocked status requires a note/);
	await callTool(fp, "plan_update", { deltas: [{ item_id: one.id, status: "done" }, { item_id: two.id, status: "in_progress" }] }, cwd);
	state = JSON.parse(readFileSync(stateFile(cwd), "utf8"));
	assert.equal(state.items[0].status, "done");
	assert.equal(state.items[1].status, "in_progress");
	resetPiGlobals();
});

test("/plan-go restores execution tools and /plan-cancel restores without execution", async () => {
	const fp = fresh();
	const cwd = tmp();
	const ctx = await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "One" }] }, cwd);
	await fp.commands.get("plan-go").handler("", ctx);
	assert.ok(fp.pi.getActiveTools().includes("bash"));
	assert.ok(fp.pi.getActiveTools().includes("plan_update"));
	assert.match(fp.sent.at(-1) ?? "", /Use plan_update/);

	const fp2 = fresh();
	const cwd2 = tmp();
	const ctx2 = await begin(fp2, cwd2);
	await fp2.commands.get("plan-cancel").handler("", ctx2);
	assert.ok(fp2.pi.getActiveTools().includes("bash"));
	assert.equal(fp2.pi.getActiveTools().includes("plan_update"), true);
	resetPiGlobals();
});

test("manifest load order: capability(planning) activates plan tools stripped by plan-runner", async () => {
	// Audit A2 (2026-08-25): plan-runner (manifest index 6) strips plan_write/
	// plan_update at session_start BEFORE tool-activation (index 22) computes its
	// deferred pool, so the planning family was unreachable at shipped defaults.
	// This test loads BOTH extensions in manifest order on one fake pi — the class
	// the isolated-load tests structurally miss.
	const fp = makeFakePi();
	for (const name of ["read", "bash", "edit", "write", "search_spans", "read_span", "recall", "subagent", "compact_context"]) {
		fp.pi.registerTool({ name, parameters: {} } as any);
	}
	planRunner(fp.pi as any);
	const ta = await import(`../extensions/tool-activation.ts?mixed-order=${Date.now()}-${Math.random()}`);
	ta.default(fp.pi as any);
	fp.pi.setActiveTools([...fp.tools.keys()]);
	captureInitialToolSurface(fp.pi as any);
	const cwd = tmp();
	await fire(fp, "session_start", {}, { ...makeCtx(cwd).ctx, cwd });
	assert.equal(fp.pi.getActiveTools().includes("plan_write"), false, "stripped at startup as designed");
	const result = await callTool(fp, "capability", { action: "enable", family: "planning" }, cwd);
	assert.equal(result.isError, false);
	assert.ok(fp.pi.getActiveTools().includes("plan_write"), "the planning family must reach the stripped tools");
	assert.ok(fp.pi.getActiveTools().includes("plan_update"));
	resetPiGlobals();
});

test("a restart during /plan restores the execution surface from the baseline", async () => {
	// Audit A6 (2026-08-25): the planning surface's restore bookkeeping is
	// in-memory; a reload during /plan left the session read-only forever.
	const fp = fresh();
	const cwd = tmp();
	captureInitialToolSurface(fp.pi as any);
	const ctx = await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "Half-done" }] }, cwd);
	assert.equal(fp.pi.getActiveTools().includes("bash"), false, "planning removed execution tools");
	await fire(fp, "session_start", {}, { ...makeCtx(cwd).ctx, cwd });
	await fp.commands.get("plan-go").handler("", makeCtx(cwd).ctx);
	const active = fp.pi.getActiveTools();
	assert.ok(active.includes("bash"), "execution spine restored from the baseline");
	assert.ok(active.includes("edit"));
	assert.ok(active.includes("plan_update"));
	assert.equal(active.includes("browser_open"), false, "deferred specialists stay deferred under core profile");
	void ctx;
	resetPiGlobals();
});

test("note bytes: 900 accepted, 901 rejected, and a full 24-item plan fits the state cap", async () => {
	const fp = fresh();
	const cwd = tmp();
	const ctx = await begin(fp, cwd);
	const note900 = "n".repeat(900);
	const full = await callTool(fp, "plan_write", {
		summary: "s".repeat(300),
		items: Array.from({ length: 24 }, (_, i) => ({ title: `Item ${i + 1} ${"t".repeat(100)}`.slice(0, 120), note: note900 })),
	}, cwd);
	assert.equal(full.isError, false, "24 items x 900-byte notes must fit (state cap raised with the note cap)");
	await expectToolError(fp, "plan_write", {
		items: [{ title: "One", note: "n".repeat(901) }],
	}, cwd, /note exceeds 900/);
	await fp.commands.get("plan-cancel").handler("", ctx);
	resetPiGlobals();
});

test("headless plan_write works when the tool is active outside /plan", async () => {
	// capability(enable, planning) is the sanctioned model route (skills structure
	// multi-item work); the old unconditional reject named /plan, which the model
	// cannot type (audit A3, 2026-08-25).
	const fp = fresh();
	const cwd = tmp();
	await fire(fp, "session_start", {}, { ...makeCtx(cwd).ctx, cwd });
	const result = await callTool(fp, "plan_write", { items: [{ title: "Meeting one" }, { title: "Meeting two" }] }, cwd);
	assert.equal(result.isError, false, "an active plan_write must work headlessly");
	assert.match(result.content[0].text, /Meeting one/);
	resetPiGlobals();
});

test("review-phase rewrites may drop items; executing-phase rewrites may not", async () => {
	// The omission trap (audit A4): during /plan review the rejection named
	// plan_update, which planning mode blocks. Dropping items pre-go is revision.
	const fp = fresh();
	const cwd = tmp();
	const ctx = await begin(fp, cwd);
	const first = await callTool(fp, "plan_write", { items: [{ title: "Keep" }, { title: "Drop" }] }, cwd);
	const keepId = first.content[0].text.match(/([A-Za-z0-9._:-]{16}) Keep/)?.[1];
	assert.ok(keepId, "listing carries ids");
	const revised = await callTool(fp, "plan_write", { items: [{ item_id: keepId, title: "Keep" }] }, cwd);
	assert.equal(revised.isError, false, "dropping an item during review is legitimate revision");
	await fp.commands.get("plan-go").handler("", ctx);
	await expectToolError(fp, "plan_write", { items: [{ title: "Only new" }] }, cwd,
		/unresolved item_id/);
	resetPiGlobals();
});

test("/plan-go after a restart re-activates plan tools despite lost surface bookkeeping", async () => {
	// Observed live 2026-08-25: a plan interrupted mid-flight, then a pi restart —
	// session_start rebinds the plan but strips plan tools, and the in-memory
	// planning-surface bookkeeping is gone, so the old /plan-go restore was a
	// no-op. Execution then steered the model to call plan_update while it was
	// hidden ("plan-write not available" loop).
	const fp = fresh();
	const cwd = tmp();
	const ctx = await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "Half-done work" }] }, cwd);
	// Simulated restart: a fresh session_start resets in-memory planning state.
	await fire(fp, "session_start", {}, { ...makeCtx(cwd).ctx, cwd });
	assert.equal(fp.pi.getActiveTools().includes("plan_write"), false, "session start hides plan tools");
	await fp.commands.get("plan-go").handler("", makeCtx(cwd).ctx);
	assert.ok(fp.pi.getActiveTools().includes("plan_update"), "resume must restore plan_update");
	assert.ok(fp.pi.getActiveTools().includes("plan_write"), "resume must restore plan_write");
	assert.match(fp.sent.at(-1) ?? "", /Use plan_update/);
	resetPiGlobals();
});

test("/plan-go restores execution tools while retaining research activated during planning", async () => {
	const fp = fresh();
	const cwd = tmp();
	const ctx = await begin(fp, cwd);
	fp.pi.setActiveTools([...fp.pi.getActiveTools(), "web_search", "web_read"]);
	await callTool(fp, "plan_write", { items: [{ title: "One" }] }, cwd);
	await fp.commands.get("plan-go").handler("", ctx);
	assert.ok(fp.pi.getActiveTools().includes("bash"));
	assert.ok(fp.pi.getActiveTools().includes("web_search"));
	assert.ok(fp.pi.getActiveTools().includes("web_read"));
	resetPiGlobals();
});

test("blocked planning call publishes one call-bound prevented signal", async () => {
	const fp = fresh();
	const cwd = tmp();
	const signals: any[] = [];
	fp.pi.events.on(HARNESS_SIGNAL_CHANNEL, (signal: unknown) => signals.push(signal));
	await begin(fp, cwd);
	await fire(fp, "tool_call", { toolCallId: "deny-1", toolName: "bash", input: { command: "touch x" } });
	assert.deepEqual(signals.filter((signal) => signal.type === "tool/prevented"), [
		{ v: 1, type: "tool/prevented", toolCallId: "deny-1", failureClass: "policy_rejection" },
	]);
	resetPiGlobals();
});

test("PLAN_STORAGE=project rollback still writes the historical project-local files", async () => {
	// The suite above now runs in the shipped capsule default. This is the ONE case
	// that covers the documented rollback — README describes `project` as restoring
	// `.pi/plan-state.json`, so something has to assert that it still does. Keeping it
	// as a single explicit case, rather than as a module-scope env pin, is the whole
	// point: a default that is only ever tested through its rollback is untested.
	const previous = process.env.PLAN_STORAGE;
	process.env.PLAN_STORAGE = "project";
	try {
		const fp = fresh();
		const cwd = mkdtempSync(join(tmpdir(), "pi-plan-project-"));
		// No capsule identity minted for this cwd: project mode must not need one.
		delete (globalThis as Record<string, unknown>).__pi_run_capsule_identity;
		await begin(fp, cwd);
		await callTool(fp, "plan_write", {
			summary: "Rollback storage check.",
			items: [{ title: "First item" }, { title: "Second item" }],
		}, cwd);
		const projectPath = join(cwd, ".pi", "plan-state.json");
		const state = JSON.parse(readFileSync(projectPath, "utf8"));
		assert.equal(state.items.length, 2, "the rollback writes the historical project-local path");
		assert.equal(privatePlanStatePath(cwd), null, "project mode resolves no capsule path at all");
	} finally {
		if (previous === undefined) delete process.env.PLAN_STORAGE; else process.env.PLAN_STORAGE = previous;
		resetPiGlobals();
	}
});
