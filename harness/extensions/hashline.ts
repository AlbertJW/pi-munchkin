import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { defineTool, type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { annotate, applyHunks, decodeDocument, fileTag, mapChangedLines, parsePatch, serializeDocument, type Hunk } from "../lib/hashline-core.ts";
import { emitHarnessSignal } from "../lib/harness-signals.ts";

// Hashline edits — line-anchored patches instead of exact-text matching.
//
// Port of oh-my-pi's hashline format (github.com/can1357/oh-my-pi —
// packages/hashline: format.ts, grammar.lark, prompt.md). `read` returns a
// `[path#SHA256]` exact-byte file tag + `N:content` numbered lines; `edit`
// rejects stale tags rather than relocating line ranges.
//
// "Lite" port: full patch grammar EXCEPT tree-sitter block ops. Registering tools named
// "read"/"edit" REPLACES the built-ins (extension tools merge after built-ins,
// same name wins). HASHLINE=off skips registration → built-ins untouched.
// Downstream observers use the stable tool names and mutation classification;
// the hashline edit schema is intentionally distinct from Pi's native schema.

const ENABLED = process.env.HASHLINE !== "off";
const MAX_LINES = 2000; // mirror built-in read defaults
const MAX_BYTES = 50 * 1024;

/** Cut to a byte budget on a CODE POINT boundary, so no lone surrogate escapes. */
function truncateUtf8Bytes(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
	let out = value;
	while (out.length > 0 && Buffer.byteLength(out, "utf8") > maxBytes) {
		const last = out.charCodeAt(out.length - 1);
		out = out.slice(0, last >= 0xDC00 && last <= 0xDFFF ? -2 : -1);
	}
	const tail = out.charCodeAt(out.length - 1);
	return tail >= 0xD800 && tail <= 0xDBFF ? out.slice(0, -1) : out;
}
const IMAGE_MAX_BYTES = 4 * 1024 * 1024;

function byteLimit(name: string, fallback: number): number {
	const raw = process.env[name];
	return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : fallback;
}

const MAX_READ_FILE_BYTES = byteLimit("HASHLINE_MAX_READ_BYTES", 16 * 1024 * 1024);
const MAX_EDIT_FILE_BYTES = byteLimit("HASHLINE_MAX_EDIT_BYTES", 16 * 1024 * 1024);

export async function withMutationQueues<T>(paths: string[], work: () => Promise<T>): Promise<T> {
	const canonical = await Promise.all(paths.map(async (path) => {
		try {
			return await realpath(path);
		} catch (error) {
			const code = (error as NodeJS.ErrnoException)?.code;
			if (code === "ENOENT" || code === "ENOTDIR") return resolve(path);
			throw error;
		}
	}));
	const ordered = [...new Set(canonical)].sort();
	const acquire = async (index: number): Promise<T> => {
		if (index >= ordered.length) return work();
		return withFileMutationQueue(ordered[index], () => acquire(index + 1));
	};
	return acquire(0);
}

function oversizedMessage(kind: "read" | "edit", size: number, max: number): string {
	return `File is too large for hashline ${kind} (${size} bytes > ${max} bytes). ` +
		"The limit parameter only bounds returned context; it does not make allocating an oversized file safe. " +
		"Use rg, head, tail, or a purpose-built bounded span tool.";
}

// ---------- tools ----------

const IMAGE_MIME: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
};

function displayPath(cwd: string, abs: string): string {
	const rel = relative(cwd, abs);
	return rel && !rel.startsWith("..") ? rel : abs;
}

const EDIT_DESCRIPTION = `Edit files with a hashline patch. ONE param \`input\`:

*** Begin Patch
[<RELATIVE/PATH>#<64-HEX-SHA256-TAG>]
replace 12..13:
+const x = load();
+use(x);
insert after 20:
+log("done");
delete 30..31
*** End Patch

The header above is a PLACEHOLDER. Substitute the real path and exact 64-hex #TAG from your latest read — never emit placeholders or example values.
Ops: replace N..M: · insert before N: / after N: / head: / tail: · delete N..M. replace/insert REQUIRE "+" body rows (to remove lines use delete). Body rows start with "+" and are the FINAL content (never old lines, never context). "+" alone = blank line.
Stale tags always fail; no content relocation is attempted. Same-path/same-tag sections belong to one source stage and may be separated by other file sections. After a newer stage for a path begins, do not return to an earlier tag. A chained section must use the exact tag shown by the prior planned stage. Same-position insertions are rejected; combine them into one hunk.
Critical: (1) Path + #TAG + line numbers come from YOUR LAST read/edit response for that file — copy the full digest character-for-character; never use a remembered tag. (2) every successful edit returns a fresh #TAG; use it for a chained stage. (3) Ranges tight: only lines whose content changes. (4) Multiple files = multiple [path#TAG] sections in one patch.`;

