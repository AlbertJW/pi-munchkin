import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { installRunKernel } from "../extensions/run-kernel.ts";
import { RUN_EVENT_CHANNEL, onRunEvent } from "../lib/run-kernel-events.ts";
import type { RunEventV1 } from "../lib/run-kernel-types.ts";
import { fire, makeCtx, makeFakePi } from "./integration-harness.ts";

const SURFACE = "c".repeat(64);

function deterministicIds() {
	let n = 0;
	return () => `id-${++n}`;
}

test("default is shadow; off registers nothing; shadow is behavior-neutral", () => {
	const prior = process.env.RUN_KERNEL;
	try {
		process.env.RUN_KERNEL = "off";
		const off = makeFakePi();
		assert.equal(installRunKernel(off.pi as never).mode, "off");
		assert.equal(off.handlers.size, 0);
		assert.equal(off.busHandlers.size, 0);

		delete process.env.RUN_KERNEL;
		const shadow = makeFakePi();
		assert.equal(installRunKernel(shadow.pi as never, { surfaceHash: () => SURFACE }).mode, "shadow");
		assert.equal(shadow.tools.size, 0, "shadow must add NO tool to the model surface");
		// Exactly one user command: /run-new declares an explicit run boundary. pi
		// never expands extension commands into a prompt, so this is invisible to
		// the model — the same reason run-capsule registers /run-status in its own
		// shadow mode. Named explicitly so a second command cannot slip in.
		assert.deepEqual([...shadow.commands.keys()], ["run-new"]);
		assert.deepEqual(shadow.sent, []);
		assert.deepEqual(shadow.deliveries, []);
		assert.deepEqual(shadow.customDeliveries, []);
		assert.deepEqual(shadow.entries, []);
	} finally {
		if (prior === undefined) delete process.env.RUN_KERNEL; else process.env.RUN_KERNEL = prior;
	}
});

