// Content-hash read-dedup (gitlord's context.py idea): small models re-read
// the same files constantly; every identical re-read burns window bytes AND
// pushes the model to re-derive stale conclusions. This collapses a repeated
// identical `read` result into a one-line back-reference.
//
// The LATER duplicate is replaced, never the earlier one — load-bearing: the
// provider-visible prefix stays byte-identical across calls, so llama.cpp's
// prefix cache is preserved (context-surface's prefix_stable receipt field
// verifies exactly this), and the stub doubles as a steer against re-reading.
//
// Stateless per call: the map is recomputed from the messages themselves, so
// compaction / rewind / fork need no special-casing.
import { createHash } from "node:crypto";
import { steerText } from "./steer-texts.ts";

type ContextMessage = Record<string, unknown>;
type ContentBlock = Record<string, unknown>;

const sha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

function textOf(message: ContextMessage): string {
	const content = message.content;
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => (block as ContentBlock)?.type === "text" ? String((block as ContentBlock).text ?? "") : "")
		.join("\n");
}

export function dedupReadResults(
	messages: readonly unknown[],
): { messages: unknown[]; replaced: number; savedBytes: number } | null {
	// Pair read toolCalls (id → path) so results can be labeled by path.
	const pathByCallId = new Map<string, string>();
	for (const raw of messages) {
		const message = (raw ?? {}) as ContextMessage;
		if (!Array.isArray(message.content)) continue;
		for (const rawBlock of message.content) {
			const block = (rawBlock ?? {}) as ContentBlock;
			if (block.type !== "toolCall" || String(block.name ?? "") !== "read") continue;
			const id = String(block.id ?? "");
			const path = String((block.arguments as Record<string, unknown> | undefined)?.path ?? "");
			if (id && path) pathByCallId.set(id, path);
		}
	}

	const firstSeen = new Map<string, number>(); // `${path}\0${hash}` → message index of the kept copy
	let replaced = 0;
	let savedBytes = 0;
	const out = messages.map((raw, index) => {
		const message = (raw ?? {}) as ContextMessage;
		if (message.role !== "toolResult" || String(message.toolName ?? "") !== "read" || message.isError === true) return raw;
		const path = pathByCallId.get(String(message.toolCallId ?? ""));
		if (!path) return raw;
		const text = textOf(message);
		if (!text) return raw;
		const key = `${path}\0${sha256(text)}`;
		const kept = firstSeen.get(key);
		if (kept === undefined) {
			firstSeen.set(key, index);
			return raw;
		}
		const stub = steerText(
			"READ_DEDUP_STUB",
			"[read {path}: identical to the result at message #{kept} — content unchanged; do not re-read]",
			{ path, kept },
		);
		// Only ever SHRINK the context: a stub longer than the tiny result it
		// replaces would enlarge the window, and savedBytes stays non-negative
		// by construction.
		const saved = Buffer.byteLength(text, "utf8") - Buffer.byteLength(stub, "utf8");
		if (saved <= 0) return raw;
		replaced += 1;
		savedBytes += saved;
		return { ...message, content: [{ type: "text", text: stub }] };
	});
	return replaced > 0 ? { messages: out, replaced, savedBytes } : null;
}
