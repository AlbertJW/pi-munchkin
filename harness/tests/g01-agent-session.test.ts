import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent, type AgentTool } from "@earendil-works/pi-agent-core";
import {
	AgentSession, AuthStorage, createEventBus,
	ModelRegistry, SessionManager, SettingsManager, convertToLlm, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import planRunner from "../extensions/plan-runner.ts";
import controlArbiter from "../extensions/control-arbiter.ts";
import compactTool from "../extensions/compact-tool.ts";
import { resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { blockGoal, cancelGoal, createGoal, mutateGoal, pauseGoal, readCurrentGoal, readExecutableGoal, settleGoal } from "../lib/goal-state.ts";
import { onContinuationRequest } from "../lib/continuation-authority.ts";
import { Type } from "typebox";

const AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-g01-agent-dir-"));
process.env.PI_CODING_AGENT_DIR = AGENT_DIR;
process.env.PLAN_STORAGE = "project";

const model: Model<"scripted"> = {
	id: "scripted", name: "scripted", api: "scripted", provider: "test", baseUrl: ["http://", "127.0.0.1:1"].join(""),
	reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 1_024,
};

function response(): AssistantMessage {
	return {
		role: "assistant", content: [{ type: "text", text: "finished this turn" }], api: model.api,
		provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(),
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

async function sessionFixture(cwd: string, afterFirstEnd?: () => Promise<void>, withTool = false, withCompaction = false): Promise<{ session: AgentSession; requests: () => number; requestTexts: () => string[]; settles: () => number; toolExecutions: () => number; continuationOffers: () => number; compactions: () => number }> {
	(globalThis as Record<string, unknown>).__pi_run_capsule_identity = { cwd, capsuleId: "g01-agent-session", runIdHash: null };
	const bus = createEventBus();
	const runtime = createExtensionRuntime();
	let ends = 0;
	let settled = 0;
	let toolExecutions = 0;
	let compactions = 0;
	resetCompactionCoordinator();
	const sessionManager = SessionManager.inMemory(cwd);
	const settingsManager = SettingsManager.inMemory(withCompaction ? { compaction: { keepRecentTokens: 1 } } : {});
	// Seed enough real session history for Pi's cut-point algorithm to have
	// something to summarize. These are persisted through SessionManager, then
	// loaded into Agent.state by the actual AgentSession constructor.
	if (withCompaction) {
		for (let index = 0; index < 6; index += 1) {
			sessionManager.appendMessage({ role: "user", content: `old user context ${index}`, timestamp: Date.now() } as any);
			sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: `old assistant context ${index}` }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(), usage: response().usage } as any);
		}
	}
	const pauseExtension = afterFirstEnd
		? [(pi: Parameters<typeof planRunner>[0]) => pi.on("agent_end", async () => { if (++ends === 1) await afterFirstEnd(); })]
		: [];
	const extensions = await Promise.all([
		loadExtensionFromFactory(planRunner, cwd, bus, runtime, "g01-plan-runner"),
		loadExtensionFromFactory(controlArbiter, cwd, bus, runtime, "g01-control-arbiter"),
		...(withCompaction ? [loadExtensionFromFactory(compactTool, cwd, bus, runtime, "g01-compact-tool")] : []),
		...(withCompaction ? [loadExtensionFromFactory((pi) => {
			pi.on("session_before_compact", async (event: any) => {
				compactions += 1;
				return { compaction: {
					summary: "G01 deterministic compaction preserved the active task and goal state.",
					firstKeptEntryId: event.preparation.firstKeptEntryId,
					tokensBefore: event.preparation.tokensBefore,
					estimatedTokensAfter: 12,
					details: { source: "g01-real-agent-session" },
				} };
			});
		}, cwd, bus, runtime, "g01-compaction-source")] : []),
		loadExtensionFromFactory((pi) => {
			pi.on("agent_settled", async () => { settled += 1; });
			pi.on("tool_execution_start", async () => { toolExecutions += 1; });
		}, cwd, bus, runtime, "g01-observer"),
		...pauseExtension.map((factory) => loadExtensionFromFactory(factory, cwd, bus, runtime, "g01-lifecycle")),
	]);
	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions, errors: [], runtime }),
		getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined, getAppendSystemPrompt: () => [], extendResources: () => undefined, reload: async () => undefined,
	};
	let requestCount = 0;
	const requestTexts: string[] = [];
	const agent = new Agent({
		initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] },
		// AgentSession's SDK path supplies coding-agent's converter, which turns
		// extension custom messages into LLM user messages. Use that real converter
		// here instead of Agent's low-level default (which intentionally filters
		// custom roles) so this fixture exercises the production contract.
		convertToLlm,
		streamFn: (_model, context) => {
			requestCount += 1;
			requestTexts.push(context.messages.map((message) => {
				const content = message.content;
				if (typeof content === "string") return content;
				if (Array.isArray(content)) return content.map((part) => part.type === "text" ? part.text : "[non-text]").join("\n");
				return message.role;
			}).join(" | "));
			const stream = createAssistantMessageEventStream();
			const message = withCompaction && requestCount === 1
				? { ...response(), content: [{ type: "toolCall" as const, id: "g01-compact-call", name: "compact_context", arguments: {} }], stopReason: "toolUse" as const }
				: withTool && requestCount === 1
				? { ...response(), content: [{ type: "toolCall" as const, id: "g01-tool-call", name: "g01_echo", arguments: { value: "fixture" } }], stopReason: "toolUse" as const }
				: response();
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			return stream;
		},
	});
	const tool: AgentTool = {
		name: "g01_echo", label: "G01 echo", description: "A deterministic qualification tool.", parameters: Type.Object({ value: Type.String() }),
		execute: async (_id, params) => ({ content: [{ type: "text" as const, text: `echo:${(params as { value: string }).value}` }], details: {} }),
	};
	const authStorage = AuthStorage.inMemory({ test: { type: "api_key", key: "scripted-no-network" } });
	const session = new AgentSession({
		agent, cwd, sessionManager, settingsManager,
		resourceLoader, modelRegistry: ModelRegistry.inMemory(authStorage), initialActiveToolNames: withTool ? ["g01_echo"] : [],
		baseToolsOverride: withTool ? { g01_echo: tool } : {},
	});
	if (withCompaction) session.setActiveToolsByName(["compact_context"]);
	await session.bindExtensions({ onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`) });
	let offers = 0;
	onContinuationRequest(bus, () => { offers += 1; });
	return { session, requests: () => requestCount, requestTexts: () => requestTexts, settles: () => settled, toolExecutions: () => toolExecutions, continuationOffers: () => offers, compactions: () => compactions };
}

test("G01-A: a real AgentSession does not start a queued goal turn after pause commits", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-paused-"));
	const goal = createGoal({ cwd, objective: "Do not continue after pause" });
	await mutateGoal(cwd, async () => ({ goal, result: undefined }));
	const { session, requests, requestTexts, settles } = await sessionFixture(cwd, async () => {
		await mutateGoal(cwd, async (current) => ({ goal: pauseGoal(current!), result: undefined }));
		assert.equal((await readCurrentGoal(cwd))?.status, "paused", "the user-owned pause must commit before continuation dispatch");
	});
	await session.sendUserMessage("start the goal");
	await session.waitForIdle();
	assert.equal(settles(), 1, "Pi delivered the real agent_settled lifecycle event");
	assert.equal(requests(), 1, `the scripted provider saw only the original user turn: ${requestTexts().join(" || ")}`);
	assert.match(requestTexts()[0]!, /start the goal/, "the original user work is still sent to the provider");
	assert.equal(session.getFollowUpMessages().length, 0, "no obsolete continuation remains queued");
});

for (const [name, transition] of [
	["blocked", (goal: ReturnType<typeof createGoal>) => blockGoal(goal, { reason: "awaiting access", evidence: ["access denied"], unblockCondition: "user grants access" })],
	["cancelled", (goal: ReturnType<typeof createGoal>) => cancelGoal(goal)],
	["complete", (goal: ReturnType<typeof createGoal>) => settleGoal(goal, { outcome: "complete", deliveredValue: "done", confidence: 1, residualRisks: [], evidence: ["verified"] })],
	["accepted_80_20", (goal: ReturnType<typeof createGoal>) => settleGoal(goal, { outcome: "accepted_80_20", deliveredValue: "useful result", confidence: 0.8, residualRisks: [], evidence: ["verified"] })],
] as const) {
	test(`G01-C: a ${name} goal cannot restart from an agent-end continuation offer`, async () => {
		const cwd = mkdtempSync(join(tmpdir(), `pi-g01-${name}-`));
		const goal = createGoal({ cwd, objective: `Do not continue after ${name}`, criteria: [] });
		await mutateGoal(cwd, async () => ({ goal, result: undefined }));
		const { session, requests } = await sessionFixture(cwd, async () => {
			await mutateGoal(cwd, async (current) => ({ goal: transition(current!), result: undefined }));
			assert.equal((await readCurrentGoal(cwd))?.status, name);
		});
		await session.sendUserMessage("perform one turn");
		await session.waitForIdle();
		assert.equal(requests(), 1, `${name} must reject the stale offer before a second provider request`);
	});
}

test("G01-B: replacing a goal invalidates the previous goal's offered continuation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-replaced-"));
	const original = createGoal({ cwd, objective: "Original goal" });
	await mutateGoal(cwd, async () => ({ goal: original, result: undefined }));
	const { session, requests } = await sessionFixture(cwd, async () => {
		const replacement = createGoal({ cwd, objective: "Replacement goal" });
		await mutateGoal(cwd, async () => ({ goal: replacement, result: undefined }));
		assert.equal((await readCurrentGoal(cwd))?.objective, "Replacement goal");
	});
	await session.sendUserMessage("perform one turn");
	await session.waitForIdle();
	assert.equal(requests(), 1, "the original goal's stale offer cannot start a replacement turn");
});

test("G01-D: a real AgentSession gives an unchanged active goal exactly one continuation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-active-"));
	const goal = createGoal({ cwd, objective: "Continue once while active" });
	await mutateGoal(cwd, async () => ({ goal, result: undefined }));
	const { session, requests, continuationOffers, settles } = await sessionFixture(cwd);
	await session.sendUserMessage("start the goal");
	for (let turns = 0; turns < 20 && requests() < 2; turns += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	await session.waitForIdle();
	assert.equal(continuationOffers(), 1, "plan-runner must offer an active-goal continuation");
	assert.equal(session.sessionManager.getEntries().filter((entry) => entry.type === "custom" && entry.customType === "pi-munchkin:continuation-receipt/v1").length, 1, "the arbiter must record its one delivery");
	assert.equal(requests(), 2, "one original request plus one authority-approved continuation");
	assert.equal(settles(), 2, "the continuation is a second settled Pi turn, not a hidden queue entry");
});

test("G01-E: request and tool execution counts come from one real AgentSession lifecycle", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-tool-"));
	const goal = createGoal({ cwd, objective: "Count tool work" });
	await mutateGoal(cwd, async () => ({ goal, result: undefined }));
	const { session, requests, toolExecutions, settles } = await sessionFixture(cwd, undefined, true);
	await session.sendUserMessage("use the deterministic tool once");
	await session.waitForIdle();
	assert.equal(requests(), 2, "the provider sees the tool-call turn and the tool-result turn");
	assert.equal(toolExecutions(), 1, "the harness counts the actual AgentSession tool execution event");
	assert.equal(settles(), 1, "the tool call and result remain one settled user turn");
});

test("G01-E: real AgentSession compaction preserves an active goal and resumes once", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-compaction-active-"));
	const goal = createGoal({ cwd, objective: "Survive real compaction" });
	await mutateGoal(cwd, async () => ({ goal, result: undefined }));
	const { session, requests, compactions, continuationOffers } = await sessionFixture(cwd, undefined, false, true);
	await session.sendUserMessage("compact the active goal context");
	await session.waitForIdle();
	for (let turns = 0; turns < 40 && requests() < 2; turns += 1) {
		await new Promise<void>((resolve) => setImmediate(resolve));
	}
	for (let turns = 0; turns < 80 && compactions() < 1; turns += 1) await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(compactions(), 1, "Pi emitted session_before_compact and used the deterministic compaction result");
	assert.equal((await readExecutableGoal(cwd))?.status, "active", "compaction must not change the authoritative active goal");
	assert.equal(continuationOffers(), 1, "the compact tool emits one authority offer after real compaction");
	assert.equal(requests(), 2, "the authority-approved post-compaction turn is a second real provider request");
	assert.equal(session.sessionManager.getEntries().some((entry) => entry.type === "compaction" && entry.fromHook === true), true, "Pi persisted the extension-provided compaction entry");
});

test("G01-E: real AgentSession compaction cannot resume an inactive goal", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-compaction-paused-"));
	const goal = createGoal({ cwd, objective: "Do not resume after pause" });
	await mutateGoal(cwd, async () => ({ goal, result: undefined }));
	await mutateGoal(cwd, async (current) => ({ goal: pauseGoal(current!), result: undefined }));
	const { session, requests, compactions, continuationOffers } = await sessionFixture(cwd, undefined, false, true);
	await session.sendUserMessage("compact the paused goal context");
	await session.waitForIdle();
	for (let turns = 0; turns < 20; turns += 1) await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(compactions(), 1, "the real compaction lifecycle still ran for a paused goal");
	assert.equal((await readCurrentGoal(cwd))?.status, "paused", "compaction must preserve the inactive status");
	assert.equal(continuationOffers(), 0, "inactive goals cannot enqueue a continuation after compaction");
	assert.equal(requests(), 2, "the compact tool's tool-call and tool-result exchange remains one user turn; no hidden continuation was started");
});

test("G01-E: a fresh real AgentSession recovers the active goal after compaction", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g01-recovery-"));
	const goal = createGoal({ cwd, objective: "Recover the complete objective", criteria: [{ id: "evidence", text: "Retain the required evidence criterion", required: true }] });
	await mutateGoal(cwd, async () => ({ goal, result: undefined }));
	const first = await sessionFixture(cwd, undefined, false, true);
	await first.session.sendUserMessage("compact before restarting the session");
	await first.session.waitForIdle();
	for (let turns = 0; turns < 80 && first.compactions() < 1; turns += 1) await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(first.compactions(), 1, "the first real session committed a compaction entry");
	assert.equal((await readExecutableGoal(cwd))?.objective, goal.objective, "the durable ledger still owns the full objective");

	const recovered = await sessionFixture(cwd);
	await recovered.session.sendUserMessage("continue from the recovered goal");
	await recovered.session.waitForIdle();
	assert.match(recovered.requestTexts()[0]!, /Recover the complete objective/, "the new AgentSession received the recovered objective");
	assert.match(recovered.requestTexts()[0]!, /Retain the required evidence criterion/, "the new AgentSession received the recovered criterion");
	assert.equal((await readExecutableGoal(cwd))?.status, "active", "recovery does not downgrade the executable goal");
});
