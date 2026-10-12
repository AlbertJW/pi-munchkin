// Goal brief injection and settlement authority in a real AgentSession.
// Offline: scripted streamFn, in-memory model runtime, no network.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
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
import { createGoal, goalStoragePath, mutateGoal, readCurrentGoal } from "../lib/goal-state.ts";
import { scriptedModelRuntime } from "./session-fixture.ts";

process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-goal-authority-"));
process.env.PLAN_STORAGE = "project";
process.env.MUNCHKIN_MAX_AUTO_CONTINUATIONS = "0"; // isolate injection from continuation

const model: Model<"scripted"> = {
	id: "scripted", name: "scripted", api: "scripted", provider: "test", baseUrl: ["http://", "127.0.0.1:1"].join(""),
	reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 1_024,
};
const usage = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
const reply = (content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"] = "stop"): AssistantMessage =>
	({ role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(), usage } as AssistantMessage);
const text = (value: string) => reply([{ type: "text", text: value }]);
const call = (id: string, name: string, args: Record<string, any>) => reply([{ type: "toolCall", id, name, arguments: args }], "toolUse");

async function fixture(cwd: string, script: (n: number) => AssistantMessage, tools: string[]) {
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId: "goal-authority", runIdHash: null };
	resetCompactionCoordinator();
	const bus = createEventBus();
	const runtime = createExtensionRuntime();
	const extensions = await Promise.all([
		loadExtensionFromFactory(planRunner, cwd, bus, runtime, "ga-plan-runner"),
		loadExtensionFromFactory(controlArbiter, cwd, bus, runtime, "ga-control-arbiter"),
		loadExtensionFromFactory((pi) => {
			pi.on("session_before_compact", async (event: any) => ({ compaction: {
				summary: "scripted compaction", firstKeptEntryId: event.preparation.firstKeptEntryId,
				tokensBefore: event.preparation.tokensBefore, estimatedTokensAfter: 1, details: {},
			} }));
		}, cwd, bus, runtime, "ga-compaction"),
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
			stream.push({ type: "done", reason: message.stopReason as "stop", message });
			return stream;
		},
	});
	const notices: string[] = [];
	const session = new AgentSession({
		agent, cwd, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory({ compaction: { keepRecentTokens: 1 } }), resourceLoader,
		modelRuntime: await scriptedModelRuntime(model), initialActiveToolNames: [], baseToolsOverride: {},
	});
	await session.bindExtensions({
		uiContext: { notify: (message: string) => { notices.push(message); } } as never,
		onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`),
	});
	session.setActiveToolsByName(tools);
	const briefs = () => session.sessionManager.getEntries().filter((entry) => JSON.stringify(entry).includes('"customType":"pi-munchkin:goal-context"')).length;
	return { session, briefs, notices };
}

async function activeGoal(prefix: string, criteria?: Array<{ id: string; text: string; required?: boolean }>): Promise<string> {
	const cwd = mkdtempSync(join(tmpdir(), prefix));
	await mutateGoal(cwd, async () => ({ goal: createGoal({ cwd, objective: "Keep the goal in view", criteria }), result: undefined }));
	return cwd;
}

test("the goal brief is injected once per revision, and again after compaction", async () => {
	const cwd = await activeGoal("pi-goal-brief-");
	let n = 0;
	const { session, briefs } = await fixture(cwd, () => {
		n += 1;
		return n === 3 ? call("u1", "goal_update", { progress_evidence: ["changed something"] }) : text(`reply ${n}`);
	}, ["goal_update"]);
	await session.prompt("first");
	await session.prompt("second");
	assert.equal(briefs(), 1, "an unchanged goal is not re-injected on every message");
	await session.prompt("third (updates the goal)");
	await session.prompt("fourth");
	assert.equal(briefs(), 2, "a changed goal revision is injected once more");
	await session.compact();
	await session.prompt("fifth");
	assert.ok(briefs() >= 3, "after compaction the brief is restored");
});

test("a model 80/20 settlement stays a proposal until the user runs /goal-accept", async () => {
	const cwd = await activeGoal("pi-goal-80-20-", [{ id: "core", text: "Core" }, { id: "polish", text: "Polish", required: false }]);
	let n = 0;
	const { session, notices } = await fixture(cwd, () => {
		n += 1;
		if (n === 1) return call("u1", "goal_update", { criteria: [{ id: "core", status: "met", evidence: ["tests pass"] }, { id: "polish", status: "deferred" }] });
		if (n === 3) return call("s1", "goal_settle", { outcome: "accepted_80_20", delivered_value: "core shipped", confidence: 0.8, residual_risks: ["polish later"],
			deferred: [{ value: "polish", risk: "minor", rationale: "not needed now" }], evidence: ["tests pass"] });
		return text(`reply ${n}`);
	}, ["goal_update", "goal_settle"]);
	await session.prompt("do the core work");
	await session.prompt("settle it");
	const proposed = await readCurrentGoal(cwd);
	assert.equal(proposed?.status, "active", "the model did not close the user's goal");
	assert.equal(proposed?.settlement_proposal?.delivered_value, "core shipped");
	await session.prompt("/goal-accept");
	const accepted = await readCurrentGoal(cwd);
	assert.equal(accepted?.status, "accepted_80_20");
	assert.ok(notices.some((notice) => notice.includes("80/20 settlement accepted")));
});

test("/goal-status names a leftover goal lock", async () => {
	const cwd = await activeGoal("pi-goal-lock-");
	const lock = `${goalStoragePath(cwd)}.lock`;
	const { session, notices } = await fixture(cwd, () => text("ok"), []);
	mkdirSync(lock, { recursive: true });
	writeFileSync(join(lock, "owner.json"), JSON.stringify({ nonce: "x", pid: 4242, created_at: "2026-10-12T00:00:00.000Z" }));
	await session.prompt("/goal-status");
	assert.ok(notices.some((notice) => notice.includes("Goal lock present") && notice.includes("4242")), notices.join("\n"));
});
