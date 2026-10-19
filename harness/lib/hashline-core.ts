// Hashline v2 pure core: exact-byte file tags, strict UTF-8 decoding, patch
// grammar, and line-ending-preserving application. No Pi SDK imports.
import { createHash } from "node:crypto";

export type Eol = "\n" | "\r\n" | "\r" | "";
export type TextLine = { content: string; eol: Eol };
export type TextDocument = { bom: boolean; lines: TextLine[] };

export function fileTag(input: Uint8Array | string): string {
	const bytes = typeof input === "string" ? Buffer.from(input, "utf8") : Buffer.from(input);
	return createHash("sha256").update(bytes).digest("hex").toUpperCase();
}

export function decodeDocument(bytes: Uint8Array): TextDocument {
	const source = Buffer.from(bytes);
	const bom = source.length >= 3 && source[0] === 0xef && source[1] === 0xbb && source[2] === 0xbf;
	const body = bom ? source.subarray(3) : source;
	let text: string;
	try {
		// The optional byte BOM was handled above. Preserve any following U+FEFF
		// as document content instead of allowing TextDecoder to consume it too.
		text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(body);
	} catch {
		throw new Error("unsupported text encoding: file is not valid UTF-8. Convert it explicitly before editing.");
	}
	if (text.includes("\0")) throw new Error("unsupported text encoding: NUL byte detected; binary files cannot be edited.");
	return { bom, lines: parseLines(text) };
}

function parseLines(text: string): TextLine[] {
	const lines: TextLine[] = [];
	const re = /\r\n|\n|\r/g;
	let start = 0;
	for (let match = re.exec(text); match; match = re.exec(text)) {
		lines.push({ content: text.slice(start, match.index), eol: match[0] as Eol });
		start = match.index + match[0].length;
	}
	if (start < text.length) lines.push({ content: text.slice(start), eol: "" });
	return lines;
}

export function serializeDocument(doc: TextDocument): Buffer {
	for (const { content } of doc.lines) {
		if (content.includes("\0")) throw new Error("unsupported proposed text: NUL byte detected.");
		for (let i = 0; i < content.length; i += 1) {
			const unit = content.charCodeAt(i);
			if (unit >= 0xd800 && unit <= 0xdbff) {
				if (i + 1 >= content.length) throw new Error("unsupported proposed text: unpaired surrogate cannot be encoded as UTF-8.");
				const next = content.charCodeAt(i + 1);
				if (next < 0xdc00 || next > 0xdfff) throw new Error("unsupported proposed text: unpaired surrogate cannot be encoded as UTF-8.");
				i += 1;
			} else if (unit >= 0xdc00 && unit <= 0xdfff) {
				throw new Error("unsupported proposed text: unpaired surrogate cannot be encoded as UTF-8.");
			}
		}
	}
	const body = doc.lines.map((line) => line.content + line.eol).join("");
	const text = doc.bom ? `\uFEFF${body}` : body;
	return Buffer.from(text, "utf8");
}

export function annotate(lines: string[], startLine: number): string {
	return lines.map((line, i) => `${startLine + i}:${line}`).join("\n");
}

export type Hunk = (
	| { op: "replace"; start: number; end: number; body: string[] }
	| { op: "insert"; pos: "before" | "after" | "head" | "tail"; line?: number; body: string[] }
	| { op: "delete"; start: number; end: number }
) & { source?: { start: number; lines: string[] } };

export type Section = { path: string; tag: string; hunks: Hunk[]; format?: "tagged-unified" };

