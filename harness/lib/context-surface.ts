import { createHash } from "node:crypto";
import { classifyBashCommand } from "./command-policy.ts";

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_SHINGLES = 100_000;
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "hashline_edit"]);

type ContentBlock = Record<string, unknown>;
type ContextMessage = Record<string, unknown>;

export type SystemPromptReceipt = { sha256: string; bytes: number };
export type ContextSurfaceReceipt = {
	surface_sha256: string;
	system_prompt_sha256: string;
	system_prompt_bytes: number;
	message_count: number;
	user_messages: number;
	assistant_messages: number;
	tool_messages: number;
	custom_messages: number;
	user_text_bytes: number;
	assistant_text_bytes: number;
	tool_text_bytes: number;
	custom_text_bytes: number;
	image_count: number;
	image_bytes: number;
	tool_names: string[];
	tool_result_bytes: number[];
	largest_message_share: number;
	largest_tool_result_share: number;
	exact_duplicate_block_share: number;
	repeated_five_token_shingle_share: number;
	stale_tool_result_share: number;
	context_tokens: number | null;
	context_window: number | null;
	context_pct: number | null;
	compaction_generation: number;
	plan_run_id: string | null;
	plan_item_id: string | null;
};

function sha256(value: string | Buffer): string {
	return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
	return `{${Object.entries(value as Record<string, unknown>)
		.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
		.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(",")}}`;
}

function stableHash(value: unknown): string {
	const hash = createHash("sha256");
	const visit = (item: unknown): void => {
		if (item === null || typeof item !== "object") {
			hash.update(JSON.stringify(item) ?? "null");
			return;
		}
		if (Array.isArray(item)) {
			hash.update("[");
			item.forEach((entry, index) => { if (index) hash.update(","); visit(entry); });
			hash.update("]");
			return;
		}
		hash.update("{");
		Object.entries(item as Record<string, unknown>)
			.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
			.forEach(([key, entry], index) => {
				if (index) hash.update(",");
				hash.update(JSON.stringify(key)); hash.update(":"); visit(entry);
			});
		hash.update("}");
	};
	visit(value);
	return hash.digest("hex");
}

function utf8Bytes(value: string): number {
	return Buffer.byteLength(value, "utf8");
}

function roundShare(value: number): number {
	return Math.round(Math.max(0, Math.min(1, value)) * 1_000_000) / 1_000_000;
}

export function systemPromptReceipt(systemPrompt: string): SystemPromptReceipt {
	return { sha256: sha256(systemPrompt), bytes: utf8Bytes(systemPrompt) };
}

function contentOf(message: ContextMessage): unknown[] {
	const content = message.content;
	return Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
}

function roleBucket(role: string): "user" | "assistant" | "tool" | "custom" {
	if (role === "user") return "user";
	if (role === "assistant") return "assistant";
	if (role === "toolResult") return "tool";
	return "custom";
}

