// Automatic continuation is bounded per user turn and never restarts an aborted run.
// Regression tests for audit 2026-10 R1/R2. Offline: scripted streamFn, no network.
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import { AgentSession, createEventBus, SessionManager, SettingsManager, convertToLlm, type ResourceLoader } from "@earendil-works/pi-coding-agent";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import planRunner from "../extensions/plan-runner.ts";
import controlArbiter from "../extensions/control-arbiter.ts";
import { resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { emitContinuationRequest, hashContinuationIdentity } from "../lib/continuation-authority.ts";
import { createGoal, mutateGoal } from "../lib/goal-state.ts";
import { scriptedModelRuntime } from "./session-fixture.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-continuation-budget-"));
process.env.PLAN_STORAGE = "project";

const model: Model<"scripted"> = {
	id: "scripted", name: "scripted", api: "scripted", provider: "test", baseUrl: ["http://", "127.0.0.1:1"].join(""),
	reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 1_024,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage =>
	({ role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(), usage } as AssistantMessage);
// Every odd request records new goal evidence, so every goal revision is new and
// earns a continuation offer: without a budget this never stops.
const progressing = (n: number) => n % 2 === 1
	? reply([{ type: "toolCall", id: `u${n}`, name: "goal_update", arguments: { progress_evidence: [`step ${n}`] } }], "toolUse")
	: reply([{ type: "text", text: `turn ${n}` }]);

async function fixture(cwd: string, script: (n: number) => AssistantMessage, activeTools: string[] = []) {
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId: "budget", runIdHash: null };
	resetCompactionCoordinator();
	const bus = createEventBus();
	const runtime = createExtensionRuntime();
	const extensions = await Promise.all([
		loadExtensionFromFactory(planRunner, cwd, bus, runtime, "budget-plan-runner"),
		loadExtensionFromFactory(controlArbiter, cwd, bus, runtime, "budget-control-arbiter"),
	]);
	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions, errors: [], runtime }),
		getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined, getSystemPromptSource: () => undefined, getAppendSystemPrompt: () => [], getAppendSystemPromptSources: () => [],
		extendResources: () => undefined, reload: async () => undefined,
	};
	let requests = 0;
	const agent = new Agent({
		initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] }, convertToLlm,
		streamFn: () => {
			requests += 1;
			const message = script(requests);
			const stream = createAssistantMessageEventStream();
			stream.push({ type: "start", partial: message });
			if (message.stopReason === "aborted") stream.push({ type: "error", reason: "aborted", error: message } as never);
			else stream.push({ type: "done", reason: message.stopReason as "stop", message });
			return stream;
		},
	});
	const notices: string[] = [];
	const session = new AgentSession({
		agent, cwd, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({}), resourceLoader,
		modelRuntime: await scriptedModelRuntime(model), initialActiveToolNames: [], baseToolsOverride: {},
	});
	await session.bindExtensions({
		uiContext: { notify: (message: string) => { notices.push(message); } } as never,
		onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`),
	});
	if (activeTools.length) session.setActiveToolsByName(activeTools);
	const receipts = () => session.sessionManager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "pi-munchkin:continuation-receipt/v1").length;
	return { session, bus, requests: () => requests, receipts, notices };
}

async function activeGoal(prefix: string): Promise<string> {
	const cwd = mkdtempSync(join(tmpdir(), prefix));
	await mutateGoal(cwd, async () => ({ goal: createGoal({ cwd, objective: "A goal that never finishes" }), result: undefined }));
	return cwd;
}

async function settled(session: AgentSession): Promise<void> {
	for (let i = 0; i < 20; i += 1) { await session.waitForIdle(); await new Promise((resolve) => setTimeout(resolve, 20)); }
}

test("automatic continuations stop after the per-turn budget (default 3)", async () => {
	const cwd = await activeGoal("pi-budget-default-");
	const { session, requests, receipts } = await fixture(cwd, (n) => n > 40 ? reply([{ type: "text", text: "cap" }]) : progressing(n), ["goal_update"]);
	await session.sendUserMessage("work on the goal");
	await settled(session);
	assert.equal(receipts(), 3, "three harness-started continuations");
	assert.equal(requests(), 8, "the user's two requests plus two per continuation, then stop");
});

test("a new user message starts a new continuation budget", async () => {
	const cwd = await activeGoal("pi-budget-reset-");
	const { session, receipts } = await fixture(cwd, (n) => n > 40 ? reply([{ type: "text", text: "cap" }]) : progressing(n), ["goal_update"]);
	await session.sendUserMessage("work on the goal");
	await settled(session);
	assert.equal(receipts(), 3);
	await session.sendUserMessage("keep going");
	await settled(session);
	assert.equal(receipts(), 6);
});

test("MUNCHKIN_MAX_AUTO_CONTINUATIONS=unbounded restores unlimited continuation", async () => {
	process.env.MUNCHKIN_MAX_AUTO_CONTINUATIONS = "unbounded";
	try {
		const cwd = await activeGoal("pi-budget-unbounded-");
		const { session, requests } = await fixture(cwd, (n) => n >= 20 ? reply([{ type: "text", text: "cap" }]) : progressing(n), ["goal_update"]);
		await session.sendUserMessage("work on the goal");
		await settled(session);
		assert.ok(requests() >= 20, `only the test's own cap stops it (observed ${requests()})`);
	} finally { delete process.env.MUNCHKIN_MAX_AUTO_CONTINUATIONS; }
});

test("an aborted run is not restarted by a goal continuation", async () => {
	const cwd = await activeGoal("pi-budget-abort-");
	const { session, requests, receipts } = await fixture(cwd, (n) => n === 1 ? reply([{ type: "text", text: "partial" }], "aborted") : reply([{ type: "text", text: "continued" }]));
	await session.sendUserMessage("start, then the user presses Esc");
	await settled(session);
	assert.equal(requests(), 1);
	assert.equal(receipts(), 0);
});

test("a late offer after an aborted run is rejected until the user speaks again", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-budget-late-"));
	const { session, bus, requests } = await fixture(cwd, (n) => n === 1 ? reply([{ type: "text", text: "partial" }], "aborted") : reply([{ type: "text", text: "late" }]));
	await session.sendUserMessage("start, then abort");
	await settled(session);
	const sessionIdHash = hashContinuationIdentity(session.sessionManager.getSessionId());
	emitContinuationRequest(bus as never, {
		request: { v: 1, session_id_hash: sessionIdHash, owner_id_hash: hashContinuationIdentity("late-owner"), generation: "1", scope: "session",
			reason: "drift_review", priority: 150, idempotency_key: "late:1", message: "late advisory", expires_at_ms: Date.now() + 60_000 },
		authorize: () => true,
	});
	await settled(session);
	assert.equal(requests(), 1, "the late advisory did not start a turn after the abort");
});
