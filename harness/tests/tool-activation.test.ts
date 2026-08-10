import assert from "node:assert/strict";
import test from "node:test";
import { emitHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const allTools = ["read", "bash", "edit", "write", "plan_write", "subagent", "compact_context"];

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

test("dynamic startup omits deferred schemas and preserves a narrowed --tools selection", async () => {
	const normal = await dynamic();
	try {
		assert.equal(normal.active().includes("subagent"), false);
		assert.equal(normal.active().includes("compact_context"), false);
	} finally { normal.restore(); }
	const explicit = await dynamic(["read", "bash"]);
	try { assert.deepEqual(explicit.active(), ["read", "bash"]); } finally { explicit.restore(); }
});

test("subagent activates additively for multi-item execution, second gate failure, and loop tier two", async () => {
	for (const trigger of ["plan", "gate", "loop"] as const) {
		const run = await dynamic();
		try {
			if (trigger === "plan") {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/write", items: 3, openItems: 2, runIdHash: signalRunId("r") });
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/go", runIdHash: signalRunId("r") });
			} else if (trigger === "gate") {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/gate", pass: false, fails: 2, runIdHash: signalRunId("r") });
			} else {
				emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "loop/tier", tier: 2, detector: "exact" });
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
		emitHarnessSignal(run.fp.pi.events as never, { v: 1, type: "plan/gate", pass: false, fails: 2, runIdHash: signalRunId("r") });
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
		const mod = await import(`../extensions/tool-activation.ts?default=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", { reason: "new" }, {});
		assert.equal(active.includes("subagent"), false);
		assert.equal(active.includes("compact_context"), false);
	} finally { if (previous === undefined) delete process.env.MUNCHKIN_TOOL_ACTIVATION; else process.env.MUNCHKIN_TOOL_ACTIVATION = previous; }
});
