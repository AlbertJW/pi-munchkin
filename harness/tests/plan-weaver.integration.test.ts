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
		{ id: "s1", title: "edit", mode: "execute", deliverable: "d", gate: "true" },
	] }, cwd);
	assert.ok(!good.isError);
	assert.ok(good.content[0].text.includes("Plan compiled"));
	assert.ok(existsSync(join(cwd, ".pi", "weave-state.json")));
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
