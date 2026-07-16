import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import { Type } from "typebox";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveReadPath } from "../lib/context-inlet.ts";
import { buildSearchReceipt, MAX_MATCHES, MAX_SPAN_LINES, readSpan, searchSpans } from "../lib/span-index.ts";
import { record } from "../lib/telemetry.ts";

// span-tools: the map-reduce MINIMAL prototype (targeted-question path only).
// Two bounded tools for large structured files: search_spans (regex -> capped
// structured matches with line numbers) and read_span (bounded slice with
// provenance header). No LLM mapper, no reduce stage, no disk artifacts — the
// corpus-coverage path stays deferred until this measures a gap.
//
// DORMANT by default: SPAN_TOOLS=on enables (a munchkin candidate is then a
// pure env delta). Per-file cache keyed by (path, mtime) for the session.

const ENABLED = process.env.SPAN_TOOLS === "on";

type LoadedFile = { mtimeMs: number; text: string; normalizedPath: string; size: number; sha256: string };
const cache = new Map<string, LoadedFile>();

async function load(path: string): Promise<LoadedFile> {
	const info = await stat(path);
	const hit = cache.get(path);
	if (hit && hit.mtimeMs === info.mtimeMs && hit.size === info.size) return hit;
	const bytes = await readFile(path);
	const value: LoadedFile = {
		mtimeMs: info.mtimeMs,
		text: bytes.toString("utf8"),
		normalizedPath: await realpath(path),
		size: bytes.byteLength,
		sha256: createHash("sha256").update(bytes).digest("hex"),
	};
	cache.set(path, value);
	return value;
}

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.on("session_start", async () => {
		cache.clear();
	});

	pi.registerTool(
		defineTool({
			name: "search_spans",
			label: "Search spans",
			description:
				`Regex-search a (large) file line-by-line. Returns up to ${MAX_MATCHES} matches as ` +
				"`line:excerpt` plus the TOTAL match count. Use this instead of reading big files; " +
				"follow up with read_span on interesting line ranges.",
			promptSnippet: "search_spans(path, pattern): capped line matches + total count for big files.",
			parameters: Type.Object({
				path: Type.String({ description: "File to search (relative or absolute)." }),
				pattern: Type.String({ description: "JavaScript regex (no flags; applied per line)." }),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const path = resolveReadPath(ctx.cwd, params.path);
				const loaded = await load(path);
				const { matches, total, totalLinesScanned, complete } = searchSpans(loaded.text, params.pattern);
				const receipt = buildSearchReceipt({
					requested_file: params.path,
					normalized_file: loaded.normalizedPath,
					sha256: loaded.sha256,
					size_bytes: loaded.size,
					bytes_examined: loaded.size,
					total_lines_scanned: totalLinesScanned,
					matches: total,
					shown_matches: matches.length,
					complete,
				});
				record("span-tools", "search", { total, shown: matches.length });
				const body = matches.map((m) => `${m.line}:${m.text}`).join("\n");
				const header = `[receipt ${receipt.schema} sha256=${receipt.sha256.slice(0, 12)} bytes=${receipt.bytes_examined}/${receipt.size_bytes} lines=${receipt.total_lines_scanned} complete=${receipt.complete}; ${total} matches, showing ${matches.length}]`;
				return { content: [{ type: "text" as const, text: `${header}\n${body}` }], details: { receipt } };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "read_span",
			label: "Read span",
			description:
				`Read a bounded line range of a file (max ${MAX_SPAN_LINES} lines per call) with a ` +
				"provenance header `[span #TAG lines a-b/total]`. Page through big files with this.",
			promptSnippet: "read_span(path, start_line, end_line): bounded numbered slice of a big file.",
			parameters: Type.Object({
				path: Type.String({ description: "File to read (relative or absolute)." }),
				start_line: Type.Number({ minimum: 1, description: "1-indexed first line." }),
				end_line: Type.Number({ minimum: 1, description: "1-indexed last line (inclusive; clamped)." }),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const path = resolveReadPath(ctx.cwd, params.path);
				const loaded = await load(path);
				const { header, body, start, end } = readSpan(loaded.text, params.start_line, params.end_line);
				record("span-tools", "read", { start, end });
				return { content: [{ type: "text" as const, text: `${header}\n${body}` }], details: {} };
			},
		}),
	);
}
