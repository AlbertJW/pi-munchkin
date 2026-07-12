// Hashline pure core — tag, grammar, apply, relocate. No SDK imports by design:
// extensions/hashline.ts wires it to pi; tests/hashline.test.ts runs it
// standalone (no SDK resolution needed). Format from can1357/oh-my-pi
// (packages/hashline: format.ts, grammar.lark).
import { TAG_WORDS } from "./tag-words.ts";

export function normalizeText(s: string): string {
	return s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

function rotl(x: number, r: number): number {
	return (x << r) | (x >>> (32 - r));
}

function read32(b: Uint8Array, i: number): number {
	return b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24);
}

// Standard xxHash32 (matches OMP's choice; exact parity not load-bearing —
// the tag is session-internal).
export function xxHash32(input: Uint8Array, seed = 0): number {
	const P1 = 0x9e3779b1, P2 = 0x85ebca77, P3 = 0xc2b2ae3d, P4 = 0x27d4eb2f, P5 = 0x165667b1;
	const len = input.length;
	let i = 0;
	let h: number;
	if (len >= 16) {
		let v1 = (seed + P1 + P2) | 0, v2 = (seed + P2) | 0, v3 = seed | 0, v4 = (seed - P1) | 0;
		const limit = len - 16;
		while (i <= limit) {
			v1 = Math.imul(rotl((v1 + Math.imul(read32(input, i), P2)) | 0, 13), P1); i += 4;
			v2 = Math.imul(rotl((v2 + Math.imul(read32(input, i), P2)) | 0, 13), P1); i += 4;
			v3 = Math.imul(rotl((v3 + Math.imul(read32(input, i), P2)) | 0, 13), P1); i += 4;
			v4 = Math.imul(rotl((v4 + Math.imul(read32(input, i), P2)) | 0, 13), P1); i += 4;
		}
		h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) | 0;
	} else {
		h = (seed + P5) | 0;
	}
	h = (h + len) | 0;
	while (i + 4 <= len) {
		h = Math.imul(rotl((h + Math.imul(read32(input, i), P3)) | 0, 17), P4);
		i += 4;
	}
	while (i < len) {
		h = Math.imul(rotl((h + Math.imul(input[i], P5)) | 0, 11), P1);
		i += 1;
	}
	h ^= h >>> 15;
	h = Math.imul(h, P2);
	h ^= h >>> 13;
	h = Math.imul(h, P3);
	h ^= h >>> 16;
	return h >>> 0;
}

// 8-hex file-version tag: trailing whitespace stripped per line (CRLF/display
// trim insensitivity, per OMP). OMP masks to 16 bits; we keep the full 32 —
// a 1/65536 silent wrong-baseline collision is too likely over hundreds of
// edits, and the cost is 4 extra chars per header.
//
// HASHLINE_TAG=slug (candidate c14) encodes the top 24 bits as three words —
// small models mangle hex tags ("#main" invented live) but copy real words
// reliably. 24 vs 32 bits: the snapshot store dedupes by tag AND text, and
// stale-tag content relocation catches the residual, so the smaller space
// trades negligible risk for copy fidelity. Read once at load, like other
// env gates.
const TAG_STYLE = process.env.HASHLINE_TAG === "slug" ? "slug" : "hex";

export function tagWords(h: number): string {
	return [(h >>> 24) & 0xff, (h >>> 16) & 0xff, (h >>> 8) & 0xff].map((b) => TAG_WORDS[b]).join("-");
}

export function fileTag(text: string): string {
	const stripped = text.replace(/[ \t\r]+(?=\n|$)/g, "");
	const h = xxHash32(new TextEncoder().encode(stripped)) >>> 0;
	if (TAG_STYLE === "slug") return tagWords(h);
	return h.toString(16).padStart(8, "0").toUpperCase();
}

export function annotate(lines: string[], startLine: number): string {
	return lines.map((l, i) => `${startLine + i}:${l}`).join("\n");
}

export type Hunk =
	| { op: "replace"; start: number; end: number; body: string[] }
	| { op: "insert"; pos: "before" | "after" | "head" | "tail"; line?: number; body: string[] }
	| { op: "delete"; start: number; end: number };

export type Section = { path: string; tag: string; hunks: Hunk[] };

