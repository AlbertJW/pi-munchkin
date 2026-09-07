import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	AgentSession, AuthStorage, createEventBus, ModelRegistry, SessionManager, SettingsManager, convertToLlm, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { claimIdForText, RESEARCH_EVIDENCE_CARDS_KEY } from "../lib/research-evidence.ts";
import { ownerRef, type GraphPlanState } from "../lib/plan-graph.ts";
import { privatePlanStatePath } from "../lib/plan-state-storage.ts";
import { ResearchRoundLedger, researchRoundPath, writeResearchRoundLedger } from "../lib/research-round.ts";

// This is a provider-neutral lifecycle fixture: the scripted provider emits a
// real plan_settle tool call, while all evidence and graph state are prepared by
// the parent. No network or model inference is used.
process.env.PLAN_GRAPH = "on";
process.env.DEEP_RESEARCH_PLANNING = "on";
process.env.RESEARCH_LEDGER = "on";
process.env.PLAN_STORAGE = "project";
process.env.PI_CODING_AGENT_DIR = mkdtempSync(join(tmpdir(), "pi-g04-agent-dir-"));

const { default: planRunner } = await import("../extensions/plan-runner.ts");

const model: Model<"scripted"> = {
	id: "scripted", name: "scripted", api: "scripted", provider: "test", baseUrl: ["http://", "127.0.0.1:1"].join(""),
	reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 1_024,
};