export type HashlineIo = {
	writeTarget(path: string, text: string): Promise<void>;
	/** Test seam for injecting an external edit after planning but before digest recheck. */
	beforeCommit?(): Promise<void>;
};

const DEFAULT_IO: HashlineIo = {
	writeTarget: async (path, text) => { await writeFile(path, text, "utf8"); },
};

export function registerHashline(pi: ExtensionAPI, io: HashlineIo = DEFAULT_IO) {
	if (!ENABLED) return;

	pi.registerTool(
		defineTool({
			name: "read",
			label: "Read (hashline)",
			description:
				"Read a file. Returns a `[path#TAG]` header then `N:content` numbered lines. TAG is the exact-byte SHA-256 file-version tag — edit requires it. offset/limit read a range (numbering stays absolute).",
			promptSnippet: "read(path, offset?, limit?): file as [path#TAG] + numbered lines; TAG needed by edit.",
			parameters: Type.Object({
				path: Type.String({ description: "Path to the file (relative or absolute)." }),
				offset: Type.Optional(Type.Number({ minimum: 1, description: "1-indexed first line to read." })),
				limit: Type.Optional(Type.Number({ minimum: 1, description: "Max lines to read." })),
			}),
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const abs = isAbsolute(params.path) ? params.path : resolve(ctx.cwd, params.path);
				const disp = displayPath(ctx.cwd, abs);
				const mime = IMAGE_MIME[extname(abs).toLowerCase()];
				const info = await stat(abs);
				if (mime) {
					if (info.size > IMAGE_MAX_BYTES) {
						emitHarnessSignal(pi.events, { v: 1, type: "capability/need", capability: "span_tools", reason: "large-file" });
						throw new Error(`Image too large to attach (${info.size} bytes > ${IMAGE_MAX_BYTES} bytes). Resize it externally first.`);
					}
					const buf = await readFile(abs);
					return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: mime }], details: {} };
				}
				if (info.size > MAX_READ_FILE_BYTES) {
					emitHarnessSignal(pi.events, { v: 1, type: "capability/need", capability: "span_tools", reason: "large-file" });
					throw new Error(oversizedMessage("read", info.size, MAX_READ_FILE_BYTES));
				}
				const raw = await readFile(abs);
				const doc = decodeDocument(raw);
				const tag = fileTag(raw);
				if (doc.lines.length === 0) {
					return {
						content: [{ type: "text" as const, text: `[${disp}#${tag}]\n(empty file — add content with "insert head:")` }],
						details: {},
					};
				}
				const all = doc.lines.map((line) => line.content);
				const start = Math.max(1, params.offset ?? 1);
				if (start > all.length && all.length > 0) {
					throw new Error(`Offset ${start} is beyond end of file (${all.length} lines total)`);
				}
				const maxLines = params.limit ?? MAX_LINES;
				let slice = all.slice(start - 1, start - 1 + maxLines);
				let body = annotate(slice, start);
				let note = "";
				// MAX_BYTES is a BYTE budget and was enforced three times with `.length`,
				// which counts UTF-16 code units. A CJK or emoji-heavy file therefore
				// returned 2-3x the intended bytes into the context window this cap exists
				// to protect, and the in-line hard cut could split a surrogate pair and
				// emit a lone surrogate into the result — which then reaches telemetry
				// through JSON.stringify and becomes U+FFFD on any UTF-8 round-trip.
				// The `+ 8` was a guess at the "N:" prefix annotate() adds; measure it.
				if (Buffer.byteLength(body, "utf8") > MAX_BYTES) {
					let bytes = 0;
					let cut = 0;
					for (const [index, line] of slice.entries()) {
						bytes += Buffer.byteLength(line, "utf8") + Buffer.byteLength(`${start + index}:`, "utf8") + 1;
						if (bytes > MAX_BYTES) break;
						cut += 1;
					}
					slice = slice.slice(0, Math.max(1, cut));
					// A single line can itself exceed the cap (minified/one-line file):
					// keeping it whole would blow the context — hard-cut within the line.
					if (slice.length === 1 && Buffer.byteLength(slice[0], "utf8") > MAX_BYTES) {
						const head = truncateUtf8Bytes(slice[0], MAX_BYTES);
						slice = [`${head} …[line truncated: ${slice[0].length} chars total]`];
					}
					body = annotate(slice, start);
				}
				const shown = slice.length;
				const total = all.length;
				if (start - 1 + shown < total) {
					// Include limit= in the hint: the context-inlet-guard treats offset-only
					// reads as unbounded and BLOCKS them — the hint must prescribe a call
					// that actually passes the guard.
					note = `\n[Truncated: lines ${start}-${start - 1 + shown} of ${total} — continue with offset=${start + shown}, limit=${maxLines}]`;
				}
				return { content: [{ type: "text" as const, text: `[${disp}#${tag}]\n${body}${note}` }], details: {} };
			},
		}),
	);

	pi.registerTool(
		defineTool({
			name: "edit",
			label: "Edit (hashline)",
			description: EDIT_DESCRIPTION,
			promptSnippet: "edit(input): hashline patch — replace/insert/delete by line number under a [path#64-hex-SHA256] header.",
			promptGuidelines: [
				"After an edit, the response shows the new #TAG and renumbered lines around each change — use those for the next edit; old tags/numbers are dead.",
			],
			parameters: Type.Object({
				input: Type.String({ description: "The hashline patch (see tool description for the grammar)." }),
			}),
			// model quirk shim (OMP precedent): some providers emit _input
			prepareArguments(args: unknown) {
				const o = args as Record<string, unknown> | null;
				if (o && typeof o._input === "string" && o.input === undefined) return { input: o._input };
				return args as { input: string };
			},
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const parsed = parsePatch(params.input);
				const sections = parsed.map((section) => ({
					...section,
					abs: isAbsolute(section.path) ? section.path : resolve(ctx.cwd, section.path),
				}));
				return withMutationQueues(sections.map((section) => section.abs), async () => {
					type Stage = { tag: string; hunks: Hunk[] };
					type Target = { key: string; abs: string; disp: string; stages: Stage[]; firstIndex: number };
					type Planned = {
						abs: string; disp: string; original: Buffer; finalBytes: Buffer;
						res: { changed: { line: number; count: number }[]; counts: { replaced: number; inserted: number; deleted: number } };
						hunkCount: number;
					};
					const targets = new Map<string, Target>();
					for (const [index, section] of sections.entries()) {
						let key: string;
						try { key = await realpath(section.abs); }
						catch { key = resolve(section.abs); }
						let target = targets.get(key);
						if (!target) {
							const route = key;
							target = { key, abs: route, disp: displayPath(ctx.cwd, section.abs), stages: [], firstIndex: index };
							targets.set(key, target);
						}
						const current = target.stages[target.stages.length - 1];
						if (current?.tag === section.tag) {
							current.hunks.push(...section.hunks);
						} else {
							if (target.stages.some((stage) => stage.tag === section.tag)) {
								throw new Error(`[${target.disp}#${section.tag}] ambiguous return to an earlier source stage. Nothing in this patch was written.`);
							}
							target.stages.push({ tag: section.tag, hunks: [...section.hunks] });
						}
					}
					const orderedTargets = [...targets.values()].sort((a, b) => a.firstIndex - b.firstIndex);
				const planned: Planned[] = [];
				try {
					for (const target of orderedTargets) {
						const info = await stat(target.abs);
						if (info.size > MAX_EDIT_FILE_BYTES) throw new Error(oversizedMessage("edit", info.size, MAX_EDIT_FILE_BYTES));
						const original = await readFile(target.abs);
						let doc = decodeDocument(original);
						let expectedTag = fileTag(original);
						let changed: { line: number; count: number }[] = [];
						const counts = { replaced: 0, inserted: 0, deleted: 0 };
						let hunkCount = 0;
						for (const stage of target.stages) {
							if (stage.tag !== expectedTag) {
								throw new Error(`stale tag: [${target.disp}#${stage.tag}] does not match current source stage #${expectedTag}. Nothing in this patch was applied. Read the file again, rebuild the complete patch with current tags and line numbers, and resubmit once.`);
							}
							const beforeLineCount = doc.lines.length;
							const res = applyHunks(doc, stage.hunks);
							doc = res.document;
							const finalBytes = serializeDocument(doc);
							if (finalBytes.byteLength > MAX_EDIT_FILE_BYTES) throw new Error(oversizedMessage("edit", finalBytes.byteLength, MAX_EDIT_FILE_BYTES));
							expectedTag = fileTag(finalBytes);
							const priorChanged = mapChangedLines(changed, beforeLineCount, stage.hunks, doc.lines.length);
							const changedSet = new Set<number>();
							for (const span of [...priorChanged, ...res.changed]) {
								for (let offset = 0; offset < Math.max(1, span.count); offset += 1) {
									if (doc.lines.length > 0) changedSet.add(Math.min(doc.lines.length, span.line + offset));
								}
							}
							changed = [...changedSet].sort((a, b) => a - b).map((line) => ({ line, count: 1 }));
							counts.replaced += res.counts.replaced;
							counts.inserted += res.counts.inserted;
							counts.deleted += res.counts.deleted;
							hunkCount += stage.hunks.length;
						}
						if (hunkCount === 0) throw new Error(`bad patch: no hunks for ${target.disp}`);
						planned.push({ abs: target.abs, disp: target.disp, original, finalBytes: serializeDocument(doc), res: { changed, counts }, hunkCount });
					}
				} catch (error) {
					if (error instanceof Error && parsed.length > 1 && !/Nothing in this patch was applied|Nothing in this patch was written/.test(error.message)) {
						error.message += " Nothing in this patch was written; correct the issue and re-emit the complete patch.";
					}
					throw error;
				}

				// Detect external edits during planning. This remains a best-effort
				// guard: another process can still write after this check.
				await io.beforeCommit?.();
				for (const item of planned) {
					const current = await readFile(item.abs);
					if (fileTag(current) !== fileTag(item.original)) {
						throw new Error(`stale tag: ${item.disp} changed while this patch was being validated. Nothing in this patch was written. Read again and rebuild the complete patch.`);
					}
				}

				const attempted: Planned[] = [];
				try {
					for (const item of planned) {
						attempted.push(item); // include a write that may partially modify then reject
						await io.writeTarget(item.abs, item.finalBytes.toString("utf8"));
					}
				} catch (error) {
					const rollbackFailures: string[] = [];
					for (const item of [...attempted].reverse()) {
						try {
							await writeFile(item.abs, item.original);
							const restored = await readFile(item.abs);
							if (!restored.equals(item.original)) rollbackFailures.push(`${item.disp}: restored bytes did not match original`);
						} catch (rollbackError) {
							try {
								if (!(await readFile(item.abs)).equals(item.original)) rollbackFailures.push(`${item.disp}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
							} catch {
								rollbackFailures.push(`${item.disp}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
							}
						}
					}
					const base = error instanceof Error ? error.message : String(error);
					const message = rollbackFailures.length === 0
						? `${base} NOTE: write failed; every attempted target was restored byte-for-byte and unattempted targets were untouched.`
						: `${base} NOTE: rollback was incomplete for ${rollbackFailures.join("; ")}. Inspect those paths before continuing; unattempted targets were untouched.`;
					throw new Error(message);
				}

				const out: string[] = [];
				let firstChangedLine: number | undefined;
				for (const item of planned) {
					const doc = decodeDocument(item.finalBytes);
					const tag = fileTag(item.finalBytes);
					firstChangedLine = firstChangedLine ?? item.res.changed[0]?.line;
					const lines = doc.lines.map((line) => line.content);
					const windows: [number, number][] = [];
					for (const change of item.res.changed) {
						const start = Math.max(1, change.line - 3);
						const end = Math.min(lines.length, change.line + Math.max(change.count, 1) - 1 + 3);
						const previous = windows[windows.length - 1];
						if (previous && start <= previous[1] + 1) previous[1] = Math.max(previous[1], end);
						else windows.push([start, end]);
					}
					const ground = windows.map(([start, end]) => annotate(lines.slice(start - 1, end), start)).join("\n…\n");
					out.push(`Applied ${item.hunkCount} hunk(s) to ${item.disp} (${item.res.counts.replaced} replace, ${item.res.counts.inserted} insert, ${item.res.counts.deleted} delete).\n[${item.disp}#${tag}]\n${ground}\nNumbers above are CURRENT (tag ${tag}). Old tag/numbers are dead.`);
				}
				return { content: [{ type: "text" as const, text: out.join("\n\n") }], details: { firstChangedLine } };
				});
			},
		}),
	);
}

export default registerHashline;
