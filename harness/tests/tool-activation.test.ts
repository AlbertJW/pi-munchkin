import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { emitHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { captureInitialToolSurface } from "../lib/session-bootstrap.ts";
import { callTool, fire, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

const names = [
	"read", "bash", "edit", "write", "grep", "find", "ls", "search_spans", "read_span", "recall",
	"plan_write", "plan_update", "verify_project", "subagent", "compact_context", "web_search", "web_read",
	"browser_open", "browser_click", "tldraw_create",
];

async function load(profile: "ambient" | "core" | undefined, activeInitial: string[] = names.filter((name) => !["grep", "find", "ls"].includes(name)), argv = process.argv) {
	const oldProfile = process.env.MUNCHKIN_TOOL_PROFILE;
	const oldActivation = process.env.MUNCHKIN_TOOL_ACTIVATION;
	const oldTelemetry = process.env.TELEMETRY;
	const oldAgent = process.env.PI_CODING_AGENT_DIR;
	const oldArgv = process.argv;
	if (profile === undefined) delete process.env.MUNCHKIN_TOOL_PROFILE;
	else process.env.MUNCHKIN_TOOL_PROFILE = profile;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "dynamic";
	process.env.TELEMETRY = "off";
	process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-tools-agent-"));
	process.argv = [...argv];
	const fp = makeFakePi();
	for (const name of names) fp.pi.registerTool({ name, parameters: { type: "object" } } as any);
	const mod = await import(`../extensions/tool-activation.ts?case=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as any);
	const initial = [...new Set([...activeInitial, "capability"])];
	fp.pi.setActiveTools(initial);
	captureInitialToolSurface(fp.pi as any);
	await fire(fp, "session_start", {}, { cwd: mkdtempSync(join(tmpdir(), "pi-tools-cwd-")) });
	return {
		fp,
		restore() {
			if (oldProfile === undefined) delete process.env.MUNCHKIN_TOOL_PROFILE; else process.env.MUNCHKIN_TOOL_PROFILE = oldProfile;
			if (oldActivation === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = oldActivation;
			if (oldTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = oldTelemetry;
			if (oldAgent === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = oldAgent;
			process.argv = oldArgv;
			resetPiGlobals();
		},
	};
}

test("unset tool profile adopts the bounded core surface", async () => {
	const run = await load(undefined, [...names]);
	try {
		const active = run.fp.pi.getActiveTools();
		for (const name of ["read", "bash", "edit", "write", "search_spans", "read_span", "recall", "verify_project", "capability"]) assert.ok(active.includes(name), name);
		for (const name of ["subagent", "compact_context", "web_search", "web_read", "browser_open", "tldraw_create"]) assert.equal(active.includes(name), false, name);
		assert.equal(active.length <= 11, true, active.join(","));
	} finally { run.restore(); }
});

test("Pi's ordinary optional builtin omissions are not an explicit allowlist", async () => {
	const run = await load("ambient");
	try {
		assert.equal((globalThis as any).__pi_tool_selection_explicit, false);
		assert.equal(run.fp.pi.getActiveTools().includes("subagent"), false);
		assert.equal(run.fp.pi.getActiveTools().includes("compact_context"), false);
	} finally { run.restore(); }
});

test("real CLI narrowing remains authoritative", async () => {
	const run = await load("core", ["read", "bash"], ["node", "pi", "--tools=read,bash"]);
	try {
		assert.equal((globalThis as any).__pi_tool_selection_explicit, true);
		assert.deepEqual(run.fp.pi.getActiveTools(), ["read", "bash", "capability"]);
	} finally { run.restore(); }
});

test("core profile removes specialists and preserves a small execution spine", async () => {
	const run = await load("core", [...names]);
	try {
		const active = run.fp.pi.getActiveTools();
		for (const name of ["read", "bash", "edit", "write", "search_spans", "read_span", "recall", "verify_project", "capability"]) assert.ok(active.includes(name), name);
		for (const name of ["subagent", "compact_context", "web_search", "web_read", "browser_open", "tldraw_create"]) assert.equal(active.includes(name), false, name);
		assert.equal(active.length <= 11, true, active.join(","));
	} finally { run.restore(); }
});

test("capability activation is additive and a later manual disable wins", async () => {
	const run = await load("core", [...names]);
	try {
		const before = run.fp.pi.getActiveTools();
		const result = await callTool(run.fp, "capability", { action: "enable", family: "browser" }, process.cwd());
		assert.equal(result.isError, false);
		assert.ok(run.fp.pi.getActiveTools().includes("browser_open"));
		assert.ok(before.every((name) => run.fp.pi.getActiveTools().includes(name)));
		run.fp.pi.setActiveTools(run.fp.pi.getActiveTools().filter((name) => !name.startsWith("browser_")));
		await callTool(run.fp, "capability", { action: "enable", family: "browser" }, process.cwd());
		assert.equal(run.fp.pi.getActiveTools().some((name) => name.startsWith("browser_")), false);
	} finally { run.restore(); }
});

test("planning restricts capability activation to research", async () => {
	const run = await load("core", [...names]);
	try {
		(globalThis as any).__pi_plan_phase_active = true;
		await callTool(run.fp, "capability", { action: "enable", family: "delegation" }, process.cwd());
		assert.equal(run.fp.pi.getActiveTools().includes("subagent"), false);
		await callTool(run.fp, "capability", { action: "enable", family: "research" }, process.cwd());
		assert.ok(run.fp.pi.getActiveTools().includes("web_read"));
	} finally { run.restore(); }
});

test("loop tier two activates delegation once and respects manual disable", async () => {
	const run = await load("ambient");
	try {
		emitHarnessSignal(run.fp.pi.events as any, { v: 1, type: "loop/tier", tier: 2, detector: "exact" });
		assert.ok(run.fp.pi.getActiveTools().includes("subagent"));
		run.fp.pi.setActiveTools(run.fp.pi.getActiveTools().filter((name) => name !== "subagent"));
		emitHarnessSignal(run.fp.pi.events as any, { v: 1, type: "plan/write", items: 3, openItems: 3, runIdHash: signalRunId("r") });
		emitHarnessSignal(run.fp.pi.events as any, { v: 1, type: "plan/go", runIdHash: signalRunId("r") });
		assert.equal(run.fp.pi.getActiveTools().includes("subagent"), false);
	} finally { run.restore(); }
});

test("context family activates at the first 60 percent crossing", async () => {
	const run = await load("ambient");
	try {
		await fire(run.fp, "context", { messages: [] }, { getContextUsage: () => ({ percent: 59 }) });
		assert.equal(run.fp.pi.getActiveTools().includes("compact_context"), false);
		await fire(run.fp, "context", { messages: [] }, { getContextUsage: () => ({ percent: 60 }) });
		assert.equal(run.fp.pi.getActiveTools().includes("compact_context"), true);
	} finally { run.restore(); }
});
