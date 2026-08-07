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
// LIVE default-on since 2026-08-07 (was dark candidate c13; SPAN_TOOLS=off is
// the kill switch). ADOPTED by judgment (Albert-approved); benefit was not
// established by a powered trial. Per-file cache keyed by (path, mtime) for
// the session. Known interaction, accepted: neither tool is in loop-breaker's
// PROGRESS_TOOLS, so paging a large file feeds the non-progress streak.
// Gate rounds must keep search_spans/read_span in GATE_BASE_TOOLS (ADR-0001).
const ENABLED = process.env.SPAN_TOOLS !== "off";

type LoadedFile = { mtimeMs: number; text: string; normalizedPath: string; size: number; sha256: string };
const cache = new Map<string, LoadedFile>();

// These tools advertise themselves as safe on LARGE files, and their OUTPUT is
// tightly bounded (20 matches / 8 KB) — but the INPUT was not: load() read the
// whole file into memory and split it into a line array before any of that
// bounding applied, so a pathological file could spike memory far beyond
// anything the caller could observe in the result. Bound the input too, and
// BLOCK rather than truncate (the context-inlet-guard rule: a silently partial
// view of a file is worse than a clear refusal). Env-tunable, clamped.
// (QA finding, 2026-07-30.)
const MAX_FILE_BYTES = (() => {
	const raw = process.env.SPAN_MAX_FILE_BYTES ?? "";
	const parsed = /^\d+$/.test(raw) ? Number(raw) : 8 * 1024 * 1024;
	return Math.min(64 * 1024 * 1024, Math.max(64 * 1024, parsed));
})();

async function load(path: string): Promise<LoadedFile> {
	const info = await stat(path);
	if (info.size > MAX_FILE_BYTES) {
		// Exact bytes, not rounded MB: SPAN_MAX_FILE_BYTES is configurable down to
		// 64 KB, where rounding rendered this as "refuse files over 0 MB — x is 0 MB".
		throw new Error(
			`span tools refuse files over ${MAX_FILE_BYTES} bytes — ` +
			`${path} is ${info.size} bytes. Narrow the target, or use ` +
			"bash (grep -n / sed -n 'A,Bp') which streams instead of loading the whole file.",
		);
	}
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
