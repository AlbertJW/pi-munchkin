import { createHash } from "node:crypto";
import { classifyBashCommand } from "./command-policy.ts";

const MAX_TEXT_BYTES = 4 * 1024 * 1024;
const MAX_SHINGLES = 100_000;
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit", "hashline_edit"]);

// Near-duplicate detection (bottom-k sketch, not banded MinHash: one 32-bit
// FNV hash per 3-char shingle + keep the k smallest, instead of k hash
// functions per shingle — ~64x cheaper, and this runs on EVERY model call).
// Similarity = |sketchA ∩ sketchB| / k, an adequate Jaccard estimate for a
// telemetry share. Blocks under 256 bytes are noise; blocks are sketched on
// their first 8 KB only; candidate count bounded.
const SKETCH_K = 64;
const SKETCH_MIN_BLOCK_BYTES = 256;
const SKETCH_MAX_BLOCK_BYTES = 8192;
const SKETCH_MAX_BLOCKS = 512;
const NEAR_DUP_SIMILARITY = 0.5;

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
	near_duplicate_block_share: number;
	prefix_stable: boolean | null;
	appended_only: boolean | null;
	system_prompt_changed: boolean | null;
	context_tokens: number | null;
	context_window: number | null;
	context_pct: number | null;
	compaction_generation: number;
	plan_run_id: string | null;
	plan_item_id: string | null;
};

// Cross-call comparison anchor for the KV-cache invariants: the previous
// call's PER-MESSAGE hash sequence + system-prompt sha. Message-level, via
// the same stableHash that binds surface_sha256, so roles, boundaries,
// toolResult metadata, bashExecution/summary fields, and unknown block types
// are all covered by construction — content-block hashing alone provably
// missed metadata-only changes. Held by the extension in module state, reset
// on session start/compaction.
export type ContextSurfacePrior = { messageHashes: string[]; systemSha: string };

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

// 32-bit FNV-1a over a 3-char shingle starting at `from`.
function shingleHash(text: string, from: number): number {
	let hash = 0x811c9dc5;
	for (let i = from; i < from + 3; i += 1) {
		hash ^= text.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// Bottom-k sketch of a block's 3-char shingle set: the k smallest distinct
// shingle hashes, sorted ascending.
function bottomKSketch(text: string): number[] {
	const bounded = text.length > SKETCH_MAX_BLOCK_BYTES ? text.slice(0, SKETCH_MAX_BLOCK_BYTES) : text;
	const hashes = new Set<number>();
	for (let i = 0; i + 3 <= bounded.length; i += 1) hashes.add(shingleHash(bounded, i));
	return [...hashes].sort((a, b) => a - b).slice(0, SKETCH_K);
}

// Bottom-k Jaccard estimate: of the k smallest hashes in the UNION of the
// two sketches, the fraction present in both. Dividing by the smaller sketch
// (the naive choice) makes containment read as identity — a one-shingle
// block "inside" a big unrelated block would score 100%. Sketches below a
// minimum cardinality are too low-entropy to compare at all.
const SKETCH_MIN_CARDINALITY = 16;
function sketchSimilarity(a: number[], b: number[]): number {
	if (a.length < SKETCH_MIN_CARDINALITY || b.length < SKETCH_MIN_CARDINALITY) return 0;
	let i = 0, j = 0, shared = 0, unionSeen = 0;
	while (unionSeen < SKETCH_K && (i < a.length || j < b.length)) {
		if (i < a.length && j < b.length && a[i] === b[j]) { shared += 1; i += 1; j += 1; }
		else if (j >= b.length || (i < a.length && a[i] < b[j])) i += 1;
		else j += 1;
		unionSeen += 1;
	}
	return unionSeen === 0 ? 0 : shared / unionSeen;
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
	prior?: ContextSurfacePrior | null,
): { receipt: ContextSurfaceReceipt; messageHashes: string[] } {
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
	const sketchCandidates: Array<{ hash: string; text: string; bytes: number }> = [];

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
				if (size >= SKETCH_MIN_BLOCK_BYTES && sketchCandidates.length < SKETCH_MAX_BLOCKS) {
					sketchCandidates.push({ hash: blockHashes[blockHashes.length - 1], text, bytes: size });
				}
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

	// Near-duplicates: a later block whose sketch matches an EARLIER block at
	// ≥ NEAR_DUP_SIMILARITY but whose exact hash differs — "near but not exact",
	// deliberately disjoint from exact_duplicate_block_share so the two fields
	// decompose the redundancy rather than double-count it.
	let nearDupBytes = 0;
	{
		const seenExact = new Set<string>();
		const keptSketches: number[][] = [];
		for (const cand of sketchCandidates) {
			if (seenExact.has(cand.hash)) continue; // exact repeat — counted in the exact share
			seenExact.add(cand.hash);
			const sketch = bottomKSketch(cand.text);
			if (keptSketches.some((prev) => sketchSimilarity(prev, sketch) >= NEAR_DUP_SIMILARITY)) {
				nearDupBytes += cand.bytes;
			} else {
				keptSketches.push(sketch);
			}
		}
	}

	// KV-cache invariants vs the previous call: an unchanged shared region
	// (prefix_stable) and pure appends (appended_only) are what llama.cpp's
	// prefix cache can reuse; a mutated early message forces a re-prefill.
	// Whole-message hashes, so metadata-only mutations are caught too.
	const messageHashes = messages.map((message) => stableHash(message));
	let prefixStable: boolean | null = null;
	let appendedOnly: boolean | null = null;
	let systemPromptChanged: boolean | null = null;
	if (prior) {
		const shared = Math.min(prior.messageHashes.length, messageHashes.length);
		prefixStable = prior.messageHashes.slice(0, shared).every((hash, index) => hash === messageHashes[index]);
		appendedOnly = prefixStable && messageHashes.length >= prior.messageHashes.length;
		systemPromptChanged = prior.systemSha !== system.sha256;
	}

	const receipt: ContextSurfaceReceipt = {
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
		near_duplicate_block_share: roundShare(totalMessageBytes ? nearDupBytes / totalMessageBytes : 0),
		prefix_stable: prefixStable,
		appended_only: appendedOnly,
		system_prompt_changed: systemPromptChanged,
		context_tokens: usage?.tokens ?? null,
		context_window: usage?.contextWindow ?? null,
		context_pct: usage?.percent ?? null,
		compaction_generation: meta.compactionGeneration ?? 0,
		plan_run_id: meta.planRunId ?? null,
		plan_item_id: meta.planItemId ?? null,
	};
	return { receipt, messageHashes };
}
