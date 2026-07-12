// Pure span machinery for the span-tools extension (map-reduce minimal prototype).
// Manifest = per-content line-offset index; all outputs hard-capped so a tool
// call can never dump an unbounded corpus into the window.
import { createHash } from "node:crypto";

export const MAX_MATCHES = 20;
export const MAX_SPAN_LINES = 200;
export const MAX_OUT_BYTES = 8 * 1024;
export const MATCH_TEXT_CHARS = 200;

export function contentTag(text: string): string {
	return createHash("sha1").update(text).digest("hex").slice(0, 8);
}

export type SpanMatch = { line: number; text: string };

// Regex search over lines; capped matches, capped per-line excerpt, capped total bytes.
export function searchSpans(text: string, pattern: string, maxMatches = MAX_MATCHES): { matches: SpanMatch[]; total: number } {
	const re = new RegExp(pattern);
	const lines = text.split("\n");
	const matches: SpanMatch[] = [];
	let total = 0;
	let bytes = 0;
	for (let i = 0; i < lines.length; i++) {
		if (!re.test(lines[i])) continue;
		total++;
		if (matches.length >= maxMatches) continue; // keep counting total, stop collecting
		const excerpt = lines[i].length > MATCH_TEXT_CHARS ? `${lines[i].slice(0, MATCH_TEXT_CHARS)}…` : lines[i];
		bytes += excerpt.length;
		if (bytes > MAX_OUT_BYTES) break;
		matches.push({ line: i + 1, text: excerpt });
	}
	return { matches, total };
}

// Bounded slice with provenance. 1-indexed inclusive; clamps to caps and file bounds.
export function readSpan(
	text: string,
	startLine: number,
	endLine: number,
): { header: string; body: string; start: number; end: number } {
	const lines = text.split("\n");
	const totalLines = lines.length;
	const start = Math.max(1, Math.floor(startLine));
	let end = Math.min(totalLines, Math.max(start, Math.floor(endLine)), start + MAX_SPAN_LINES - 1);
	let body = "";
	let n = start;
	for (; n <= end; n++) {
		const next = `${n}:${lines[n - 1]}\n`;
		if (body.length + next.length > MAX_OUT_BYTES) break;
		body += next;
	}
	end = n - 1;
	const header = `[span #${contentTag(text)} lines ${start}-${end}/${totalLines}]`;
	return { header, body, start, end };
}
