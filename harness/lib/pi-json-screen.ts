import { createHash } from "node:crypto";

type JsonRecord = Record<string, unknown>;

export type PiJsonScreenStats = {
	bash_starts: number;
	bash_ends: number;
	bash_errors: number;
	max_visible_bash_chars: number;
	/** Counts only stable Pi builtin names; never captures model-controlled tool labels. */
	tool_starts: Record<string, number>;
	tool_ends: Record<string, number>;
	tool_errors: Record<string, number>;
	final_text_sha256: string | null;
	final_text_bytes: number;
};

const SAFE_TOOL_NAMES = new Set(["bash", "read", "grep", "find", "edit", "write"]);

function increment(target: Record<string, number>, name: unknown): void {
	if (typeof name !== "string" || !SAFE_TOOL_NAMES.has(name)) return;
	target[name] = (target[name] ?? 0) + 1;
}

function textChars(value: unknown): number {
	if (!Array.isArray(value)) return 0;
	return value.reduce((total, part) => total + (part && typeof part === "object" && (part as JsonRecord).type === "text" && typeof (part as JsonRecord).text === "string" ? ((part as JsonRecord).text as string).length : 0), 0);
}

function finalText(value: unknown): string | null {
	if (!Array.isArray(value)) return null;
	for (let index = value.length - 1; index >= 0; index -= 1) {
		const item = value[index] as JsonRecord | undefined;
		if (!item || item.role !== "assistant" || !Array.isArray(item.content)) continue;
		for (const part of item.content) {
			if (part && typeof part === "object" && (part as JsonRecord).type === "text" && typeof (part as JsonRecord).text === "string") return (part as JsonRecord).text as string;
		}
	}
	return null;
}

/** Convert ephemeral Pi JSON mode output into safe, content-free outcome facts. */
export function summarizePiJsonScreen(text: string): PiJsonScreenStats {
	const stats: PiJsonScreenStats = { bash_starts: 0, bash_ends: 0, bash_errors: 0, max_visible_bash_chars: 0, tool_starts: {}, tool_ends: {}, tool_errors: {}, final_text_sha256: null, final_text_bytes: 0 };
	for (const line of text.split("\n")) {
		let event: JsonRecord;
		try { event = JSON.parse(line) as JsonRecord; } catch { continue; }
		if (event.type === "tool_execution_start") increment(stats.tool_starts, event.toolName);
		if (event.type === "tool_execution_end") {
			increment(stats.tool_ends, event.toolName);
			if (event.isError === true) increment(stats.tool_errors, event.toolName);
		}
		if (event.type === "tool_execution_start" && event.toolName === "bash") stats.bash_starts += 1;
		if (event.type === "tool_execution_end" && event.toolName === "bash") {
			stats.bash_ends += 1;
			if (event.isError === true) stats.bash_errors += 1;
			const result = event.result as JsonRecord | undefined;
			stats.max_visible_bash_chars = Math.max(stats.max_visible_bash_chars, textChars(result?.content));
		}
		if (event.type === "agent_end") {
			const final = finalText(event.messages);
			if (final !== null) {
				stats.final_text_sha256 = createHash("sha256").update(final).digest("hex");
				stats.final_text_bytes = Buffer.byteLength(final, "utf8");
			}
		}
	}
	return stats;
}