function assistantText(text = "provider should not receive another turn"): AssistantMessage {
	return {
		role: "assistant", content: [{ type: "text", text }], api: model.api, provider: model.provider, model: model.id,
		stopReason: "stop", timestamp: Date.now(),
		usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

test("G04-C: a real AgentSession delivers exactly one parent final answer and ignores late reports", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g04-agent-session-"));
	const runId = "g04-real-session";
	const claimId = claimIdForText("fake claim");
	const urls = ["https://example.test/fake-source", "https://example.test/independent"];
	const cards = [
		{ v: 1, card_id: "a".repeat(32), original_url: urls[0], content_sha256: "a".repeat(64), claim_ids: [claimId], truncated: false, parent_validated: true, retrieval_method: "ketch" as const },
		{ v: 1, card_id: "b".repeat(32), original_url: urls[1], content_sha256: "b".repeat(64), claim_ids: [claimId], truncated: false, parent_validated: true, retrieval_method: "ketch" as const },
	];
	(globalThis as Record<string, unknown>).__pi_plan_validation_urls = urls;
	(globalThis as Record<string, unknown>)[RESEARCH_EVIDENCE_CARDS_KEY] = cards;
	const now = new Date().toISOString();
	const item = {
		id: "research-root", kind: "research_branch" as const, owner_ref: ownerRef(runId, "research-root"), title: "Validated evidence", status: "done" as const,
		budget: { allocated: { searches: 2, reads: 2 }, used: { searches: 0, reads: 0 } }, source_leads: urls, claim_ids: [claimId],
		coverage: { strategy: "direct" as const, scope: "bounded" as const, returned_count: 1, truncated: false, budget_exhausted: false, failed: false, complete: true },
	};
	const state: GraphPlanState = {
		schema_version: 5, run_id: runId, request: "Fake claim", summary: "ready", autonomy: "lean", phase: "executing", created_at: now, updated_at: now,
		items: [item], profile: { name: "deep-research", max_depth: 2, max_children: 2, discovery_budget: { searches: 3, reads: 5 }, validation_reads: 5 },
		research_round_contract: "v1", head_terminal_at: now,
	};
	const statePath = privatePlanStatePath(cwd, process.env) ?? join(cwd, ".pi", "plan-state.json");
	mkdirSync(join(cwd, ".pi"), { recursive: true });
	writeFileSync(statePath, `${JSON.stringify(state)}\n`, { mode: 0o600 });

	const obligation = { claim_id: claimId, text: "fake claim", required: true, status: "open" as const, missing: "Parent evidence", why: "Required claim", next_action: "Validate source" };
	const ledger = new ResearchRoundLedger({ run_id: runId, obligations: [obligation] });
	ledger.recordRound({
		schema: "pi.research-round/v1", run_id: runId, round_id: "parent-validation", selected_gaps: [`gap-${claimId}`], queries: [], source_leads: [],
		reads: urls.map((url) => ({ url, phase: "parent_validation" as const, method: "ketch" as const, outcome: "completed" as const, truncated: false, parent_validated: true })),
		evidence_cards: cards.map(({ v: _v, ...card }) => card), conflicts: [], gaps: [], proposed_next_action: "synthesize",
	});
	ledger.settle({ graph_terminal: true, reason: "Parent validation complete" });
	await writeResearchRoundLedger(researchRoundPath(cwd, runId, process.env), ledger.state);

	const bus = createEventBus();
	const runtime = createExtensionRuntime();
	const extensions = await loadExtensionFromFactory(planRunner, cwd, bus, runtime, "g04-plan-runner");
	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [extensions], errors: [], runtime }), getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined, getAppendSystemPrompt: () => [], extendResources: () => undefined, reload: async () => undefined,
	};
	let requests = 0;
	const requestTexts: string[] = [];
	const agent = new Agent({
		initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] }, convertToLlm,
		streamFn: (_model, context) => {
			requests += 1;
			requestTexts.push(context.messages.map((message) => typeof message.content === "string" ? message.content : Array.isArray(message.content) ? message.content.map((part) => part.type === "text" ? part.text : "[tool]").join("\n") : message.role).join(" | "));
			const stream = createAssistantMessageEventStream();
			const message = requests === 1
				? { ...assistantText(), content: [{ type: "toolCall" as const, id: "g04-settle", name: "plan_settle", arguments: { summary: "verified", final_answer: `The answer is supported by ${urls[0]} and ${urls[1]}.` } }], stopReason: "toolUse" as const }
				: assistantText();
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			return stream;
		},
	});
	const session = new AgentSession({
		agent, cwd, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory(), resourceLoader,
		modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory({ test: { type: "api_key", key: "scripted-no-network" } })),
		initialActiveToolNames: ["plan_settle"], baseToolsOverride: {},
	});
	await session.bindExtensions({ onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`) });
	session.setActiveToolsByName(["plan_settle"]);
	await session.sendUserMessage("synthesize the validated research");
	await session.waitForIdle();

	assert.equal(requests, 1, "plan_settle terminates the provider turn after delivering the answer");
	const entries = session.sessionManager.getEntries();
	assert.equal(entries.filter((entry) => entry.type === "message" && JSON.stringify(entry).includes("The answer is supported")).length >= 1, true, "the real session persists the tool-delivered final answer");
	const settled = JSON.parse(String(await import("node:fs/promises").then((fs) => fs.readFile(statePath, "utf8"))));
	assert.equal(typeof settled.settled_at, "string");
	assert.match(requestTexts[0]!, /synthesize the validated research/);

	// A late child signal is not allowed to restart a settled head or enqueue a
	// second provider turn. The durable state remains byte-for-byte stable.
	const before = JSON.stringify(settled);
	const { HARNESS_SIGNAL_CHANNEL } = await import("../lib/harness-signals.ts");
	bus.emit(HARNESS_SIGNAL_CHANNEL, {
		v: 1, type: "plan/branch-result",
		context: { v: 1, profile: "deep-research", run_id: runId, parent_item_id: "research-root", owner_ref: ownerRef(runId, "research-root"), depth: 1, budget: { searches: 1, reads: 1 }, limits: { max_depth: 2, max_children: 2 }, lease_id: "late-lease", dispatch_epoch: 0 },
		report: { v: 1, parent_item_id: "research-root", owner_ref: ownerRef(runId, "research-root"), status: "done", note: "late", consumed: { searches: 1, reads: 1 }, evidence_gaps: [], children: [], source_leads: [{ url: urls[0], claim: "fake claim", quote: "untrusted" }], coverage: { ...item.coverage } }, failureClass: null,
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	const after = JSON.stringify(JSON.parse(String(await import("node:fs/promises").then((fs) => fs.readFile(statePath, "utf8")) )));
	assert.equal(after, before);
	assert.equal(requests, 1, "late branch evidence cannot restart the settled session");
});

test("G04-A: a real Pi compaction and fresh session preserve an outstanding research reservation", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-g04-recovery-"));
	const runId = "g04-recovery";
	const ledger = new ResearchRoundLedger({ run_id: runId, obligations: [{ claim_id: "claim", text: "claim", required: true, status: "open", missing: "source", why: "evidence", next_action: "read" }] });
	ledger.reserveChild("child-owner", { searches: 1, reads: 1, validation_reads: 0 });
	await writeResearchRoundLedger(researchRoundPath(cwd, runId, process.env), ledger.state);
	const bus = createEventBus();
	const runtime = createExtensionRuntime();
	const compaction = await loadExtensionFromFactory((pi) => {
		pi.on("session_before_compact", async (event: any) => ({ compaction: {
			summary: "G04 recovery fixture retained the research ledger reservation.", firstKeptEntryId: event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore, estimatedTokensAfter: 8, details: { source: "g04-real-agent-session" },
		} }));
	}, cwd, bus, runtime, "g04-compaction-source");
	const runner = await loadExtensionFromFactory(planRunner, cwd, bus, runtime, "g04-plan-runner-recovery");
	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [compaction, runner], errors: [], runtime }), getSkills: () => ({ skills: [], diagnostics: [] }),
		getPrompts: () => ({ prompts: [], diagnostics: [] }), getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined, getAppendSystemPrompt: () => [], extendResources: () => undefined, reload: async () => undefined,
	};
	const sessionManager = SessionManager.inMemory(cwd);
	for (let index = 0; index < 6; index += 1) {
		sessionManager.appendMessage({ role: "user", content: `old research context ${index}`, timestamp: Date.now() } as any);
		sessionManager.appendMessage({ role: "assistant", content: [{ type: "text", text: `old research result ${index}` }], api: model.api, provider: model.provider, model: model.id, stopReason: "stop", timestamp: Date.now(), usage: assistantText().usage } as any);
	}
	const agent = new Agent({
		initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] }, convertToLlm,
		streamFn: () => { const stream = createAssistantMessageEventStream(); const message = assistantText(); stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); return stream; },
	});
	const session = new AgentSession({
		agent, cwd, sessionManager, settingsManager: SettingsManager.inMemory({ compaction: { keepRecentTokens: 1 } }), resourceLoader,
		modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory({ test: { type: "api_key", key: "scripted-no-network" } })), initialActiveToolNames: [], baseToolsOverride: {},
	});
	await session.bindExtensions({ onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`) });
	await session.sendUserMessage("preserve the research state");
	await session.waitForIdle();
	await session.compact("Keep the research reservation and unresolved claim gap.");
	const afterCompact = await import("node:fs/promises").then((fs) => fs.readFile(researchRoundPath(cwd, runId, process.env), "utf8"));
	assert.deepEqual(JSON.parse(afterCompact).budget.reserved, { searches: 1, reads: 1, validation_reads: 0 });

	// Recovery is a new Pi session, not merely an in-memory object reload.
	const recoveredAgent = new Agent({ initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] }, convertToLlm, streamFn: () => { const stream = createAssistantMessageEventStream(); const message = assistantText(); stream.push({ type: "start", partial: message }); stream.push({ type: "done", reason: "stop", message }); return stream; } });
	const recovered = new AgentSession({
		agent: recoveredAgent, cwd, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory(), resourceLoader,
		modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory({ test: { type: "api_key", key: "scripted-no-network" } })), initialActiveToolNames: [], baseToolsOverride: {},
	});
	await recovered.bindExtensions({ onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`) });
	const recoveredLedger = await import("../lib/research-round.ts").then(async (module) => module.readResearchRoundLedger(researchRoundPath(cwd, runId, process.env)));
	assert.deepEqual(recoveredLedger?.budget.reserved, { searches: 1, reads: 1, validation_reads: 0 });
	assert.equal(recoveredLedger?.gaps[0]?.status, "open");
});
