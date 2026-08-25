import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTool, expectToolError, fire, makeCtx, makeFakePi, resetPiGlobals } from "./integration-harness.ts";
import { HARNESS_SIGNAL_CHANNEL } from "../lib/harness-signals.ts";

process.env.PLAN_STORAGE = "project";
const planRunner = (await import("../extensions/plan-runner.ts")).default;

const tmp = () => mkdtempSync(join(tmpdir(), "pi-plan-bounded-"));

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
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
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
	const before = readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8");
	await expectToolError(fp, "plan_write", {
		items: Array.from({ length: 58 }, (_, i) => ({ title: `Fragment ${i + 1}` })),
	}, cwd, /provide 1-24 top-level items/);
	assert.equal(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"), before);
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
	const before = readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8");
	await expectToolError(fp, "plan_write", {
		items: Array.from({ length: replay.expanded_plan_items }, (_, i) => ({ title: `Micro-step ${i + 1}` })),
	}, cwd, /provide 1-24 top-level items/);
	assert.equal(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"), before);
	const state = JSON.parse(before);
	await callTool(fp, "plan_update", { deltas: [{ item_id: state.items[0].id, status: "in_progress" }] }, cwd);
	assert.equal(JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8")).items.length, replay.initial_plan_items);
	resetPiGlobals();
});

test("structural replan retains IDs and cannot silently omit unresolved work", async () => {
	const fp = fresh();
	const cwd = tmp();
	await begin(fp, cwd);
	await callTool(fp, "plan_write", { items: [{ title: "One" }, { title: "Two" }] }, cwd);
	let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	const [one, two] = state.items;
	await expectToolError(fp, "plan_write", { items: [{ item_id: one.id, title: "One renamed" }] }, cwd, new RegExp(two.id));
	await callTool(fp, "plan_write", { items: [
		{ item_id: one.id, title: "One renamed" }, { item_id: two.id, title: "Two" }, { title: "Three" },
	] }, cwd);
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
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
	let state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
	const [one, two] = state.items;
	await callTool(fp, "plan_update", { deltas: [{ item_id: one.id, status: "in_progress", note: "Inspect current state" }] }, cwd);
	await expectToolError(fp, "plan_update", { deltas: [{ item_id: two.id, status: "in_progress" }] }, cwd, /at most one item/);
	await expectToolError(fp, "plan_update", { deltas: [{ item_id: one.id, status: "blocked" }] }, cwd, /blocked status requires a note/);
	await callTool(fp, "plan_update", { deltas: [{ item_id: one.id, status: "done" }, { item_id: two.id, status: "in_progress" }] }, cwd);
	state = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8"));
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
