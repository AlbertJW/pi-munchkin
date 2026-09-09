import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Agent } from "@earendil-works/pi-agent-core";
import {
	AgentSession, AuthStorage, createEventBus, ModelRegistry, SessionManager, SettingsManager, convertToLlm, type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { createExtensionRuntime, loadExtensionFromFactory } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { createAssistantMessageEventStream, type AssistantMessage, type Model } from "@earendil-works/pi-ai";

const previousVision = process.env.VISION;
process.env.VISION = "on";
const { registerVisualTools } = await import(`../extensions/visual-observe.ts?agent-session=${Date.now()}-${Math.random()}`);
if (previousVision === undefined) delete process.env.VISION; else process.env.VISION = previousVision;

function assistantMessage(model: Model<"scripted">, content: AssistantMessage["content"], stopReason: AssistantMessage["stopReason"]): AssistantMessage {
	return {
		role: "assistant", content, api: model.api, provider: model.provider, model: model.id, stopReason, timestamp: Date.now(),
		usage: { input: 2, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 4, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
}

test("a real AgentSession delivers a fresh visual image block to a vision model", async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-visual-agent-session-"));
	const model = {
		id: "scripted-vision", name: "scripted vision", api: "scripted", provider: "fixture", baseUrl: "http://127.0.0.1:1",
		reasoning: false, input: ["text", "image"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 1_024,
	} as Model<"scripted">;
	const bus = createEventBus();
	const runtime = createExtensionRuntime();
	const extension = await loadExtensionFromFactory((pi) => registerVisualTools(pi, {
		sessionId: "agent-session-visual",
		capture: async () => ({ bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: "image/jpeg", width: 320, height: 200 }),
	}), cwd, bus, runtime, "visual-agent-session");
	const resourceLoader: ResourceLoader = {
		getExtensions: () => ({ extensions: [extension], errors: [], runtime }),
		getSkills: () => ({ skills: [], diagnostics: [] }), getPrompts: () => ({ prompts: [], diagnostics: [] }),
		getThemes: () => ({ themes: [], diagnostics: [] }), getAgentsFiles: () => ({ agentsFiles: [] }),
		getSystemPrompt: () => undefined, getAppendSystemPrompt: () => [], extendResources: () => undefined, reload: async () => undefined,
	};
	let requests = 0;
	let imageDelivered = false;
	const agent = new Agent({
		initialState: { systemPrompt: "", model, thinkingLevel: "off", tools: [] }, convertToLlm,
		streamFn: (_model, context) => {
			requests += 1;
			if (requests === 2) {
				imageDelivered = context.messages.some((message) => Array.isArray(message.content) && message.content.some((part) => part.type === "image"));
			}
			const stream = createAssistantMessageEventStream();
			const message = requests === 1
				? assistantMessage(model, [{ type: "toolCall", id: "visual-call", name: "visual_observe", arguments: { source: "screen", source_id: "window-a", question: "what is visible?" } }], "toolUse")
				: assistantMessage(model, [{ type: "text", text: "The screenshot was delivered to the vision model." }], "stop");
			stream.push({ type: "start", partial: message });
			stream.push({ type: "done", reason: "stop", message });
			return stream;
		},
	});
	const session = new AgentSession({
		agent, cwd, sessionManager: SessionManager.inMemory(cwd), settingsManager: SettingsManager.inMemory(), resourceLoader,
		modelRegistry: ModelRegistry.inMemory(AuthStorage.inMemory({ fixture: { type: "api_key", key: "no-network" } })),
		initialActiveToolNames: ["visual_observe"], baseToolsOverride: {},
	});
	await session.bindExtensions({ onError: (error) => assert.fail(`${error.extensionPath}:${error.event}:${error.error}`) });
	session.setActiveToolsByName(["visual_observe"]);
	await session.sendUserMessage("inspect the current screen");
	await session.waitForIdle();

	assert.equal(requests, 2, "the scripted provider saw the tool call and the returned visual evidence");
	assert.equal(imageDelivered, true, "the production AgentSession conversion preserved the image content block");
});