export function buildContextSurfaceReceipt(
	messages: readonly unknown[],
	system: SystemPromptReceipt,
	usage: { tokens: number | null; contextWindow: number; percent: number | null } | undefined,
	meta: { compactionGeneration?: number; planRunId?: string; planItemId?: string } = {},
): ContextSurfaceReceipt {
	const roleMessages = { user: 0, assistant: 0, tool: 0, custom: 0 };
	const roleBytes = { user: 0, assistant: 0, tool: 0, custom: 0 };
	const messageBytes: number[] = [];
	const blockHashes: string[] = [];
	const blockBytes: number[] = [];
	const textForShingles: string[] = [];
	const toolBytes = new Map<string, number>();
	const toolResultPositions: Array<{ index: number; bytes: number }> = [];
	let lastSuccessfulMutation = -1;
	let imageCount = 0;
	let imageBytes = 0;
	let scannedTextBytes = 0;
	const mutatingCalls = new Set<string>();

	for (let index = 0; index < messages.length; index += 1) {
		const message = (messages[index] ?? {}) as ContextMessage;
		const role = String(message.role ?? "custom");
		const bucket = roleBucket(role);
		roleMessages[bucket] += 1;
		let bytes = 0;
		for (const rawBlock of contentOf(message)) {
			const block = (rawBlock ?? {}) as ContentBlock;
			const type = String(block.type ?? "unknown");
			if (type === "text" || type === "thinking") {
				const text = String(type === "thinking" ? block.thinking ?? "" : block.text ?? "");
				const size = utf8Bytes(text);
				bytes += size;
				blockBytes.push(size);
				blockHashes.push(sha256(`${type}\0${text}`));
				if (scannedTextBytes < MAX_TEXT_BYTES) {
					const remaining = MAX_TEXT_BYTES - scannedTextBytes;
					const bounded = Buffer.from(text, "utf8").subarray(0, remaining).toString("utf8");
					textForShingles.push(bounded);
					scannedTextBytes += utf8Bytes(bounded);
				}
			} else if (type === "image") {
				const data = String(block.data ?? "");
				const decodedBytes = Buffer.from(data, "base64").length;
				const digest = sha256(Buffer.from(data, "base64"));
				bytes += decodedBytes;
				imageCount += 1;
				imageBytes += decodedBytes;
				blockBytes.push(decodedBytes);
				blockHashes.push(sha256(`image\0${String(block.mimeType ?? "unknown")}\0${digest}`));
			} else if (type === "toolCall") {
				const name = String(block.name ?? "unknown");
				const serialized = stableStringify(block.arguments ?? {});
				const size = utf8Bytes(serialized);
				bytes += size;
				blockBytes.push(size);
				blockHashes.push(sha256(`toolCall\0${name}\0${serialized}`));
				const id = String(block.id ?? "");
				const command = String((block.arguments as Record<string, unknown> | undefined)?.command ?? "");
				if (id && (MUTATION_TOOLS.has(name) || (name === "bash" && classifyBashCommand(command).mutates))) {
					mutatingCalls.add(id);
				}
			}
		}
		if (role === "bashExecution") {
			const command = String(message.command ?? "");
			const output = String(message.output ?? "");
			bytes += utf8Bytes(command) + utf8Bytes(output);
		}
		if (role === "branchSummary" || role === "compactionSummary") {
			const summary = String(message.summary ?? "");
			bytes += utf8Bytes(summary);
		}
		roleBytes[bucket] += bytes;
		messageBytes.push(bytes);
		if (role === "toolResult") {
			const name = String(message.toolName ?? "unknown");
			toolBytes.set(name, (toolBytes.get(name) ?? 0) + bytes);
			toolResultPositions.push({ index, bytes });
			const callId = String(message.toolCallId ?? "");
			if (message.isError !== true && (MUTATION_TOOLS.has(name) || mutatingCalls.has(callId))) lastSuccessfulMutation = index;
		}
	}

	const totalMessageBytes = messageBytes.reduce((sum, value) => sum + value, 0);
	const totalToolBytes = [...toolBytes.values()].reduce((sum, value) => sum + value, 0);
	const seenBlocks = new Set<string>();
	let duplicateBytes = 0;
	for (let index = 0; index < blockHashes.length; index += 1) {
		if (seenBlocks.has(blockHashes[index])) duplicateBytes += blockBytes[index];
		else seenBlocks.add(blockHashes[index]);
	}
	const words = textForShingles.join(" ").normalize("NFKC").toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
	const shingleCounts = new Map<string, number>();
	let shingleTotal = 0;
	let shingleRepeated = 0;
	for (let index = 0; index + 4 < words.length && shingleTotal < MAX_SHINGLES; index += 1) {
		const shingle = words.slice(index, index + 5).join(" ");
		const count = shingleCounts.get(shingle) ?? 0;
		if (count > 0) shingleRepeated += 1;
		shingleCounts.set(shingle, count + 1);
		shingleTotal += 1;
	}
	const staleBytes = lastSuccessfulMutation < 0 ? 0 : toolResultPositions
		.filter((result) => result.index < lastSuccessfulMutation)
		.reduce((sum, result) => sum + result.bytes, 0);
	const sortedTools = [...toolBytes.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);

	return {
		surface_sha256: stableHash({ system, messages }),
		system_prompt_sha256: system.sha256,
		system_prompt_bytes: system.bytes,
		message_count: messages.length,
		user_messages: roleMessages.user,
		assistant_messages: roleMessages.assistant,
		tool_messages: roleMessages.tool,
		custom_messages: roleMessages.custom,
		user_text_bytes: roleBytes.user,
		assistant_text_bytes: roleBytes.assistant,
		tool_text_bytes: roleBytes.tool,
		custom_text_bytes: roleBytes.custom,
		image_count: imageCount,
		image_bytes: imageBytes,
		tool_names: sortedTools.map(([name]) => name),
		tool_result_bytes: sortedTools.map(([, value]) => value),
		largest_message_share: roundShare(totalMessageBytes ? Math.max(0, ...messageBytes) / totalMessageBytes : 0),
		largest_tool_result_share: roundShare(totalToolBytes ? Math.max(0, ...toolResultPositions.map((result) => result.bytes)) / totalToolBytes : 0),
		exact_duplicate_block_share: roundShare(totalMessageBytes ? duplicateBytes / totalMessageBytes : 0),
		repeated_five_token_shingle_share: roundShare(shingleTotal ? shingleRepeated / shingleTotal : 0),
		stale_tool_result_share: roundShare(totalToolBytes ? staleBytes / totalToolBytes : 0),
		context_tokens: usage?.tokens ?? null,
		context_window: usage?.contextWindow ?? null,
		context_pct: usage?.percent ?? null,
		compaction_generation: meta.compactionGeneration ?? 0,
		plan_run_id: meta.planRunId ?? null,
		plan_item_id: meta.planItemId ?? null,
	};
}
