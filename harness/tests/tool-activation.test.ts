import assert from "node:assert/strict";
import test from "node:test";
import { emitHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { captureInitialToolSurface } from "../lib/session-bootstrap.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const allTools = ["read", "bash", "edit", "write", "plan_write", "subagent", "compact_context"];
const phaseTools = [...allTools, "plan_go", "search_spans", "read_span", "web_search", "web_read"];

async function dynamic(activeInitial = allTools) {
	const previous = process.env.MUNCHKIN_TOOL_ACTIVATION;
	const previousTelemetry = process.env.TELEMETRY;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "dynamic";
	process.env.TELEMETRY = "off";
	const fp = makeFakePi();
	let active = [...activeInitial];
	(fp.pi as any).getAllTools = () => allTools.map((name) => ({ name, description: "", sourceInfo: { source: "test", path: "test" } }));
	(fp.pi as any).getActiveTools = () => [...active];
	(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
	captureInitialToolSurface(fp.pi as never);
	const mod = await import(`../extensions/tool-activation.ts?dynamic=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	await fire(fp, "session_start", { reason: "new" }, {});
	return {
		fp,
		active: () => [...active],
		setActive: (names: string[]) => { active = [...names]; },
		restore: () => {
			if (previous === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previous;
			if (previousTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previousTelemetry;
		},
	};
}

async function phase(activeInitial = phaseTools) {
	const previous = process.env.MUNCHKIN_TOOL_ACTIVATION;
	const previousTelemetry = process.env.TELEMETRY;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "phase";
	process.env.TELEMETRY = "off";
	const fp = makeFakePi();
	let active = [...activeInitial];
	(fp.pi as any).getAllTools = () => phaseTools.map((name) => ({
		name, description: "", parameters: { type: "object", properties: { name } }, sourceInfo: { source: "test", path: "test" },
	}));
	(fp.pi as any).getActiveTools = () => [...active];
	(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
	captureInitialToolSurface(fp.pi as never);
	const mod = await import(`../extensions/tool-activation.ts?phase=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	await fire(fp, "session_start", { reason: "new" }, {});
	return {
		fp,
		active: () => [...active],
		setActive: (names: string[]) => { active = [...names]; },
		restore: () => {
			if (previous === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previous;
			if (previousTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previousTelemetry;
		},
	};
}

test("dynamic startup omits deferred schemas and preserves a narrowed --tools selection", async () => {
	const normal = await dynamic();
	try {
		assert.equal(normal.active().includes("subagent"), false);
		assert.equal(normal.active().includes("compact_context"), false);
	} finally { normal.restore(); }
	const explicit = await dynamic(["read", "bash"]);
	try { assert.deepEqual(explicit.active(), ["read", "bash"]); } finally { explicit.restore(); }
});

test("minimal surface is an opt-in reduced candidate and never auto-adds deferred tools", async () => {
	const priorMode = process.env.MUNCHKIN_TOOL_ACTIVATION;
	const priorSurface = process.env.MUNCHKIN_TOOL_SURFACE;
	const priorTelemetry = process.env.TELEMETRY;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "dynamic";
	process.env.MUNCHKIN_TOOL_SURFACE = "minimal";
	process.env.TELEMETRY = "off";
	try {
		const fp = makeFakePi();
		let active = [...allTools];
		(fp.pi as any).getAllTools = () => allTools.map((name) => ({ name, description: "" }));
		(fp.pi as any).getActiveTools = () => [...active];
		(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
		captureInitialToolSurface(fp.pi as never);
		const mod = await import(`../extensions/tool-activation.ts?minimal=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		assert.deepEqual(active, ["read", "bash", "edit", "write"]);
		assert.equal((globalThis as any).__pi_tool_activation_state.surface_mode, "minimal");
		emitHarnessSignal(fp.pi.events as never, { v: 1, type: "loop/tier", tier: 2, detector: "exact" });
		assert.deepEqual(active, ["read", "bash", "edit", "write"]);
	} finally {
		if (priorMode === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = priorMode;
		if (priorSurface === undefined) delete process.env.MUNCHKIN_TOOL_SURFACE; else process.env.MUNCHKIN_TOOL_SURFACE = priorSurface;
		if (priorTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = priorTelemetry;
	}
});

test("missing bootstrap baseline preserves the current surface instead of guessing", async () => {
	const previousMode = process.env.MUNCHKIN_TOOL_ACTIVATION;
	const previousTelemetry = process.env.TELEMETRY;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "dynamic";
	process.env.TELEMETRY = "off";
	try {
		captureInitialToolSurface({
			getActiveTools: () => { throw new Error("unavailable"); },
			getAllTools: () => [],
		} as never);
		const fp = makeFakePi();
		let active = [...allTools];
		(fp.pi as any).getAllTools = () => allTools.map((name) => ({ name }));
		(fp.pi as any).getActiveTools = () => [...active];
		(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
		const mod = await import(`../extensions/tool-activation.ts?missing-bootstrap=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		assert.deepEqual(active, allTools);
		assert.equal((globalThis as any).__pi_tool_activation_state.reason, "bootstrap-unavailable");
	} finally {
		if (previousMode === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previousMode;
		if (previousTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previousTelemetry;
	}
});

test("bootstrap baseline prevents plan_go's internal review hold from looking like --tools", async () => {
	const previousMode = process.env.MUNCHKIN_TOOL_ACTIVATION;
	const previousTelemetry = process.env.TELEMETRY;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "dynamic";
	process.env.TELEMETRY = "off";
	try {
		const tools = [...allTools, "plan_go"];
		const fp = makeFakePi();
		let active = [...tools];
		(fp.pi as any).getAllTools = () => tools.map((name) => ({ name }));
		(fp.pi as any).getActiveTools = () => [...active];
		(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
		captureInitialToolSurface(fp.pi as never);
		// Simulate plan-runner's earlier session_start handler applying its review hold.
		(fp.pi as any).on("session_start", async () => { active = active.filter((name) => name !== "plan_go"); });
		const mod = await import(`../extensions/tool-activation.ts?plan-hold=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, {});
		assert.equal(active.includes("plan_go"), false, "the safety hold remains in force");
		assert.equal(active.includes("subagent"), false, "dynamic deferral still occurs");
		assert.equal(active.includes("compact_context"), false, "dynamic deferral still occurs");
		assert.equal((globalThis as any).__pi_tool_activation_state.preserved_explicit, false);
	} finally {
		if (previousMode === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previousMode;
		if (previousTelemetry === undefined) delete process.env.TELEMETRY; else process.env.TELEMETRY = previousTelemetry;
	}
});

test("subagent activates additively for plan, gate, loop, and plateau recovery signals", async () => {
	for (const trigger of ["plan", "gate", "loop", "plateau"] as const) {
		const run = await dynamic();
		try {
			if (trigger === "plan") {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/write", items: 3, openItems: 2, runIdHash: signalRunId("r") });
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/go", runIdHash: signalRunId("r") });
			} else if (trigger === "gate") {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/gate", pass: false, fails: 2, runIdHash: signalRunId("r"), gateHash: null });
			} else if (trigger === "loop") {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "loop/tier", tier: 2, detector: "exact" });
			} else {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "capability/need", capability: "subagent", reason: "recovery" });
			}
			assert.ok(run.active().includes("subagent"), trigger);
			assert.ok(run.active().includes("read"), "activation is additive");
		} finally { run.restore(); }
	}
});

test("compact_context activates at the first 60% crossing and manual disable is respected", async () => {
	const run = await dynamic();
	try {
		await fire(run.fp, "context", { messages: [] }, { getContextUsage: () => ({ tokens: 59, contextWindow: 100, percent: 59 }) });
		assert.equal(run.active().includes("compact_context"), false);
		await fire(run.fp, "context", { messages: [] }, { getContextUsage: () => ({ tokens: 60, contextWindow: 100, percent: 60 }) });
		assert.equal(run.active().includes("compact_context"), true);
		run.setActive(run.active().filter((name) => name !== "compact_context"));
		await fire(run.fp, "context", { messages: [] }, { getContextUsage: () => ({ tokens: 80, contextWindow: 100, percent: 80 }) });
		assert.equal(run.active().includes("compact_context"), false);
	} finally { run.restore(); }
});

test("a later trigger does not undo a manual subagent disable", async () => {
	const run = await dynamic();
	try {
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/gate", pass: false, fails: 2, runIdHash: signalRunId("r"), gateHash: null });
		assert.ok(run.active().includes("subagent"));
		run.setActive(run.active().filter((name) => name !== "subagent"));
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "loop/tier", tier: 2, detector: "exact" });
		assert.equal(run.active().includes("subagent"), false);
	} finally { run.restore(); }
});

test("semantic tier two activates additively once and respects a later manual disable", async () => {
	const run = await dynamic();
	try {
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "loop/tier", tier: 2, detector: "semantic" });
		assert.ok(run.active().includes("subagent"));
		assert.ok(run.active().includes("read"), "activation remains additive");
		run.setActive(run.active().filter((name) => name !== "subagent"));
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "loop/tier", tier: 2, detector: "semantic" });
		assert.equal(run.active().includes("subagent"), false);
	} finally { run.restore(); }
});

test("ambient rollback mode leaves the tool surface untouched", async () => {
	const previous = process.env.MUNCHKIN_TOOL_ACTIVATION;
	process.env.MUNCHKIN_TOOL_ACTIVATION = "ambient";
	try {
		const fp = makeFakePi();
		let setCalls = 0;
		(fp.pi as any).setActiveTools = () => { setCalls += 1; };
		const mod = await import(`../extensions/tool-activation.ts?ambient=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0);
		assert.equal(setCalls, 0);
	} finally { if (previous === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previous; }
});

test("dynamic activation is the adopted default", async () => {
	const previous = process.env.MUNCHKIN_TOOL_ACTIVATION;
	delete process.env.MUNCHKIN_TOOL_ACTIVATION;
	try {
		const fp = makeFakePi();
		let active = [...allTools];
		(fp.pi as any).getAllTools = () => allTools.map((name) => ({ name, description: "", sourceInfo: { source: "test", path: "test" } }));
		(fp.pi as any).getActiveTools = () => [...active];
		(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
		captureInitialToolSurface(fp.pi as never);
		const mod = await import(`../extensions/tool-activation.ts?default=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", { reason: "new" }, {});
		assert.equal(active.includes("subagent"), false);
		assert.equal(active.includes("compact_context"), false);
	} finally { if (previous === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previous; }
});

test("phase mode defers optional capabilities and preserves the core surface", async () => {
	const run = await phase();
	try {
		for (const name of ["plan_go", "search_spans", "read_span", "subagent", "compact_context", "web_read"]) {
			assert.equal(run.active().includes(name), false, name);
		}
		assert.ok(run.active().includes("plan_write"));
		assert.ok(run.active().includes("web_search"));
	} finally { run.restore(); }
});

test("phase triggers are evidence-driven and additive", async () => {
	const run = await phase();
	try {
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/write", items: 2, openItems: 2, runIdHash: signalRunId("r") });
		assert.ok(run.active().includes("plan_go"));
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "capability/need", capability: "span_tools", reason: "inlet-refusal" });
		assert.ok(run.active().includes("search_spans"));
		assert.ok(run.active().includes("read_span"));
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "capability/need", capability: "web_read", reason: "selected-search-result" });
		assert.ok(run.active().includes("web_read"));
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/go", runIdHash: signalRunId("r") });
		assert.ok(run.active().includes("subagent"));
		await fire(run.fp, "context", { messages: [] }, { getContextUsage: () => ({ tokens: 60, contextWindow: 100, percent: 60 }) });
		assert.ok(run.active().includes("compact_context"));
		assert.ok(run.active().includes("read"), "all activations remain additive");
	} finally { run.restore(); }
});

test("phase explicit allowlists and manual disable remain authoritative", async () => {
	const explicit = await phase(["read", "web_search", "web_read"]);
	try {
		assert.deepEqual(explicit.active(), ["read", "web_search", "web_read"]);
		emitHarnessSignal(explicit.fp.pi.events as never, { v: 1, type: "capability/need", capability: "span_tools", reason: "large-file" });
		assert.deepEqual(explicit.active(), ["read", "web_search", "web_read"]);
	} finally { explicit.restore(); }
	const run = await phase();
	try {
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/write", items: 1, openItems: 1, runIdHash: signalRunId("r") });
		run.setActive(run.active().filter((name) => name !== "plan_go"));
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "capability/need", capability: "plan_go", reason: "accepted-plan" });
		assert.equal(run.active().includes("plan_go"), false);
	} finally { run.restore(); }
});

test("first-useful-mutation classifies the bash COMMAND, and the latch survives a read-only opener", async () => {
	// A tool-NAME set counted the opening `rg` of nearly every session as the
	// first mutation; because the flag latches once, the real `edit` that
	// followed emitted nothing, so the metric could not even be repaired by
	// filtering afterwards.
	const { mkdtempSync, readFileSync, rmSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const dir = mkdtempSync(join(tmpdir(), "ta-mut-"));
	const prior = { mode: process.env.MUNCHKIN_TOOL_ACTIVATION, tel: process.env.TELEMETRY, file: process.env.TELEMETRY_FILE, src: process.env.TELEMETRY_SOURCE };
	process.env.MUNCHKIN_TOOL_ACTIVATION = "dynamic";
	delete process.env.TELEMETRY;
	process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
	process.env.TELEMETRY_SOURCE = "test";
	try {
		const fp = makeFakePi();
		(fp.pi as any).getAllTools = () => allTools.map((name) => ({ name, description: "", sourceInfo: { source: "test", path: "test" } }));
		let active = [...allTools];
		(fp.pi as any).getActiveTools = () => [...active];
		(fp.pi as any).setActiveTools = (names: string[]) => { active = [...names]; };
		captureInitialToolSurface(fp.pi as never);
		const mod = await import(`../extensions/tool-activation.ts?mut=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {});
		const result = (toolName: string, input: unknown) =>
			fire(fp, "tool_result", { type: "tool_result", toolName, input, content: [], details: {}, isError: false });

		await result("bash", { command: "rg TODO src" });        // orientation: NOT a mutation
		await result("bash", { command: "ls -la" });
		await result("bash", { command: "git status" });
		const rows = () => readFileSync(process.env.TELEMETRY_FILE as string, "utf8").trim().split("\n")
			.filter(Boolean).map((line) => JSON.parse(line))
			.filter((row) => row.kind === "first-useful-mutation");
		assert.deepEqual(rows(), [], "read-only shell must not latch the first mutation");

		await result("edit", { path: "src/a.ts" });               // the REAL first mutation
		assert.equal(rows().length, 1);
		assert.equal(rows()[0].tool, "edit", "the recorded tool is the one that actually mutated");

		// Opposite polarity, on a fresh instance: a MUTATING bash command counts,
		// and an unknown command still counts (the classifier fails closed).
		for (const command of ["sed -i '' s/a/b/ src/a.ts", "./scripts/whatever.sh"]) {
			const fresh = makeFakePi();
			(fresh.pi as any).getAllTools = () => allTools.map((name) => ({ name, description: "", sourceInfo: { source: "test", path: "test" } }));
			(fresh.pi as any).getActiveTools = () => [...allTools];
			(fresh.pi as any).setActiveTools = () => {};
			captureInitialToolSurface(fresh.pi as never);
			const m2 = await import(`../extensions/tool-activation.ts?mut2=${Date.now()}-${Math.random()}`);
			m2.default(fresh.pi as never);
			await fire(fresh, "session_start", {});
			const before = rows().length;
			await fire(fresh, "tool_result", { type: "tool_result", toolName: "bash", input: { command }, content: [], details: {}, isError: false });
			assert.equal(rows().length, before + 1, `${command} must count as a mutation`);
		}
	} finally {
		rmSync(dir, { recursive: true, force: true });
		for (const [key, value] of [["MUNCHKIN_TOOL_ACTIVATION", prior.mode], ["TELEMETRY", prior.tel], ["TELEMETRY_FILE", prior.file], ["TELEMETRY_SOURCE", prior.src]] as const) {
			if (value === undefined) delete process.env[key]; else process.env[key] = value;
		}
	}
});