// Accepts both tag encodings: hex (default) and word-slug (HASHLINE_TAG=slug,
// any case — models sometimes shout; normalization below lowercases slugs).
const HEADER_RE = /^\[([^#\]]+)#([0-9A-Fa-f]{4,8}|[A-Za-z]+(?:-[A-Za-z]+){1,3})\]$/;

// EOL/BOM round-trip helpers: the engine works on normalized LF text; callers
// detect the original style and restore it on write so a one-line edit never
// rewrites a whole CRLF/BOM'd file.
export function detectStyle(raw: string): { crlf: boolean; bom: boolean } {
	return { crlf: raw.includes("\r\n"), bom: raw.startsWith("﻿") };
}

export function restoreStyle(text: string, style: { crlf: boolean; bom: boolean }): string {
	let out = style.crlf ? text.replace(/\n/g, "\r\n") : text;
	if (style.bom && !out.startsWith("﻿")) out = "﻿" + out;
	return out;
}
const REPLACE_RE = /^replace (\d+)(?:\.\.(\d+))?:$/;
const INSERT_RE = /^insert (before|after) (\d+):$/;
const INSERT_EDGE_RE = /^insert (head|tail):$/;
const DELETE_RE = /^delete (\d+)(?:\.\.(\d+))?:?$/;

export function parsePatch(input: string): Section[] {
	const sections: Section[] = [];
	let cur: Section | null = null;
	let curHunk: (Hunk & { body: string[] }) | null = null; // delete hunks never become curHunk
	const lines = normalizeText(input).split("\n");

	const closeHunk = (lineNo: number) => {
		if (!curHunk) return;
		if (curHunk.body.length === 0) {
			// No "+" rows. Self-correcting error — branch by op so a small model
			// gets the exact fix (replace-with-empty would silently DELETE, so we
			// reject it too; `delete` is the explicit removal op).
			if (curHunk.op === "insert") {
				throw new Error(
					`bad patch: insert before line ${lineNo} has no "+" body rows. Each new line needs a leading "+", e.g.:\n` +
						`insert head:\n+## [2026-01-01] note\n+\n(a bare "+" = blank line). For the top of a file use "insert head:", for the bottom "insert tail:".`,
				);
			}
			throw new Error(`bad patch: replace hunk before line ${lineNo} has no "+" body rows (to remove lines use delete).`);
		}
		curHunk = null;
	};

	for (let n = 0; n < lines.length; n++) {
		const raw = lines[n];
		const line = raw.trimEnd(); // headers/ops tolerate trailing whitespace; body rows use raw
		if (line.trim() === "" || /^\*\*\* (Begin|End) Patch$/.test(line.trim())) {
			continue; // wrapper optional, blank lines ignored (blank BODY line = "+")
		}
		if (raw.startsWith("+")) {
			// (delete hunks never become curHunk — a "+" row after delete lands here as "outside a hunk")
			if (!curHunk) throw new Error(`bad patch line ${n + 1}: "+" body row outside a hunk (delete takes no body)`);
			curHunk.body.push(raw.slice(1)); // raw — body content keeps its trailing whitespace
			continue;
		}
		let m: RegExpMatchArray | null;
		if ((m = line.match(HEADER_RE))) {
			closeHunk(n + 1);
			if (cur && cur.hunks.length === 0) throw new Error(`bad patch: section [${cur.path}] has no hunks`);
			// hex tags normalize to upper (case-insensitive copy tolerance); slug
			// tags contain "-" and normalize to lower — uppercasing them would
			// mismatch every stored lowercase slug and fail all slug edits.
			cur = { path: m[1], tag: m[2].includes("-") ? m[2].toLowerCase() : m[2].toUpperCase(), hunks: [] };
			sections.push(cur);
			continue;
		}
		if (!cur) throw new Error(`bad patch line ${n + 1}: "${line.slice(0, 60)}" before any [path#TAG] header`);
		closeHunk(n + 1);
		if ((m = line.match(REPLACE_RE))) {
			const start = Number(m[1]);
			const end = m[2] ? Number(m[2]) : start;
			if (end < start || start < 1) throw new Error(`bad patch line ${n + 1}: range ${start}..${end}`);
			curHunk = { op: "replace", start, end, body: [] };
			cur.hunks.push(curHunk);
		} else if ((m = line.match(INSERT_RE))) {
			const at = Number(m[2]);
			if (at < 1) throw new Error(`bad patch line ${n + 1}: insert line ${at} (lines are 1-indexed; use "insert head:")`);
			curHunk = { op: "insert", pos: m[1] as "before" | "after", line: at, body: [] };
			cur.hunks.push(curHunk);
		} else if ((m = line.match(INSERT_EDGE_RE))) {
			curHunk = { op: "insert", pos: m[1] as "head" | "tail", body: [] };
			cur.hunks.push(curHunk);
		} else if ((m = line.match(DELETE_RE))) {
			const start = Number(m[1]);
			const end = m[2] ? Number(m[2]) : start;
			if (end < start || start < 1) throw new Error(`bad patch line ${n + 1}: range ${start}..${end}`);
			cur.hunks.push({ op: "delete", start, end });
			curHunk = null;
		} else {
			throw new Error(
				`bad patch line ${n + 1}: "${line.slice(0, 60)}" — expected [path#TAG], ` +
					`replace N..M: / insert before|after N: / insert head|tail: / delete N..M, or a "+" body row`,
			);
		}
	}
	closeHunk(lines.length);
	if (sections.length === 0) throw new Error("bad patch: no [path#TAG] section found");
	for (const s of sections) if (s.hunks.length === 0) throw new Error(`bad patch: section [${s.path}] has no hunks`);
	return sections;
}

// Internal op form: half-open index range [start, end) replaced by body.
type Op = { start: number; end: number; body: string[] };

function toOps(hunks: Hunk[], lineCount: number): Op[] {
	const ops: Op[] = [];
	for (const h of hunks) {
		if (h.op === "replace" || h.op === "delete") {
			if (h.end > lineCount) throw new Error(`line ${h.end} out of bounds (file has ${lineCount} lines)`);
			ops.push({ start: h.start - 1, end: h.end, body: h.op === "replace" ? h.body : [] });
		} else if (h.pos === "head") {
			ops.push({ start: 0, end: 0, body: h.body });
		} else if (h.pos === "tail") {
			ops.push({ start: lineCount, end: lineCount, body: h.body });
		} else {
			const ln = h.line ?? 0;
			if (ln > lineCount || ln < 1) throw new Error(`line ${ln} out of bounds (file has ${lineCount} lines)`);
			const at = h.pos === "before" ? ln - 1 : ln;
			ops.push({ start: at, end: at, body: h.body });
		}
	}
	ops.sort((a, b) => a.start - b.start || a.end - b.end);
	for (let i = 1; i < ops.length; i++) {
		if (ops[i].start < ops[i - 1].end) {
			throw new Error(`overlapping hunks around line ${ops[i].start + 1} — merge them into one range`);
		}
	}
	return ops;
}

export type ApplyResult = {
	newText: string;
	firstChangedLine: number;
	// post-apply positions for re-grounding: [newStartLine, newLineCount] per op
	changed: { line: number; count: number }[];
	counts: { replaced: number; inserted: number; deleted: number };
};

export function applyHunks(text: string, hunks: Hunk[]): ApplyResult {
	const hadTrailingNL = text.endsWith("\n");
	const lines = text === "" ? [] : text.split("\n");
	if (hadTrailingNL) lines.pop(); // trailing sentinel is not an editable line
	const ops = toOps(hunks, lines.length);

	const counts = { replaced: 0, inserted: 0, deleted: 0 };
	for (const h of hunks) {
		if (h.op === "replace") counts.replaced += 1;
		else if (h.op === "delete") counts.deleted += 1;
		else counts.inserted += 1;
	}

	// Post-apply position of each op = its start shifted by the net delta of
	// all ops above it. Apply bottom-up so indexes stay valid.
	const changed: { line: number; count: number }[] = [];
	let delta = 0;
	for (const op of ops) {
		changed.push({ line: op.start + delta + 1, count: op.body.length });
		delta += op.body.length - (op.end - op.start);
	}
	for (let i = ops.length - 1; i >= 0; i--) {
		const op = ops[i];
		lines.splice(op.start, op.end - op.start, ...op.body);
	}

	return {
		newText: lines.join("\n") + (hadTrailingNL ? "\n" : ""),
		firstChangedLine: ops.length ? ops[0].start + 1 : 1,
		changed,
		counts,
	};
}

// Stale-tag rebase: for each hunk, take the SNAPSHOT's target lines ±1 context
// line and find a unique exact match in the live file; shift line numbers by
// the offset. No unique match → stale error (model must re-read).
export function relocateHunks(snapText: string, liveText: string, hunks: Hunk[]): Hunk[] {
	const snap = snapText.replace(/\n$/, "").split("\n");
	const live = liveText.replace(/\n$/, "").split("\n");

	const findUnique = (window: string[], around: number): number => {
		if (window.length === 0) return -1;
		const hits: number[] = [];
		for (let i = 0; i + window.length <= live.length; i++) {
			let ok = true;
			for (let j = 0; j < window.length; j++) {
				if (live[i + j] !== window[j]) { ok = false; break; }
			}
			if (ok) hits.push(i);
		}
		if (hits.length === 1) return hits[0];
		if (hits.length > 1) {
			// prefer the hit STRICTLY closest to the original position; a tie is ambiguous
			hits.sort((a, b) => Math.abs(a - around) - Math.abs(b - around));
			if (Math.abs(hits[0] - around) < Math.abs(hits[1] - around)) return hits[0];
		}
		return -1;
	};

	return hunks.map((h) => {
		if (h.op === "insert" && (h.pos === "head" || h.pos === "tail")) return h; // no anchor needed
		const ref = h.op === "insert" ? (h.line ?? 1) : h.start;
		const s = ref - 1;
		const e = h.op === "insert" ? ref : h.end;
		if (e > snap.length) throw new Error(`stale tag: line ${e} not in the tagged snapshot — read the file again`);
		// ±2 context lines: ±1 made 3-line windows, too thin against repetitive
		// code (imports, test boilerplate) — a duplicate window relocates an edit
		// onto the wrong copy.
		const winStart = Math.max(0, s - 2);
		const winEnd = Math.min(snap.length, e + 2);
		const window = snap.slice(winStart, winEnd);
		const at = findUnique(window, winStart);
		if (at < 0) {
			throw new Error(
				`stale tag: cannot uniquely relocate ${h.op} at line ${ref} — the file changed too much. Read the file again, then re-emit the patch with fresh numbers.`,
			);
		}
		const shift = at - winStart;
		if (h.op === "insert") return { ...h, line: ref + shift };
		return { ...h, start: h.start + shift, end: h.end + shift };
	});
}

