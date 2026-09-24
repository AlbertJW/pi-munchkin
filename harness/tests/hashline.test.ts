import assert from "node:assert/strict";
import test from "node:test";
import { applyHunks, decodeDocument, fileTag, parsePatch, serializeDocument } from "../lib/hashline-core.ts";

const tag = fileTag("x");
const patch = (body: string) => `[f#${tag}]\n${body}`;
const apply = (bytes: string | Buffer, body: string) => {
	const source = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
	const result = applyHunks(decodeDocument(source), parsePatch(patch(body))[0].hunks);
	return serializeDocument(result.document);
};

test("fileTag is exact-byte SHA-256 and detects every byte-only newline/BOM/whitespace change", () => {
	assert.match(tag, /^[0-9A-F]{64}$/);
	assert.equal(fileTag(Buffer.from("abc")), fileTag(Buffer.from("abc")));
	for (const [left, right] of [["a\n", "a\r\n"], ["a", "a\n"], ["a ", "a"], ["a", "\uFEFFa"]]) {
		assert.notEqual(fileTag(Buffer.from(left)), fileTag(Buffer.from(right)));
	}
});

test("decodeDocument strictly accepts UTF-8 plus BOM and rejects invalid UTF-8, NUL, and UTF-16", () => {
	assert.deepEqual(decodeDocument(Buffer.from("\uFEFFa\r\nb", "utf8")), {
		bom: true,
		lines: [{ content: "a", eol: "\r\n" }, { content: "b", eol: "" }],
	});
	assert.throws(() => decodeDocument(Buffer.from([0xff, 0xfe, 0x61, 0x00])), /not valid UTF-8/);
	assert.throws(() => decodeDocument(Buffer.from([0xc3, 0x28])), /not valid UTF-8/);
	assert.throws(() => decodeDocument(Buffer.from("a\0b")), /NUL byte/);
});

test("decodeDocument preserves content BOMs after the optional byte-order mark", () => {
	const bytes = Buffer.from("\uFEFF\uFEFFa", "utf8");
	assert.deepEqual(serializeDocument(decodeDocument(bytes)), bytes);
});

test("serializeDocument rejects NUL and unpaired surrogates before bytes can be written", () => {
	for (const content of ["b\0c", "b\uD800c", "ordinary\uD800", "b\uDC00c"]) {
		assert.throws(() => serializeDocument({ bom: false, lines: [{ content, eol: "" }] }), /NUL byte|unpaired surrogate/);
	}
	const valid = { bom: false, lines: [{ content: "before 😀 after", eol: "" as const }] };
	assert.equal(serializeDocument(valid).toString("utf8"), "before 😀 after", "valid surrogate pairs remain valid UTF-8");
	assert.throws(() => serializeDocument({ bom: false, lines: [{ content: "line\uD800", eol: "\n" }, { content: "next", eol: "" }] }), /unpaired surrogate/,
		"a high surrogate at the end of a non-final patch body line must reject");
});

test("parsePatch accepts exactly 64-hex tags and retains the existing patch grammar", () => {
	const [section] = parsePatch(`[f#${tag.toLowerCase()}]\nreplace 2..3:\n+B\n++plus\ndelete 5\ninsert after 1:\n+-dash\ninsert head:\n+top`);
	assert.equal(section.tag, tag);
	assert.equal(section.hunks.length, 4);
	assert.throws(() => parsePatch("[f#A1B2]\ndelete 1"), /tag must be exactly 64 hexadecimal/);
});

test("apply preserves LF, CRLF, CR, mixed endings, BOM, and final-newline state", () => {
	assert.equal(apply("a\nb\n", "replace 2:\n+B" ).toString(), "a\nB\n");
	assert.equal(apply("a\r\nb\r\n", "replace 2:\n+B").toString(), "a\r\nB\r\n");
	assert.equal(apply("a\rb\r", "replace 2:\n+B").toString(), "a\rB\r");
	assert.equal(apply("a\r\nb\nc\r", "replace 2:\n+B").toString(), "a\r\nB\nc\r");
	assert.equal(apply("\uFEFFa\r\n", "replace 1:\n+B").toString(), "\uFEFFB\r\n");
	assert.equal(apply("a", "replace 1:\n+B").toString(), "B");
});

test("empty/BOM-only insertion, delete-all, final replacement, and tail insertion have exact bytes", () => {
	assert.equal(apply("", "insert head:\n+x").toString(), "x");
	assert.equal(apply("\uFEFF", "insert head:\n+x").toString(), "\uFEFFx");
	assert.equal(apply("a\nb\n", "delete 1..2").toString(), "");
	assert.equal(apply("\uFEFFa\r\n", "delete 1").toString(), "\uFEFF");
	assert.equal(apply("a\n", "replace 1:\n+b").toString(), "b\n");
	assert.equal(apply("a", "replace 1:\n+b").toString(), "b");
	assert.equal(apply("a", "insert tail:\n+b").toString(), "a\nb");
	assert.equal(apply("a\n", "insert tail:\n+b").toString(), "a\nb\n");
	assert.equal(apply("a", "replace 1:\n+b\ninsert tail:\n+c").toString(), "b\nc",
		"a replaced unterminated final line becomes separated from appended content without adding a final newline");
	assert.equal(apply("a", "delete 1\ninsert tail:\n+c").toString(), "c",
		"deleting the only original line before tail insertion leaves the inserted final line unterminated");
	assert.equal(apply("a\nb", "delete 2\ninsert tail:\n+c").toString(), "a\nc",
		"deleting an unterminated final line before tail insertion preserves the boundary and no-final-newline policy");
	assert.equal(apply("a\nb", "replace 2:\n+B\ninsert tail:\n+c").toString(), "a\nB\nc");
});

test("EOL inheritance ties resolve by first occurrence; same-position insertions reject", () => {
	assert.equal(apply("a\r\nb\nc\r", "replace 1..3:\n+x\n+y").toString(), "x\r\ny\r");
	assert.throws(() => apply("a\nb", "insert before 1:\n+x\ninsert before 1:\n+y"), /ambiguous same-position insertions/);
});

test("repeated line numbers address positions, with stable bottom-up multi-hunk application", () => {
	const source = "dup\nmid\ndup\nend\n";
	const result = applyHunks(decodeDocument(Buffer.from(source)), parsePatch(`[f#${fileTag(source)}]\nreplace 3:\n+second\nreplace 1:\n+first`)[0].hunks);
	assert.equal(serializeDocument(result.document).toString(), "first\nmid\nsecond\nend\n");
});

test("replacement of multiple lines preserves the final terminator of the range", () => {
	assert.equal(apply("a\r\nb", "replace 1..2:\n+x\n+y").toString(), "x\r\ny");
	assert.equal(apply("a\nb\n", "replace 1..2:\n+x\n+y").toString(), "x\ny\n");
});
