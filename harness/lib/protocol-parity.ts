/**
 * Redacted protocol-parity facts. This is deliberately a diagnostic, not a
 * second provider implementation: it records what Pi declares and what the
 * stream actually exposed, without retaining prompts, payloads, or thinking.
 */

export type ProtocolObservation = {
	textDeltas: number;
	thinkingDeltas: number;
	toolCallDeltas: number;
	assistantMessages: number;
	thinkingBlocks: number;
	toolCallBlocks: number;
};

export type ProtocolParitySummary = {
	api: "openai-completions" | "mistral-conversations" | "openai-responses" |
		"azure-openai-responses" | "openai-codex-responses" | "anthropic-messages" |
		"bedrock-converse-stream" | "google-generative-ai" | "google-vertex" |
		"custom" | "unknown";
	reasoning: "enabled" | "disabled" | "unknown";
	thinkingFormat: "openai" | "openrouter" | "deepseek" | "together" | "zai" | "qwen" | "chat-template" | "qwen-chat-template" | "string-thinking" | "ant-ling" | "unknown";
	thinkingLevels: number;
	strictSampling: "true" | "false" | "unspecified" | "not-applicable" | "unknown";
	streamShape: "thinking+toolcalls" | "thinking" | "toolcalls" | "text-only" | "mixed" | "unknown";
	thinkingObserved: boolean;
	toolCallsObserved: boolean;
};

const FORMATS = new Set<ProtocolParitySummary["thinkingFormat"]>([
	"openai", "openrouter", "deepseek", "together", "zai", "qwen", "chat-template",
	"qwen-chat-template", "string-thinking", "ant-ling",
]);

const KNOWN_APIS = new Set<ProtocolParitySummary["api"]>([
	"openai-completions", "mistral-conversations", "openai-responses", "azure-openai-responses",
	"openai-codex-responses", "anthropic-messages", "bedrock-converse-stream",
	"google-generative-ai", "google-vertex",
]);

const atom = (value: unknown, fallback = "unknown"): string => {
	const text = String(value ?? "").replace(/[\r\n\t]/g, " ").trim().slice(0, 64);
	return text || fallback;
};

export function protocolApiFamily(value: unknown): ProtocolParitySummary["api"] {
	if (typeof value !== "string" || value.length === 0) return "unknown";
	return KNOWN_APIS.has(value as ProtocolParitySummary["api"])
		? value as ProtocolParitySummary["api"] : "custom";
}

export function emptyProtocolObservation(): ProtocolObservation {
	return { textDeltas: 0, thinkingDeltas: 0, toolCallDeltas: 0, assistantMessages: 0, thinkingBlocks: 0, toolCallBlocks: 0 };
}

export function observeProtocolDelta(observation: ProtocolObservation, type: unknown, delta: unknown): void {
	if (typeof delta !== "string" || delta.length === 0) return;
	if (type === "text_delta") observation.textDeltas += 1;
	if (type === "thinking_delta") observation.thinkingDeltas += 1;
	if (type === "toolcall_delta") observation.toolCallDeltas += 1;
}

export function observeAssistantMessage(observation: ProtocolObservation, message: unknown): void {
	if (!message || typeof message !== "object") return;
	if ((message as { role?: unknown }).role !== "assistant") return;
	observation.assistantMessages += 1;
	const content = (message as { content?: unknown }).content;
	if (!Array.isArray(content)) return;
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const type = (block as { type?: unknown }).type;
		if (type === "thinking") observation.thinkingBlocks += 1;
		if (type === "toolCall") observation.toolCallBlocks += 1;
	}
}

function strictSampling(model: { api?: unknown; compat?: { supportsStrictMode?: unknown } } | undefined): ProtocolParitySummary["strictSampling"] {
	if (!model) return "unknown";
	if (model.api !== "openai-completions") return "not-applicable";
	if (model.compat?.supportsStrictMode === true) return "true";
	if (model.compat?.supportsStrictMode === false) return "false";
	return "unspecified";
}

export function summarizeProtocolParity(
	model: { api?: unknown; reasoning?: unknown; thinkingLevelMap?: unknown; compat?: { supportsStrictMode?: unknown; thinkingFormat?: unknown } } | undefined,
	observation: ProtocolObservation,
): ProtocolParitySummary {
	const format = atom(model?.compat?.thinkingFormat);
	const thinkingFormat = FORMATS.has(format as ProtocolParitySummary["thinkingFormat"])
		? format as ProtocolParitySummary["thinkingFormat"] : "unknown";
	const thinking = observation.thinkingDeltas > 0 || observation.thinkingBlocks > 0;
	const tools = observation.toolCallDeltas > 0 || observation.toolCallBlocks > 0;
	let streamShape: ProtocolParitySummary["streamShape"] = "unknown";
	if (thinking && tools) streamShape = "thinking+toolcalls";
	else if (thinking) streamShape = "thinking";
	else if (tools) streamShape = "toolcalls";
	else if (observation.textDeltas > 0) streamShape = "text-only";
	return {
		api: protocolApiFamily(model?.api),
		reasoning: model?.reasoning === true ? "enabled" : model?.reasoning === false ? "disabled" : "unknown",
		thinkingFormat,
		thinkingLevels: model?.thinkingLevelMap && typeof model.thinkingLevelMap === "object"
			? Object.keys(model.thinkingLevelMap).length : 0,
		strictSampling: strictSampling(model),
		streamShape,
		thinkingObserved: thinking,
		toolCallsObserved: tools,
	};
}
