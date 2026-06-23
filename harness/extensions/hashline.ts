import { readFile, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { annotate, applyHunks, detectStyle, fileTag, normalizeText, parsePatch, relocateHunks, restoreStyle } from "../lib/hashline-core.ts";

// Hashline edits — line-anchored patches instead of exact-text matching.
//
// Port of oh-my-pi's hashline format (github.com/can1357/oh-my-pi —
// packages/hashline: format.ts, grammar.lark, prompt.md). Exact-text edit
// matching is the #1 failure for small local models; hashline removes the
// class: `read` returns a `[path#TAG]` file-version tag + `N:content` numbered
// lines, `edit` takes a patch naming line ranges. OMP benchmarks: ~50-61%
// fewer edit tokens, weak-model pass rate 6.7% → 68.3%.
//
// "Lite" port: full patch grammar EXCEPT tree-sitter block ops; in-memory
// snapshot store (4 versions/path); stale tag → content-based relocation
// against the snapshot, else "read again". Registering tools named
// "read"/"edit" REPLACES the built-ins (extension tools merge after built-ins,
// same name wins). HASHLINE=off skips registration → built-ins untouched.
// Same param names/semantics as built-ins, so verify-gate / loop-breaker /
// plan-runner / context-inlet-guard keep working unmodified.

const ENABLED = process.env.HASHLINE !== "off";
const MAX_LINES = 2000; // mirror built-in read defaults
const MAX_BYTES = 50 * 1024;
const SNAP_VERSIONS = 4;
const SNAP_PATHS = 50;

// ---------- snapshot store ----------

const snaps = new Map<string, { tag: string; text: string }[]>();
const SNAP_MAX_FILE = 2 * 1024 * 1024; // don't retain huge files; stale edits degrade to "read again"

function recordSnapshot(abs: string, text: string): string {
	const tag = fileTag(text);
	if (text.length > SNAP_MAX_FILE) return tag; // tag-only; no retention
	const history = snaps.get(abs) ?? [];
	// dedupe by tag AND text: a tag collision must not stop the real new
	// version from being stored (it would corrupt later relocation)
	if (!history.some((s) => s.tag === tag && s.text === text)) {
		snaps.delete(abs); // refresh insertion order → eviction is LRU, not first-read FIFO
		snaps.set(abs, [{ tag, text }, ...history].slice(0, SNAP_VERSIONS));
		if (snaps.size > SNAP_PATHS) {
			const oldest = snaps.keys().next().value;
			if (oldest && oldest !== abs) snaps.delete(oldest);
		}
	}
	return tag;
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
[<RELATIVE/PATH>#<TAG>]
replace 12..13:
+const x = load();
+use(x);
insert after 20:
+log("done");
delete 30..31
*** End Patch

The header above is a PLACEHOLDER. Substitute the real path you read and the real #TAG — never emit "<RELATIVE/PATH>" or "<TAG>" literally, never emit this description's old example values.
Ops: replace N..M: · insert before N: / after N: / head: / tail: · delete N..M. replace/insert REQUIRE "+" body rows (to remove lines use delete). Body rows start with "+" and are the FINAL content (never old lines, never context). "+" alone = blank line.
Critical: (1) Path + #TAG + line numbers come from YOUR LAST read/edit response for that file — copy the #TAG character-for-character; never from memory, never the placeholder. (2) every edit mints a fresh #TAG and renumbers the file — take the next edit's numbers from the edit response or a fresh read. (3) Ranges tight: only lines whose content changes. (4) Multiple files = multiple [path#TAG] sections in one patch.`;

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.registerTool(
		defineTool({
			name: "read",
			label: "Read (hashline)",
			description:
				"Read a file. Returns a `[path#TAG]` header then `N:content` numbered lines. TAG is the file-version tag — edit requires it. offset/limit read a range (numbering stays absolute).",
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
				if (mime) {
					const buf = await readFile(abs);
					// no resize pipeline here (built-in read has one) — cap instead of
					// blowing the context with a multi-MB base64 blob
					if (buf.length > 4 * 1024 * 1024) {
						throw new Error(`Image too large to attach (${(buf.length / 1024 / 1024).toFixed(1)}MB > 4MB). Resize it externally first.`);
					}
					return { content: [{ type: "image" as const, data: buf.toString("base64"), mimeType: mime }], details: {} };
				}
				const text = normalizeText(await readFile(abs, "utf8"));
				const tag = recordSnapshot(abs, text);
				if (text === "") {
					return {
						content: [{ type: "text" as const, text: `[${disp}#${tag}]\n(empty file — add content with "insert head:")` }],
						details: {},
					};
				}
				const all = text.replace(/\n$/, "").split("\n");
				const start = Math.max(1, params.offset ?? 1);
				if (start > all.length && all.length > 0) {
					throw new Error(`Offset ${start} is beyond end of file (${all.length} lines total)`);
				}
				const maxLines = params.limit ?? MAX_LINES;
				let slice = all.slice(start - 1, start - 1 + maxLines);
				let body = annotate(slice, start);
				let note = "";
				if (body.length > MAX_BYTES) {
					let bytes = 0;
					let cut = 0;
					for (const l of slice) {
						bytes += l.length + 8;
						if (bytes > MAX_BYTES) break;
						cut += 1;
					}
					slice = slice.slice(0, Math.max(1, cut));
					body = annotate(slice, start);
				}
				const shown = slice.length;
				const total = all.length;
				if (start - 1 + shown < total) {
					note = `\n[Truncated: lines ${start}-${start - 1 + shown} of ${total} — continue with offset=${start + shown}]`;
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
			promptSnippet: "edit(input): hashline patch — replace/insert/delete by line number under a [path#TAG] header.",
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
			// serialize edits: two parallel patches to the same file would race read→write
			executionMode: "sequential",
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const sections = parsePatch(params.input);
				const out: string[] = [];
				let firstChanged: number | undefined;
				for (const sec of sections) {
					const abs = isAbsolute(sec.path) ? sec.path : resolve(ctx.cwd, sec.path);
					const disp = displayPath(ctx.cwd, abs);
					let raw: string;
					try {
						raw = await readFile(abs, "utf8");
					} catch (e) {
						if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
							throw new Error(
								`file not found: ${disp}. Use the file's real relative path and the #TAG from your last read — the tool description's header is a placeholder, not a real file. To create a new file use write, not edit.`,
							);
						}
						throw e;
					}
					const style = detectStyle(raw); // restore CRLF/BOM on write — a one-line edit must not rewrite the whole file
					const live = normalizeText(raw);
					const liveTag = fileTag(live);
					let hunks = sec.hunks;
					if (sec.tag !== liveTag) {
						const snap = (snaps.get(abs) ?? []).find((s) => s.tag === sec.tag);
						if (!snap) {
							throw new Error(
								`[${disp}#${sec.tag}] tag is not from this session (live file is #${liveTag}). Read the file, then re-emit the patch with fresh numbers.`,
							);
						}
						hunks = relocateHunks(snap.text, live, hunks);
					}
					const res = applyHunks(live, hunks);
					await writeFile(abs, restoreStyle(res.newText, style), "utf8");
					const newText = normalizeText(res.newText);
					const newTag = recordSnapshot(abs, newText);
					firstChanged = firstChanged ?? res.firstChangedLine;

					// Re-grounding aid: ±3 renumbered lines around each change under the
					// new tag, so the next edit needs no re-read.
					const newLines = newText.replace(/\n$/, "").split("\n");
					const windows: [number, number][] = [];
					for (const c of res.changed) {
						const s = Math.max(1, c.line - 3);
						const e = Math.min(newLines.length, c.line + Math.max(c.count, 1) - 1 + 3);
						const last = windows[windows.length - 1];
						if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
						else windows.push([s, e]);
					}
					const ground = windows
						.map(([s, e]) => annotate(newLines.slice(s - 1, e), s))
						.join("\n…\n");
					const c = res.counts;
					out.push(
						`Applied ${hunks.length} hunk(s) to ${disp} (${c.replaced} replace, ${c.inserted} insert, ${c.deleted} delete).\n` +
							`[${disp}#${newTag}]\n${ground}\nNumbers above are CURRENT (tag ${newTag}). Old tag/numbers are dead.`,
					);
				}
				return { content: [{ type: "text" as const, text: out.join("\n\n") }], details: { firstChangedLine: firstChanged } };
			},
		}),
	);
}
