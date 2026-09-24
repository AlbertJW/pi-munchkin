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

export type Hunk =
	| { op: "replace"; start: number; end: number; body: string[] }
	| { op: "insert"; pos: "before" | "after" | "head" | "tail"; line?: number; body: string[] }
	| { op: "delete"; start: number; end: number };

export type Section = { path: string; tag: string; hunks: Hunk[] };

const HEADER_RE = /^\[([^#\]]+)#([0-9A-Fa-f]{64})\]$/;
const REPLACE_RE = /^replace (\d+)(?:\.\.(\d+))?:$/;
const INSERT_RE = /^insert (before|after) (\d+):$/;
const INSERT_EDGE_RE = /^insert (head|tail):$/;
const DELETE_RE = /^delete (\d+)(?:\.\.(\d+))?:?$/;

export function parsePatch(input: string): Section[] {
	const sections: Section[] = [];
	let cur: Section | null = null;
	let curHunk: { op: "replace" | "insert"; body: string[] } & Partial<Hunk> | null = null;
	const lines = input.replace(/\r\n?/g, "\n").split("\n");
	const closeHunk = (lineNo: number) => {
		if (!curHunk) return;
		if (curHunk.body.length === 0) {
			if (curHunk.op === "insert") {
				throw new Error(`bad patch: insert before line ${lineNo} has no "+" body rows. Use "insert head:" or "insert tail:"; a bare "+" inserts a blank line.`);
			}
			throw new Error(`bad patch: replace hunk before line ${lineNo} has no "+" body rows (to remove lines use delete).`);
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
		if (!cur) throw new Error(`bad patch line ${n + 1}: "${line.slice(0, 60)}" before any [path#TAG] header`);
		closeHunk(n + 1);
		if ((m = line.match(REPLACE_RE))) {
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
			throw new Error(`bad patch line ${n + 1}: "${line.slice(0, 60)}" — expected [path#64-HEX], replace N..M:, insert before|after N:, insert head|tail:, delete N..M, or a + body row`);
		}
	}
	closeHunk(lines.length);
	if (sections.length === 0) throw new Error("bad patch: no [path#TAG] section found");
	for (const section of sections) if (section.hunks.length === 0) throw new Error(`bad patch: section [${section.path}] has no hunks`);
	return sections;
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
