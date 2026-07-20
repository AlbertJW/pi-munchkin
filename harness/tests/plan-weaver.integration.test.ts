// plan-weaver INTEGRATION tests — real shell, real child processes (a stub `pi` on
// PATH), real gates. Pins the adapter behavior pure tests can't see: the dispatch
// loop, the failure ladder, engine-side gate authority (a LYING child must not pass),
// and the single distilled handoff.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeFakePi, makeCtx, callTool, type FakePi } from "./integration-harness.ts";

let stubDir: string;
let savedPath: string;

before(() => {
	// Stub `pi`: logs every invocation, then behaves per keywords in the brief (last arg).
	//  - "make-out"  -> creates out.txt (so a `test -f out.txt` gate goes green) + RESULT: done
	//  - "lie"       -> RESULT: done but does NOTHING (the gate must catch it)
	//  - "no-result" -> prose without a RESULT line (must be treated as blocked)
	//  - default     -> RESULT: done
	stubDir = mkdtempSync(join(tmpdir(), "weave-stub-"));
	writeFileSync(join(stubDir, "pi"), `#!/bin/bash
brief="\${@: -1}"
echo "CALL \$brief" | head -c 300 >> stub-calls.log; echo >> stub-calls.log
if [[ "\$brief" == *make-out* ]]; then touch out.txt; echo "RESULT: done — created out.txt"; echo "CHANGED: out.txt"; exit 0; fi
if [[ "\$brief" == *lie* ]]; then echo "RESULT: done — definitely finished (nothing was done)"; exit 0; fi
if [[ "\$brief" == *no-result* ]]; then echo "I feel great about this work."; exit 0; fi
if [[ "\$brief" == *exit-fail* ]]; then echo "RESULT: done — lying before exit"; exit 7; fi
if [[ "\$brief" == *hang-child* ]]; then sleep 3; echo "RESULT: done — too late"; exit 0; fi
echo "RESULT: done — ok"
`);
	chmodSync(join(stubDir, "pi"), 0o755);
	savedPath = process.env.PATH ?? "";
	process.env.PATH = `${stubDir}:${savedPath}`;
	process.env.WEAVE_CHILD_TIMEOUT_S = "20";
	// keep test telemetry out of the real events.jsonl (and leave TELEMETRY on —
	// forcing it off globally breaks telemetry.test.ts in a full-suite run)
	process.env.TELEMETRY_FILE = join(stubDir, "events.jsonl");
});

after(() => {
	process.env.PATH = savedPath;
	rmSync(stubDir, { recursive: true, force: true });
});

