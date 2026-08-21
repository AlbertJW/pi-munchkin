import { readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { defineTool, type ExtensionAPI, withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { annotate, applyHunks, detectStyle, fileTag, normalizeText, parsePatch, relocateHunks, restoreStyle } from "../lib/hashline-core.ts";
import { emitHarnessSignal } from "../lib/harness-signals.ts";

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

export type HashlineIo = {
	writeTarget(path: string, text: string): Promise<void>;
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
					// A single line can itself exceed the cap (minified/one-line file):
					// keeping it whole would blow the context — hard-cut within the line.
					if (slice.length === 1 && slice[0].length > MAX_BYTES) {
						slice = [`${slice[0].slice(0, MAX_BYTES)} …[line truncated: ${slice[0].length} chars total]`];
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
			async execute(_id, params, _signal, _onUpdate, ctx) {
				const parsed = parsePatch(params.input);
				// Merge CONSECUTIVE same-(path, tag) sections: they were composed against
				// the SAME source state, so one applyHunks pass is exact — self-relocation
				// (pre-existing) fails when the sections sit within ±2 lines of each other.
				const sections: typeof parsed = [];
				for (const sec of parsed) {
					const last = sections[sections.length - 1];
					if (last && last.path === sec.path && last.tag === sec.tag) last.hunks = last.hunks.concat(sec.hunks);
					else sections.push({ ...sec, hunks: [...sec.hunks] });
				}
				const lockedPaths = sections.map((section) =>
					isAbsolute(section.path) ? section.path : resolve(ctx.cwd, section.path));
				return withMutationQueues(lockedPaths, async () => {
				// TWO-PHASE apply (all-or-nothing multi-file): PHASE 1 reads, resolves tags,
				// and computes every section IN MEMORY — any failure throws before a byte lands.
				// PHASE 2 writes only once every section validated. Old code wrote inside the
				// loop, half-applying earlier files when a later section failed.
				type Planned = { abs: string; disp: string; finalText: string; res: ReturnType<typeof applyHunks>; hunkCount: number };
				const planned: Planned[] = [];
				// Working buffers: same-file sections chain onto the prior result.
				const buffers = new Map<string, { text: string; style: ReturnType<typeof detectStyle> }>();
				const originals = new Map<string, string>(); // pristine bytes per file, for rollback + honesty
				try {
				for (const sec of sections) {
					const abs = isAbsolute(sec.path) ? sec.path : resolve(ctx.cwd, sec.path);
					const disp = displayPath(ctx.cwd, abs);
					let buf = buffers.get(abs);
					if (!buf) {
						let raw: string;
						try {
							const info = await stat(abs);
							if (info.size > MAX_EDIT_FILE_BYTES) throw new Error(oversizedMessage("edit", info.size, MAX_EDIT_FILE_BYTES));
							raw = await readFile(abs, "utf8");
						} catch (e) {
							if ((e as NodeJS.ErrnoException)?.code === "ENOENT") {
								throw new Error(
									`file not found: ${disp}. Use the file's real relative path and the #TAG from your last read — the tool description's header is a placeholder, not a real file. To create a new file use write, not edit.`,
								);
							}
							throw e;
						}
						originals.set(abs, raw); // pristine bytes for phase-2 rollback
						buf = { text: raw, style: detectStyle(raw) }; // style restored on write — a one-line edit must not rewrite the whole file
						buffers.set(abs, buf);
					}
					const live = normalizeText(buf.text);
					const liveTag = fileTag(live);
					let hunks = sec.hunks;
					if (sec.tag !== liveTag) {
						const snap = (snaps.get(abs) ?? []).find((s) => s.tag === sec.tag);
						if (!snap) {
							// Say what was actually checked. The snapshot store is a
							// module-scope LRU (SNAP_PATHS paths x SNAP_VERSIONS versions),
							// which pi scopes to the extension MODULE INSTANCE -- i.e. the
							// process, not the session. So "not from this session" was wrong
							// in both directions: a tag from an earlier session in the same
							// process resolves fine (its content snapshot is still valid),
							// and a tag from THIS session fails once the LRU evicts it. The
							// remedy is the same either way, but the diagnosis must not
							// send a model looking for a session boundary that is not there.
							throw new Error(
								`[${disp}#${sec.tag}] no retained snapshot carries this tag and the live file is #${liveTag} `
								+ `(the snapshot store keeps ${SNAP_VERSIONS} versions each for the ${SNAP_PATHS} most recently read files). `
								+ "Read the file, then re-emit the patch with fresh numbers.",
							);
						}
						hunks = relocateHunks(snap.text, live, hunks);
					}
					const res = applyHunks(live, hunks);
					const finalText = restoreStyle(res.newText, buf.style);
					if (Buffer.byteLength(finalText) > MAX_EDIT_FILE_BYTES) {
						throw new Error(oversizedMessage("edit", Buffer.byteLength(finalText), MAX_EDIT_FILE_BYTES));
					}
					buf.text = finalText; // chain: a later same-file section edits this result
					planned.push({ abs, disp, finalText, res, hunkCount: hunks.length });
				}
				} catch (e) {
					// All-or-nothing honesty: a model that has seen "Applied…" replies may
					// assume earlier sections landed — say explicitly that none did.
					if (sections.length > 1 && e instanceof Error) {
						e.message += " NOTE: this patch had multiple sections and NONE were applied — fix the error and re-emit the ENTIRE patch.";
					}
					throw e;
				}

				// PHASE 2a — commit all writes. If the OS rejects one mid-way (perms,
				// disk full), best-effort restore every file already written from its
				// pristine bytes so the I/O layer cannot re-open the half-applied hole.
				try {
					for (const p of planned) {
						await io.writeTarget(p.abs, p.finalText);
					}
				} catch (e) {
					// Restore EVERY target, including the write that rejected: writeFile
					// may truncate or partially write before surfacing an I/O failure.
					const rollbackFailures: string[] = [];
					for (const abs of new Set(planned.map((p) => p.abs))) {
						try {
							await writeFile(abs, originals.get(abs) ?? "", "utf8");
						} catch (rollbackError) {
							// A read-only target commonly rejects both the original commit and
							// rollback without ever changing. Verify bytes before declaring the
							// rollback incomplete.
							try {
								if (await readFile(abs, "utf8") !== (originals.get(abs) ?? "")) {
									rollbackFailures.push(`${abs}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
								}
							} catch {
								rollbackFailures.push(`${abs}: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
							}
						}
					}
					if (e instanceof Error) {
						e.message += rollbackFailures.length === 0
							? " NOTE: write failed — every target was restored to its pre-patch state; nothing remains applied."
							: ` NOTE: write failed AND rollback was incomplete (${rollbackFailures.join("; ")}). Inspect every target before continuing.`;
					}
					throw e;
				}

				// PHASE 2b — everything is on disk; record snapshots and build the output.
				const out: string[] = [];
				let firstChanged: number | undefined;
				for (const p of planned) {
					const newText = normalizeText(p.finalText);
					const newTag = recordSnapshot(p.abs, newText);
					firstChanged = firstChanged ?? p.res.firstChangedLine;

					// Re-grounding aid: ±3 renumbered lines around each change under the
					// new tag, so the next edit needs no re-read.
					const newLines = newText.replace(/\n$/, "").split("\n");
					const windows: [number, number][] = [];
					for (const c of p.res.changed) {
						const s = Math.max(1, c.line - 3);
						const e = Math.min(newLines.length, c.line + Math.max(c.count, 1) - 1 + 3);
						const last = windows[windows.length - 1];
						if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
						else windows.push([s, e]);
					}
					const ground = windows
						.map(([s, e]) => annotate(newLines.slice(s - 1, e), s))
						.join("\n…\n");
					const c = p.res.counts;
					out.push(
						`Applied ${p.hunkCount} hunk(s) to ${p.disp} (${c.replaced} replace, ${c.inserted} insert, ${c.deleted} delete).\n` +
							`[${p.disp}#${newTag}]\n${ground}\nNumbers above are CURRENT (tag ${newTag}). Old tag/numbers are dead.`,
					);
				}
				return { content: [{ type: "text" as const, text: out.join("\n\n") }], details: { firstChangedLine: firstChanged } };
				});
			},
		}),
	);
}

export default registerHashline;