test("shadow and off leave the same model-visible surface after a full cycle", async () => {
	async function exercise(mode: "shadow" | "off") {
		const fp = makeFakePi();
		fp.pi.registerTool({ name: "read", description: "baseline" });
		fp.pi.setActiveTools(["read"]);
		installRunKernel(fp.pi as never, {
			mode, idFactory: deterministicIds(), detectGate: async () => null, surfaceHash: () => SURFACE,
		});
		const { ctx } = makeCtx("/tmp/run-kernel-neutrality");
		await fire(fp, "session_start", {}, ctx);
		await fire(fp, "before_agent_start", { prompt: "inspect", systemPrompt: "baseline", systemPromptOptions: {} }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fire(fp, "tool_execution_start", { toolCallId: "n1", toolName: "read", args: { path: "safe" } }, ctx);
		await fire(fp, "tool_result", { type: "tool_result", toolCallId: "n1", toolName: "read", input: { path: "safe" }, content: [], details: {}, isError: false }, ctx);
		await fire(fp, "tool_execution_end", { toolCallId: "n1", toolName: "read", result: { content: [] }, isError: false }, ctx);
		await fire(fp, "agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] }, ctx);
		await fire(fp, "agent_settled", {}, ctx);
		return {
			tools: [...fp.tools.keys()], commands: [...fp.commands.keys()], active: fp.pi.getActiveTools(),
			sent: fp.sent, deliveries: fp.deliveries, custom: fp.customDeliveries, entries: fp.entries,
		};
	}
	const shadowSurface = await exercise("shadow");
	const offSurface = await exercise("off");
	// The contract is that shadow adds nothing the MODEL can see. /run-new is a
	// user command (pi never expands extension commands into a prompt), so it is
	// compared out explicitly rather than by loosening the equality — everything
	// else must still match byte for byte.
	assert.deepEqual(shadowSurface.commands, ["run-new"]);
	assert.deepEqual(offSurface.commands, []);
	assert.deepEqual({ ...shadowSurface, commands: [] }, { ...offSurface, commands: [] });
});

test("shadow kernel produces canonical bus events and one settled summary", async () => {
	const root = mkdtempSync(join(tmpdir(), "run-kernel-integration-"));
	const file = join(root, "events.jsonl");
	const names = ["TELEMETRY", "TELEMETRY_FILE", "TELEMETRY_SOURCE", "TELEMETRY_STRICT"];
	const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
	process.env.TELEMETRY_FILE = file;
	process.env.TELEMETRY_SOURCE = "test";
	process.env.TELEMETRY_STRICT = "1";
	delete process.env.TELEMETRY;
	try {
		const fp = makeFakePi();
		const events: RunEventV1[] = [];
		onRunEvent(fp.pi.events as never, (event) => { events.push(event); });
		const controller = installRunKernel(fp.pi as never, {
			mode: "shadow", now: (() => { let n = 100; return () => ++n; })(), idFactory: deterministicIds(),
			detectGate: async () => "npm test", surfaceHash: () => SURFACE, piVersion: "0.83.2",
		});
		const { ctx } = makeCtx(root);
		await fire(fp, "session_start", { reason: "new" }, ctx);
		await fire(fp, "before_agent_start", { prompt: "private objective text", systemPrompt: "ignored", systemPromptOptions: {} }, ctx);
		await fire(fp, "agent_start", {}, ctx);
		await fire(fp, "tool_execution_start", { toolCallId: "c1", toolName: "bash", args: { command: "npm test" } }, ctx);
		await fire(fp, "tool_result", { type: "tool_result", toolCallId: "c1", toolName: "bash", input: { command: "npm test" }, content: [{ type: "text", text: "ok" }], details: {}, isError: false }, ctx);
		await fire(fp, "tool_execution_end", { toolCallId: "c1", toolName: "bash", result: { content: [{ type: "text", text: "ok" }] }, isError: false }, ctx);
		await fire(fp, "agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "done" }] }] }, ctx);
		assert.equal(controller.getState().lifecycle.state, "settling");
		const preSettlementRows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(preSettlementRows.some((row) => row.ext === "run-kernel" && row.kind === "settled"), false);
		await fire(fp, "agent_settled", {}, ctx);
		await fire(fp, "agent_settled", {}, ctx);

		assert.ok(events.some((event) => event.type === "run/session-started"));
		assert.ok(events.some((event) => event.type === "run/tool-finished"));
		assert.ok(events.some((event) => event.type === "run/phase-changed"));
		assert.equal(controller.getState().lifecycle.state, "idle");
		assert.equal(controller.getState().outcome.status, "complete");
		assert.deepEqual(fp.sent, []);
		assert.deepEqual(fp.entries, []);
		const rows = readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
		assert.equal(rows.filter((row) => row.ext === "run-kernel" && row.kind === "receipt").length, 1);
		assert.equal(rows.filter((row) => row.ext === "run-kernel" && row.kind === "settled").length, 1);
		const encoded = JSON.stringify(rows);
		assert.equal(encoded.includes("npm test"), false);
		assert.equal(encoded.includes("private objective text"), false);
		assert.equal(encoded.includes(root), false);
	} finally {
		for (const [name, value] of Object.entries(prior)) {
			if (value === undefined) delete process.env[name]; else process.env[name] = value;
		}
		if (existsSync(root)) rmSync(root, { recursive: true, force: true });
	}
});

test("retry cycles retain one run and only the final settlement closes it", async () => {
	const fp = makeFakePi();
	const events: RunEventV1[] = [];
	onRunEvent(fp.pi.events as never, (event) => { events.push(event); });
	const controller = installRunKernel(fp.pi as never, {
		mode: "shadow", idFactory: deterministicIds(), detectGate: async () => null, surfaceHash: () => SURFACE,
	});
	const { ctx } = makeCtx("/tmp/run-kernel-retry");
	await fire(fp, "session_start", {}, ctx);
	await fire(fp, "before_agent_start", { prompt: "one objective", systemPrompt: "ignored", systemPromptOptions: {} }, ctx);
	await fire(fp, "agent_start", {}, ctx);
	const runId = controller.getState().identity.runIdHash;
	await fire(fp, "tool_execution_start", { toolCallId: "reused", toolName: "read", args: { path: "first" } }, ctx);
	await fire(fp, "tool_result", { type: "tool_result", toolCallId: "reused", toolName: "read", input: { path: "first" }, content: [], details: {}, isError: false }, ctx);
	await fire(fp, "tool_execution_end", { toolCallId: "reused", toolName: "read", result: { content: [] }, isError: false }, ctx);
	await fire(fp, "agent_end", { messages: [] }, ctx);
	await fire(fp, "session_compact", {}, ctx);
	await fire(fp, "agent_start", {}, ctx);
	await fire(fp, "tool_execution_start", { toolCallId: "reused", toolName: "read", args: { path: "second" } }, ctx);
	await fire(fp, "tool_result", { type: "tool_result", toolCallId: "reused", toolName: "read", input: { path: "second" }, content: [], details: {}, isError: false }, ctx);
	await fire(fp, "tool_execution_end", { toolCallId: "reused", toolName: "read", result: { content: [] }, isError: false }, ctx);
	await fire(fp, "agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "recovered" }] }] }, ctx);
	assert.equal(controller.getState().identity.runIdHash, runId);
	assert.equal(controller.getState().counters.receipts, 2, "call IDs may repeat in a later retry cycle");
	assert.equal(events.filter((event) => event.type === "run/cycle-settled").length, 0);
	await fire(fp, "agent_settled", {}, ctx);
	assert.equal(events.filter((event) => event.type === "run/cycle-settled").length, 1);
	assert.equal(controller.getState().outcome.status, "complete");
});

test("legacy disagreement is deduplicated and contains no legacy payload", async () => {
	const fp = makeFakePi();
	const previous = (globalThis as Record<string, unknown>).__pi_active_plan_context;
	try {
		installRunKernel(fp.pi as never, { mode: "shadow", idFactory: deterministicIds(), detectGate: async () => null, surfaceHash: () => SURFACE });
		const { ctx } = makeCtx("/tmp/test");
		await fire(fp, "session_start", {}, ctx);
		(globalThis as Record<string, unknown>).__pi_active_plan_context = { item_id: "private-plan-title" };
		await fire(fp, "turn_end", {}, ctx);
		await fire(fp, "turn_end", {}, ctx);
		assert.equal(fp.sent.length, 0);
	} finally {
		if (previous === undefined) delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		else (globalThis as Record<string, unknown>).__pi_active_plan_context = previous;
	}
});

test("unknown run event types are rejected by the shared bus contract", () => {
	const fp = makeFakePi();
	let observed = 0;
	const stop = onRunEvent(fp.pi.events as never, () => { observed += 1; });
	fp.pi.events.emit(RUN_EVENT_CHANNEL, { v: 1, type: "run/future-typo", sequence: 1, atMs: 1 });
	stop();
	assert.equal(observed, 0);
});

test("run event bus rejects malformed, extra-field, and raw-field payloads", () => {
	const fp = makeFakePi();
	const observed: RunEventV1[] = [];
	const stop = onRunEvent(fp.pi.events as never, (event) => { observed.push(event); });
	for (const payload of [
		{ v: 1, type: "run/session-started", sequence: 1, atMs: 1 },
		{ v: 1, type: "run/cycle-settled", sequence: -1, atMs: 1 },
		{ v: 1, type: "run/cycle-settled", sequence: 1, atMs: 1, command: "must-not-cross" },
		{ v: 1, type: "run/tool-finished", sequence: 1, atMs: 1, receipt: { command: "must-not-cross" } },
	]) fp.pi.events.emit(RUN_EVENT_CHANNEL, payload);
	stop();
	assert.deepEqual(observed, []);
});

test("legacy prefix-only event validation would admit the rejected counterfactual", () => {
	const unsafeLegacyPredicate = (value: unknown): boolean => {
		const event = value as { v?: unknown; type?: unknown; sequence?: unknown; atMs?: unknown };
		return event?.v === 1 && typeof event.type === "string" && event.type.startsWith("run/") &&
			Number.isSafeInteger(event.sequence) && typeof event.atMs === "number";
	};
	assert.equal(unsafeLegacyPredicate({ v: 1, type: "run/future-typo", sequence: 1, atMs: 1 }), true);
	assert.equal(unsafeLegacyPredicate({ v: 1, type: "run/cycle-settled", sequence: 1, atMs: 1, command: "raw" }), true);
});

test("verify_project reaches canonical verification state through the ordinary tool receipt", async () => {
	const fp = makeFakePi();
	const controller = installRunKernel(fp.pi as never, {
		mode: "shadow", idFactory: deterministicIds(),
		detectGate: async () => "npm test", surfaceHash: () => SURFACE,
	});
	const { ctx } = makeCtx("/tmp/run-kernel-project-verification");
	await fire(fp, "session_start", {}, ctx);
	await fire(fp, "tool_execution_start", { toolCallId: "e1", toolName: "edit", args: { path: "src/a.ts" } }, ctx);
	await fire(fp, "tool_result", { type: "tool_result", toolCallId: "e1", toolName: "edit", input: { path: "src/a.ts" }, content: [], details: {}, isError: false }, ctx);
	await fire(fp, "tool_execution_end", { toolCallId: "e1", toolName: "edit", result: { content: [] }, isError: false }, ctx);
	assert.equal(controller.getState().verification.validAfterMutation, false);

	await fire(fp, "tool_execution_start", { toolCallId: "v1", toolName: "verify_project", args: {} }, ctx);
	await fire(fp, "tool_result", { type: "tool_result", toolCallId: "v1", toolName: "verify_project", input: {}, content: [], details: {}, isError: false }, ctx);
	await fire(fp, "tool_execution_end", { toolCallId: "v1", toolName: "verify_project", result: { content: [] }, isError: false }, ctx);
	assert.equal(controller.getState().verification.validAfterMutation, true);
	assert.equal(controller.getState().verification.validGates, 1);
});

test("a new objective after an UNCOMPLETED run keeps the old identity until /run-new declares the boundary", async () => {
	// The kernel rotated identity only on `complete`, so a fresh unrelated
	// objective typed after a paused/blocked/unverified run inherited the old
	// run — and that run's settled/receipt rows then reported the PREVIOUS
	// objective's counters. Auto-rotating per prompt is not the fix: it would
	// sever the cross-turn mutation→verification link inside settle().
	const { emitHarnessSignal } = await import("../lib/harness-signals.ts");
	const fp = makeFakePi();
	const controller = installRunKernel(fp.pi as never, {
		mode: "shadow", idFactory: deterministicIds(), detectGate: async () => null, surfaceHash: () => SURFACE,
	});
	const { ctx } = makeCtx("/tmp/run-kernel-boundary");
	await fire(fp, "session_start", {}, ctx);
	await fire(fp, "before_agent_start", { prompt: "first objective", systemPrompt: "s", systemPromptOptions: {} }, ctx);
	await fire(fp, "agent_start", {}, ctx);
	const first = controller.getState().identity.runIdHash;
	// A mutation with no verification: the run cannot settle as `complete`.
	await fire(fp, "tool_execution_start", { toolCallId: "e1", toolName: "edit", args: { path: "src/a.ts" } }, ctx);
	await fire(fp, "tool_result", { type: "tool_result", toolCallId: "e1", toolName: "edit", input: { path: "src/a.ts" }, content: [], details: {}, isError: false }, ctx);
	await fire(fp, "tool_execution_end", { toolCallId: "e1", toolName: "edit", result: { content: [] }, isError: false }, ctx);
	await fire(fp, "agent_end", { messages: [{ role: "assistant", content: [{ type: "text", text: "done-ish" }] }] }, ctx);
	await fire(fp, "agent_settled", {}, ctx);
	assert.notEqual(controller.getState().outcome.status, "complete", "an unverified mutation must not settle as complete");

	// Retry/continuation semantics are PRESERVED: no explicit boundary, no rotation.
	await fire(fp, "before_agent_start", { prompt: "keep going on that", systemPrompt: "s", systemPromptOptions: {} }, ctx);
	assert.equal(controller.getState().identity.runIdHash, first,
		"without an explicit boundary a follow-up prompt must stay in the same run (retries depend on this)");

	// The explicit boundary rotates exactly once, on the NEXT prompt.
	emitHarnessSignal(fp.pi.events as never, { v: 1, type: "run/abandoned", origin: "run-command" });
	assert.equal(controller.getState().identity.runIdHash, first, "the signal alone must not rotate mid-turn");
	await fire(fp, "before_agent_start", { prompt: "completely unrelated new objective", systemPrompt: "s", systemPromptOptions: {} }, ctx);
	const second = controller.getState().identity.runIdHash;
	assert.notEqual(second, first, "an abandoned run must not lend its identity to new work");
	// ...and the latch is consumed, not sticky.
	await fire(fp, "before_agent_start", { prompt: "follow-up on the new objective", systemPrompt: "s", systemPromptOptions: {} }, ctx);
	assert.equal(controller.getState().identity.runIdHash, second, "one boundary rotates once");
});