const HEADER_RE = /^\[([^#\]]+)#([0-9A-Fa-f]{64})\]$/;
const REPLACE_RE = /^replace (\d+)(?:\.\.(\d+))?:$/;
const INSERT_RE = /^insert (before|after) (\d+):$/;
const INSERT_EDGE_RE = /^insert (head|tail):$/;
const DELETE_RE = /^delete (\d+)(?:\.\.(\d+))?:?$/;
const UNIFIED_HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/;

const PATCH_EXAMPLE = "Expected shape:\n[src/file.ts#<the 64-hex tag from your last read>]\nreplace 3..4:\n+new line 3\n+new line 4\ndelete 9..9";

/** Purely mechanical repairs that cannot change what an edit means (the #TAG check
 * still guards every section). 2026-10 traces: patches arriving double-escaped (one
 * line with literal \n) and command lines ending in a stray backslash. Anything that
 * would need a guess about intent stays an error. */
export function normalizePatchText(input: string): { text: string; notes: string[] } {
	const notes: string[] = [];
	let text = input;
	if (!text.includes("\n") && /\\n/.test(text) && /^\s*\[[^\]]+#[0-9A-Fa-f]{64}\]/.test(text)) {
		text = text.replace(/\\r\\n|\\n/g, "\n").replace(/\\t/g, "\t").replace(/\\"/g, '"');
		notes.push("the patch arrived as one line with literal \\n sequences; they were read as newlines");
	}
	let stripped = 0;
	text = text.split("\n").map((line) => {
		const body = line.trimEnd();
		if (!body.endsWith("\\") || line.startsWith("+")) return line;
		const candidate = body.slice(0, -1).trimEnd();
		if (HEADER_RE.test(candidate) || REPLACE_RE.test(candidate) || INSERT_RE.test(candidate) || INSERT_EDGE_RE.test(candidate) || DELETE_RE.test(candidate)) {
			stripped += 1;
			return candidate;
		}
		return line;
	}).join("\n");
	if (stripped) notes.push(`removed a stray trailing backslash from ${stripped} command line(s)`);
	return { text, notes };
}

export function parsePatch(input: string): Section[] {
	const normalized = input.replace(/\r\n?/g, "\n");
	const sections: Section[] = [];
	let cur: Section | null = null;
	let curHunk: { op: "replace" | "insert"; body: string[] } & Partial<Hunk> | null = null;
	const lines = normalized.split("\n");
	const closeHunk = (lineNo: number) => {
		if (!curHunk) return;
		if (curHunk.body.length === 0) {
			if (curHunk.op === "insert") {
				throw new Error(`bad patch: insert before line ${lineNo} has no "+" body rows. Every inserted line starts with "+"; a bare "+" inserts a blank line.\n${PATCH_EXAMPLE}`);
			}
			throw new Error(`bad patch: replace hunk before line ${lineNo} has no "+" body rows. Every replacement line starts with "+"; to remove lines use delete N..M.\n${PATCH_EXAMPLE}`);
		}
		curHunk = null;
	};
	for (let n = 0; n < lines.length; n += 1) {
		const raw = lines[n];
		const line = raw.trimEnd();
		if (line.trim() === "" || /^\*\*\* (Begin|End) Patch$/.test(line.trim())) continue;
		if (raw.startsWith("+")) {
			if (!curHunk) throw new Error(`bad patch line ${n + 1}: "+" body row outside a hunk`);
			curHunk.body.push(raw.slice(1));
			continue;
		}
		let m: RegExpMatchArray | null;
		if ((m = line.match(HEADER_RE))) {
			closeHunk(n + 1);
			if (cur && cur.hunks.length === 0) throw new Error(`bad patch: section [${cur.path}] has no hunks`);
			cur = { path: m[1], tag: m[2].toUpperCase(), hunks: [] };
			sections.push(cur);
			continue;
		}
		if (/^\[[^#\]]+#.*\]$/.test(line)) throw new Error(`bad patch line ${n + 1}: file tag must be exactly 64 hexadecimal SHA-256 characters`);
		if (/^\*\*\* (Update|Add|Delete) File:/.test(line)) {
			throw new Error("tagged unified compatibility requires a tagged hashline header; an untagged Update File directive is rejected");
		}
		if (!cur) throw new Error(`bad patch line ${n + 1}: "${line.slice(0, 60)}" before any [path#TAG] header. Start each file with [path#TAG] using the tag from your last read of that file.\n${PATCH_EXAMPLE}`);
		closeHunk(n + 1);
		if ((m = line.match(UNIFIED_HUNK_RE))) {
			const unified = parseUnifiedHunk(lines, n, m);
			cur.hunks.push(...unified.hunks);
			cur.format = "tagged-unified";
			n = unified.nextLine - 1;
		} else if ((m = line.match(REPLACE_RE))) {
			const start = Number(m[1]), end = m[2] ? Number(m[2]) : start;
			if (start < 1 || end < start) throw new Error(`bad patch line ${n + 1}: range ${start}..${end}`);
			curHunk = { op: "replace", start, end, body: [] };
			cur.hunks.push(curHunk as Hunk);
		} else if ((m = line.match(INSERT_RE))) {
			const at = Number(m[2]);
			if (at < 1) throw new Error(`bad patch line ${n + 1}: insert line ${at} (lines are 1-indexed; use "insert head:")`);
			curHunk = { op: "insert", pos: m[1] as "before" | "after", line: at, body: [] };
			cur.hunks.push(curHunk as Hunk);
		} else if ((m = line.match(INSERT_EDGE_RE))) {
			curHunk = { op: "insert", pos: m[1] as "head" | "tail", body: [] };
			cur.hunks.push(curHunk as Hunk);
		} else if ((m = line.match(DELETE_RE))) {
			const start = Number(m[1]), end = m[2] ? Number(m[2]) : start;
			if (start < 1 || end < start) throw new Error(`bad patch line ${n + 1}: range ${start}..${end}`);
			cur.hunks.push({ op: "delete", start, end });
		} else {
			throw new Error(`bad patch line ${n + 1}: "${line.slice(0, 60)}" — expected [path#64-HEX], replace N..M:, insert before|after N:, insert head|tail:, delete N..M, or a + body row. If this is new content, prefix it with "+".\n${PATCH_EXAMPLE}`);
		}
	}
	closeHunk(lines.length);
	if (sections.length === 0) throw new Error("bad patch: no [path#TAG] section found");
	for (const section of sections) if (section.hunks.length === 0) throw new Error(`bad patch: section [${section.path}] has no hunks`);
	return sections;
}

/** Convert only changed runs into native operations. Context remains byte-for-byte
 * intact, but the full old span is still checked before any operation is applied.
 * Counts are authoritative: repairing them can turn a truncated replacement into
 * a different successful mutation even when the file's version tag is correct. */
function parseUnifiedHunk(lines: string[], headerLine: number, marker: RegExpMatchArray): { hunks: Hunk[]; nextLine: number } {
	const oldStart = Number(marker[1]), oldCount = Number(marker[2] ?? 1);
	const newStart = Number(marker[3]), newCount = Number(marker[4] ?? 1);
	if (![oldStart, oldCount, newStart, newCount, oldStart + oldCount, newStart + newCount].every(Number.isSafeInteger) ||
		(oldCount > 0 && oldStart < 1) || (newCount > 0 && newStart < 1)) {
		throw new Error(`bad tagged unified range at line ${headerLine + 1}`);
	}
	const hunks: Hunk[] = [];
	const oldRows: string[] = [];
	let addedRows = 0;
	let sourceLine = oldCount === 0 ? oldStart + 1 : oldStart;
	let run: { start: number; removed: number; body: string[] } | null = null;
	const flush = () => {
		if (!run) return;
		if (run.removed > 0) {
			const end = run.start + run.removed - 1;
			hunks.push(run.body.length > 0
				? { op: "replace", start: run.start, end, body: run.body }
				: { op: "delete", start: run.start, end });
		} else {
			hunks.push(run.start === 1
				? { op: "insert", pos: "head", body: run.body }
				: { op: "insert", pos: "after", line: run.start - 1, body: run.body });
		}
		run = null;
	};
	let index = headerLine + 1;
	for (; index < lines.length; index += 1) {
		const row = lines[index];
		const prefix = row[0];
		if (row.startsWith("\\ No newline at end of file")) throw new Error("no-newline markers are unsupported; use native hashline syntax");
		// Only unprefixed rows can be syntax. In particular, " *** End Patch"
		// is source context and must never bypass the source check.
		if (prefix !== " " && prefix !== "-" && prefix !== "+") break;
		const content = row.slice(1);
		if (prefix === " ") {
			flush(); oldRows.push(content); sourceLine += 1; addedRows += 1;
		} else {
			run ??= { start: sourceLine, removed: 0, body: [] };
			if (prefix === "-") { run.removed += 1; oldRows.push(content); sourceLine += 1; }
			else { run.body.push(content); addedRows += 1; }
		}
	}
	flush();
	if (oldRows.length !== oldCount || addedRows !== newCount) {
		throw new Error(`bad tagged unified counts at line ${headerLine + 1}: declared ${oldCount} old/${newCount} new rows, received ${oldRows.length} old/${addedRows} new. Rebuild the complete hunk with matching counts; nothing was written.`);
	}
	if (hunks.length === 0) throw new Error(`bad tagged unified hunk at line ${headerLine + 1}: no added or removed rows`);
	if (oldRows.length > 0) hunks[0].source = { start: oldStart, lines: oldRows };
	return { hunks, nextLine: index };
}

type Op = { start: number; end: number; hunk: Hunk };
export type ApplyResult = {
	document: TextDocument;
	changed: { line: number; count: number }[];
	counts: { replaced: number; inserted: number; deleted: number };
};

/** Map prior-stage changed line spans through one later stage's source-coordinate hunks. */
export function mapChangedLines(
	changed: { line: number; count: number }[],
	beforeLineCount: number,
	hunks: Hunk[],
	afterLineCount: number,
): { line: number; count: number }[] {
	if (afterLineCount === 0) return [];
	const ops = hunks.map((hunk) => opFor(hunk, beforeLineCount)).sort((a, b) => a.start - b.start || a.end - b.end);
	const mapIndex = (sourceIndex: number): number => {
		let delta = 0;
		for (const op of ops) {
			const hunk = op.hunk;
			const inserted = hunk.op === "delete" ? 0 : hunk.op === "replace" ? hunk.body.length : hunk.body.length;
			if (op.start === op.end) {
				if (op.start <= sourceIndex) delta += inserted;
				else break;
				continue;
			}
			if (sourceIndex < op.start) break;
			const width = op.end - op.start;
			if (sourceIndex < op.end) {
				const mappedStart = op.start + delta;
				return inserted === 0 ? mappedStart : mappedStart + Math.min(sourceIndex - op.start, inserted - 1);
			}
			delta += inserted - width;
		}
		return sourceIndex + delta;
	};
	const mapped = new Set<number>();
	for (const span of changed) {
		const length = Math.max(1, span.count);
		for (let offset = 0; offset < length; offset += 1) {
			const sourceIndex = Math.min(beforeLineCount - 1, Math.max(0, span.line - 1 + offset));
			const targetIndex = Math.min(afterLineCount - 1, Math.max(0, mapIndex(sourceIndex)));
			mapped.add(targetIndex);
		}
	}
	const sorted = [...mapped].sort((a, b) => a - b);
	const result: { line: number; count: number }[] = [];
	for (const index of sorted) {
		const last = result[result.length - 1];
		if (last && last.line + last.count === index + 1) last.count += 1;
		else result.push({ line: index + 1, count: 1 });
	}
	return result;
}

function dominantEol(lines: TextLine[]): Eol {
	const counts = new Map<Eol, number>();
	let best: Eol = "";
	let bestCount = 0;
	for (const { eol } of lines) {
		if (eol === "") continue;
		const n = (counts.get(eol) ?? 0) + 1;
		counts.set(eol, n);
		if (n > bestCount) { best = eol; bestCount = n; }
	}
	return best || "\n";
}

function nearestEol(lines: TextLine[], start: number, end: number): Eol {
	for (let distance = 0; distance < lines.length; distance += 1) {
		const before = start - 1 - distance;
		if (before >= 0 && lines[before].eol) return lines[before].eol;
		const after = end + distance;
		if (after < lines.length && lines[after].eol) return lines[after].eol;
	}
	return dominantEol(lines);
}

function rangeEol(lines: TextLine[], start: number, end: number): Eol {
	const counts = new Map<Eol, number>();
	let best: Eol = "";
	let bestCount = 0;
	for (let i = start; i < end; i += 1) {
		const eol = lines[i].eol;
		if (!eol) continue;
		const n = (counts.get(eol) ?? 0) + 1;
		counts.set(eol, n);
		if (n > bestCount) { best = eol; bestCount = n; }
	}
	return best || nearestEol(lines, start, end);
}

function opFor(hunk: Hunk, lineCount: number): Op {
	if (hunk.op === "replace" || hunk.op === "delete") {
		if (hunk.end > lineCount) throw new Error(`line ${hunk.end} out of bounds (file has ${lineCount} lines)`);
		return { start: hunk.start - 1, end: hunk.end, hunk };
	}
	if (hunk.pos === "head") return { start: 0, end: 0, hunk };
	if (hunk.pos === "tail") return { start: lineCount, end: lineCount, hunk };
	const line = hunk.line ?? 0;
	if (line < 1 || line > lineCount) throw new Error(`line ${line} out of bounds (file has ${lineCount} lines)`);
	const at = hunk.pos === "before" ? line - 1 : line;
	return { start: at, end: at, hunk };
}

export function applyHunks(document: TextDocument, hunks: Hunk[]): ApplyResult {
	const original = document.lines;
	const ops = hunks.map((hunk) => opFor(hunk, original.length)).sort((a, b) => a.start - b.start || a.end - b.end);
	for (const { hunk } of ops) {
		const source = hunk.source;
		if (!source) continue;
		const end = source.start - 1 + source.lines.length;
		const actual = original.slice(source.start - 1, end).map((line) => line.content);
		if (actual.length !== source.lines.length || actual.some((line, i) => line !== source.lines[i])) {
			throw new Error(`tagged unified source mismatch at lines ${source.start}..${end}; reread the file and rebuild the patch from current content`);
		}
	}
	for (let i = 1; i < ops.length; i += 1) {
		const prior = ops[i - 1], current = ops[i];
		if (current.start < prior.end) throw new Error(`overlapping hunks around line ${current.start + 1} — merge them into one range`);
		if (current.start === prior.start && current.start === current.end && prior.start === prior.end) {
			throw new Error(`ambiguous same-position insertions at line ${current.start + 1} — combine them into one insert hunk`);
		}
	}
	const counts = { replaced: 0, inserted: 0, deleted: 0 };
	for (const hunk of hunks) {
		if (hunk.op === "replace") counts.replaced += 1;
		else if (hunk.op === "delete") counts.deleted += 1;
		else counts.inserted += 1;
	}
	const changed: { line: number; count: number }[] = [];
	let delta = 0;
	for (const op of ops) {
		const hunk = op.hunk;
		const count = hunk.op === "delete" ? 0 : hunk.body.length;
		changed.push({ line: op.start + delta + 1, count });
		delta += count - (op.end - op.start);
	}
	const lines = original.map((line) => ({ ...line }));
	for (let i = ops.length - 1; i >= 0; i -= 1) {
		const op = ops[i], hunk = op.hunk;
		if (hunk.op === "delete") {
			const removed = lines.splice(op.start, op.end - op.start);
			if (op.end === original.length && lines.length > 0 && removed.length > 0 && removed[removed.length - 1].eol === "") {
				lines[lines.length - 1].eol = "";
			}
			continue;
		}
		if (hunk.op === "replace") {
			const inherited = rangeEol(original, op.start, op.end);
			const finalEol = original[op.end - 1].eol;
			const replacement = hunk.body.map((content, index) => ({ content, eol: index === hunk.body.length - 1 ? finalEol : inherited } as TextLine));
			lines.splice(op.start, op.end - op.start, ...replacement);
			continue;
		}
		const body = hunk.body;
		let eol: Eol;
		if (hunk.pos === "before") eol = original[op.start]?.eol || dominantEol(original);
		else if (hunk.pos === "after" && op.start < original.length) eol = original[op.start]?.eol || dominantEol(original);
		else if (hunk.pos === "after" && original.length > 0) eol = original[original.length - 1].eol || dominantEol(original);
		else if (hunk.pos === "tail" && original.length > 0) eol = original[original.length - 1].eol || dominantEol(original);
		else if (hunk.pos === "head" && original.length > 0) eol = original[0].eol || dominantEol(original);
		else eol = dominantEol(original);
		const finalEol: Eol = hunk.pos === "tail" && original.length > 0 ? original[original.length - 1].eol :
			hunk.pos === "after" && op.start === original.length ? original[original.length - 1]?.eol ?? "" :
			original.length === 0 ? "" : eol;
		const inserted = body.map((content, index) => ({ content, eol: index === body.length - 1 ? finalEol : eol } as TextLine));
		if ((hunk.pos === "tail" || (hunk.pos === "after" && op.start === original.length)) && lines.length > 0 && lines[lines.length - 1].eol === "") {
			lines[lines.length - 1].eol = eol;
		}
		lines.splice(op.start, 0, ...inserted);
	}
	// Every non-final logical line needs a physical separator. Simultaneous
	// operations can otherwise overwrite each other's EOL decisions (for example,
	// replacing an unterminated EOF line while also appending at tail).
	if (lines.length > 0 && original.length > 0) {
		const separator = dominantEol(original);
		for (let i = 0; i < lines.length - 1; i += 1) if (!lines[i].eol) lines[i].eol = separator;
		// Preserve the exact original final terminator, including absence.
		lines[lines.length - 1].eol = original[original.length - 1].eol;
	}
	return { document: { bom: document.bom, lines }, changed, counts };
}