async function freshWeaver(): Promise<{ fp: FakePi; cwd: string }> {
	const cwd = mkdtempSync(join(tmpdir(), "weave-wd-"));
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	const fp = makeFakePi();
	// fresh module instance per test so module-level plan state doesn't leak
	const mod = await import(`../extensions/plan-weaver.ts?t=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi);
	return { fp, cwd };
}

async function compile(fp: FakePi, cwd: string, items: unknown) {
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave").handler("do the thing", ctx);
	return callTool(fp, "weave_compile", { items }, cwd);
}

test("compile rejects ungated execute; accepts after fix (one mechanical retry)", async () => {
	const { fp, cwd } = await freshWeaver();
	const bad = await compile(fp, cwd, [{ id: "s1", title: "edit", mode: "execute", deliverable: "d" }]);
	assert.ok(bad.isError);
	assert.ok(bad.content[0].text.includes("Worked example"));
	const good = await callTool(fp, "weave_compile", { items: [
		{ id: "s1", title: "edit", mode: "execute", deliverable: "d", gate: "test -d ." },
	] }, cwd);
	assert.ok(!good.isError);
	assert.ok(good.content[0].text.includes("Plan compiled"));
	assert.ok(existsSync(join(cwd, ".pi", "weave-state.json")));
	rmSync(cwd, { recursive: true, force: true });
});

test("a fresh /weave on a new request resets the compile-attempt counter", async () => {
	const { fp, cwd } = await freshWeaver();
	const { ctx } = makeCtx(cwd);
	const bad = { items: [{ id: "s1", title: "edit", mode: "execute", deliverable: "d" }] }; // no gate -> rejected

	// request A: two rejected attempts, not yet at the cap
	await fp.commands.get("weave").handler("request A", ctx);
	const a1 = await callTool(fp, "weave_compile", bad, cwd);
	assert.ok(a1.isError);
	const a2 = await callTool(fp, "weave_compile", bad, cwd);
	assert.ok(a2.isError);
	assert.ok(!a2.content[0].text.includes("giving up"), "not yet at the cap after two attempts on A");

	// request B: a genuinely new /weave must reset the counter, not inherit A's count
	await fp.commands.get("weave").handler("request B", ctx);
	assert.equal((globalThis as Record<string, unknown>).__pi_plan_phase_active, true, "still armed for the new request");
	const b1 = await callTool(fp, "weave_compile", bad, cwd);
	assert.ok(!b1.content[0].text.includes("giving up"), "first rejection on B must not inherit A's near-cap count");
	const b2 = await callTool(fp, "weave_compile", bad, cwd);
	assert.ok(!b2.content[0].text.includes("giving up"), "second rejection on B still under B's own cap");
	const b3 = await callTool(fp, "weave_compile", bad, cwd);
	assert.ok(b3.content[0].text.includes("giving up"), "third rejection on B hits B's own fresh cap");
	rmSync(cwd, { recursive: true, force: true });
});

test("happy path: DAG dispatch, engine-run gate green, one distilled handoff", async () => {
	const { fp, cwd } = await freshWeaver();
	const r = await compile(fp, cwd, [
		{ id: "s1", title: "look around", mode: "explore", deliverable: "notes" },
		{ id: "s2", title: "make-out file", mode: "execute", inputs: [], deliverable: "out.txt exists", gate: "test -f out.txt", depends_on: ["s1"] },
	]);
	assert.ok(!r.isError);
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave-go").handler("", ctx);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items[0].status, "done");
	assert.equal(state.items[1].status, "done");
	assert.equal(state.phase, "done");
	// exactly ONE handoff message beyond the plan prompt; it carries the dispatch log
	const handoff = fp.sent[fp.sent.length - 1];
	assert.ok(handoff.includes("s2 done (gate green)"));
	// children really ran (stub logged into the workdir)
	assert.ok(readFileSync(join(cwd, "stub-calls.log"), "utf8").split("\n").filter(Boolean).length >= 2);
	rmSync(cwd, { recursive: true, force: true });
});

test("a LYING child does not pass: engine gate red -> full ladder -> blocked", async () => {
	const { fp, cwd } = await freshWeaver();
	await compile(fp, cwd, [
		{ id: "s1", title: "lie about the work", mode: "execute", deliverable: "d", gate: "test -f never-created.txt" },
	]);
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave-go").handler("", ctx);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items[0].status, "blocked");
	assert.equal(state.items[0].ladder_rung, 3);
	assert.equal(state.items[0].gate_fails, 3);
	// ladder ran all three children: initial + locality retry + fresh child
	const calls = readFileSync(join(cwd, "stub-calls.log"), "utf8").split("\n").filter((l) => l.startsWith("CALL"));
	assert.equal(calls.length, 3);
	// locality retry brief embedded the protocol
	assert.ok(calls[1].includes("LOCALIZE") || readFileSync(join(cwd, "stub-calls.log"), "utf8").includes("LOCALIZE"));
	// handoff asks for a bounded fix, not a plan rewrite
	const handoff = fp.sent[fp.sent.length - 1];
	assert.ok(handoff.includes("BLOCKED"));
	assert.ok(handoff.includes("ONE bounded fix"));
	rmSync(cwd, { recursive: true, force: true });
});

test("gateless child with no RESULT line is blocked (never trust silence)", async () => {
	const { fp, cwd } = await freshWeaver();
	await compile(fp, cwd, [
		{ id: "s1", title: "no-result rambling", mode: "explore", deliverable: "notes" },
	]);
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave-go").handler("", ctx);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items[0].status, "blocked");
	rmSync(cwd, { recursive: true, force: true });
});

test("nonzero child cannot pass a green gate from stale workspace state", async () => {
	const { fp, cwd } = await freshWeaver();
	writeFileSync(join(cwd, "already.txt"), "stale");
	await compile(fp, cwd, [{ id: "s1", title: "exit-fail child", mode: "execute", deliverable: "d", gate: "test -f already.txt" }]);
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave-go").handler("", ctx);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items[0].status, "blocked");
	assert.equal(state.items[0].gate_fails, 3);
	rmSync(cwd, { recursive: true, force: true });
});

test("timed-out child is failed and terminated instead of accepted", async () => {
	process.env.WEAVE_CHILD_TIMEOUT_S = "1";
	try {
		const { fp, cwd } = await freshWeaver();
		writeFileSync(join(cwd, "already.txt"), "stale");
		await compile(fp, cwd, [{ id: "s1", title: "hang-child", mode: "execute", deliverable: "d", gate: "test -f already.txt" }]);
		const { ctx } = makeCtx(cwd);
		await fp.commands.get("weave-go").handler("", ctx);
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
		assert.equal(state.items[0].status, "blocked");
		assert.match(state.items[0].note, /timed out|child failed/i);
		rmSync(cwd, { recursive: true, force: true });
	} finally { process.env.WEAVE_CHILD_TIMEOUT_S = "20"; }
});

test("inline items skip dispatch and land in the handoff for the main loop", async () => {
	const { fp, cwd } = await freshWeaver();
	await compile(fp, cwd, [
		{ id: "s1", title: "judgment call", mode: "inline" },
		{ id: "s2", title: "make-out file", mode: "execute", deliverable: "d", gate: "test -f out.txt" },
	]);
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave-go").handler("", ctx);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items.find((i: { id: string }) => i.id === "s1").status, "pending"); // model's now
	assert.equal(state.items.find((i: { id: string }) => i.id === "s2").status, "done");
	const handoff = fp.sent[fp.sent.length - 1];
	assert.ok(handoff.includes("Inline items for you"));
	assert.ok(handoff.includes("judgment call"));
	rmSync(cwd, { recursive: true, force: true });
});

test("an item depending on an inline item is surfaced as blocked, not silently stranded", async () => {
	const { fp, cwd } = await freshWeaver();
	await compile(fp, cwd, [
		{ id: "s1", title: "judgment call", mode: "inline" },
		{ id: "s2", title: "make-out file", mode: "execute", deliverable: "d", gate: "test -f out.txt", depends_on: ["s1"] },
	]);
	const { ctx } = makeCtx(cwd);
	await fp.commands.get("weave-go").handler("", ctx);
	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items.find((i: { id: string }) => i.id === "s1").status, "pending"); // model's now
	const s2 = state.items.find((i: { id: string }) => i.id === "s2");
	assert.equal(s2.status, "blocked");
	assert.match(s2.note, /stranded/);
	const handoff = fp.sent[fp.sent.length - 1];
	assert.ok(handoff.includes("s2"), "s2 is surfaced in the handoff, not silently dropped");
	rmSync(cwd, { recursive: true, force: true });
});

test("an aborted dispatch pauses resumably instead of marking untouched items permanently blocked", async () => {
	const { fp, cwd } = await freshWeaver();
	await compile(fp, cwd, [
		{ id: "s1", title: "make-out file", mode: "execute", deliverable: "d", gate: "test -f out.txt" },
	]);
	const { ctx } = makeCtx(cwd);
	const controller = new AbortController();
	controller.abort();
	const sentBefore = fp.sent.length;
	await fp.commands.get("weave-go").handler("", { ...ctx, signal: controller.signal });

	const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(state.items[0].status, "pending", "untouched item stays pending, not blocked");
	assert.equal(state.phase, "paused");
	assert.equal(fp.sent.length, sentBefore, "a cancellation must not send a follow-up handoff message");
	// no child ever ran — the abort was observed before dispatching anything
	assert.equal(existsSync(join(cwd, "stub-calls.log")), false);

	// a later, non-aborted /weave-go resumes cleanly from the paused state
	await fp.commands.get("weave-go").handler("", ctx);
	const resumed = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
	assert.equal(resumed.items[0].status, "done");
	assert.equal(resumed.phase, "done");
	rmSync(cwd, { recursive: true, force: true });
});

test("a plan resumed from disk (not freshly compiled) tells the first dispatch partial work may exist", async () => {
	const { fp, cwd } = await freshWeaver();
	await compile(fp, cwd, [
		{ id: "s1", title: "make-out file", mode: "execute", deliverable: "d", gate: "test -f out.txt" },
	]);
	// Fresh module instance so in-memory `plan` is null — /weave-go must fall back
	// to loadExisting, exercising the resumed-from-disk path.
	const fp2 = makeFakePi();
	const mod2 = await import(`../extensions/plan-weaver.ts?resume=${Date.now()}-${Math.random()}`);
	mod2.default(fp2.pi);
	const { ctx } = makeCtx(cwd);
	await fp2.commands.get("weave-go").handler("", ctx);
	const calls = readFileSync(join(cwd, "stub-calls.log"), "utf8");
	assert.match(calls, /resumed from a previous session/);
	rmSync(cwd, { recursive: true, force: true });
});

function priorGatePlan() {
	return {
		schema_version: 1, request: "(gate task — see the task message above)",
		created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
		phase: "dispatching",
		items: [{ id: "s1", title: "make-out file", mode: "execute", deliverable: "d",
			gate: "test -f out.txt", inputs: [], depends_on: [], status: "pending", ladder_rung: 0, gate_fails: 0 }],
	};
}

test("GATE MODE resumes an interrupted (non-done) plan only when WEAVE_GATE_RESUME=1", async () => {
	process.env.PLAN_MODE = "v4";
	process.env.WEAVE_GATE_RESUME = "1";
	try {
		const cwd = mkdtempSync(join(tmpdir(), "weave-gate-resume-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		// Pre-seed weave-state.json as if a prior GATE_MODE run compiled a plan and
		// then crashed before finishing dispatch (item left "pending" on disk).
		writeFileSync(join(cwd, ".pi", "weave-state.json"), JSON.stringify(priorGatePlan(), null, 2));
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-weaver.ts?gr=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi);
		for (const fn of fp.handlers.get("agent_start") ?? []) await fn({}, { cwd });
		assert.ok(!fp.sent.some((s) => s.includes("MODE: PLAN")), "resumed instead of re-planning from scratch");
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
		assert.equal(state.items[0].status, "done");
		assert.equal(state.phase, "done");
		const calls = readFileSync(join(cwd, "stub-calls.log"), "utf8");
		assert.match(calls, /resumed from a previous session/);
		rmSync(cwd, { recursive: true, force: true });
	} finally {
		delete process.env.PLAN_MODE;
		delete process.env.WEAVE_GATE_RESUME;
	}
});

test("GATE MODE: without WEAVE_GATE_RESUME, a stale plan is ignored and a fresh plan starts (safe default)", async () => {
	process.env.PLAN_MODE = "v4";
	try {
		const cwd = mkdtempSync(join(tmpdir(), "weave-gate-noresume-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		writeFileSync(join(cwd, ".pi", "weave-state.json"), JSON.stringify(priorGatePlan(), null, 2));
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-weaver.ts?gnr=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi);
		for (const fn of fp.handlers.get("agent_start") ?? []) await fn({}, { cwd });
		assert.ok(fp.sent.some((s) => s.includes("MODE: PLAN")), "starts fresh planning, does not silently resume");
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
		assert.equal(state.items.length, 0, "the stale plan's item was never touched or dispatched");
		assert.equal(state.phase, "compiled");
		assert.equal(existsSync(join(cwd, "stub-calls.log")), false, "no child ever ran against the stale plan");
		rmSync(cwd, { recursive: true, force: true });
	} finally {
		delete process.env.PLAN_MODE;
	}
});

test("GATE MODE: repeated compile rejection disarms the plan-phase flag after the cap", async () => {
	process.env.PLAN_MODE = "v4";
	try {
		const cwd = mkdtempSync(join(tmpdir(), "weave-gate-cap-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-weaver.ts?gc=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi);
		for (const fn of fp.handlers.get("agent_start") ?? []) await fn({}, { cwd });
		// ungated execute item — compilePlan rejects this every time.
		const badItems = { items: [{ id: "s1", title: "edit", mode: "execute", deliverable: "d" }] };
		let last: Awaited<ReturnType<typeof callTool>> | undefined;
		for (let i = 0; i < 3; i++) {
			last = await callTool(fp, "weave_compile", badItems, cwd);
			assert.ok(last.isError);
		}
		assert.ok(last!.content[0].text.includes("giving up"), last!.content[0].text.slice(0, 200));
		assert.equal((globalThis as Record<string, unknown>).__pi_plan_phase_active, false,
			"disarmed after repeated compile rejection — edits are no longer blocked");
		rmSync(cwd, { recursive: true, force: true });
	} finally {
		delete process.env.PLAN_MODE;
	}
});

test("GATE MODE (PLAN_MODE=v4): auto-engage at agent_start, auto-dispatch on compile", async () => {
	process.env.PLAN_MODE = "v4";
	try {
		const cwd = mkdtempSync(join(tmpdir(), "weave-gate-"));
		mkdirSync(join(cwd, ".pi"), { recursive: true });
		const fp = makeFakePi();
		const mod = await import(`../extensions/plan-weaver.ts?g=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi);
		// agent_start injects the planning prompt (once)
		for (const fn of fp.handlers.get("agent_start") ?? []) await fn({}, { cwd });
		for (const fn of fp.handlers.get("agent_start") ?? []) await fn({}, { cwd });
		assert.equal(fp.sent.filter((s) => s.includes("MODE: PLAN")).length, 1, "engages exactly once");
		assert.equal((globalThis as Record<string, unknown>).__pi_plan_phase_active, true,
			"gate-mode planning arms the shared plan-phase flag (mutation block)");
		assert.ok(fp.sent[0].includes("TASK ABOVE"));
		// compile triggers dispatch inline; handoff arrives IN the tool result
		const r = await callTool(fp, "weave_compile", { items: [
			{ id: "s1", title: "make-out file", mode: "execute", deliverable: "d", gate: "test -f out.txt" },
		] }, cwd);
		assert.ok(!r.isError);
		assert.ok(r.content[0].text.includes("s1 done (gate green)"), r.content[0].text.slice(0, 200));
		assert.ok(r.content[0].text.includes("self-contained report"), "done-branch handoff in tool result");
		assert.equal((globalThis as Record<string, unknown>).__pi_plan_phase_active, false,
			"compile disarms the plan-phase flag before dispatch");
		const state = JSON.parse(readFileSync(join(cwd, ".pi", "weave-state.json"), "utf8"));
		assert.equal(state.phase, "done");
		rmSync(cwd, { recursive: true, force: true });
	} finally {
		delete process.env.PLAN_MODE;
	}
});
