import assert from "node:assert/strict";
import test from "node:test";
import { annotate, applyHunks, detectStyle, fileTag, normalizeText, parsePatch, relocateHunks, restoreStyle } from "../lib/hashline-core.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/hashline.test.ts
// Imports ONLY the zero-dependency core (lives outside extensions/ — pi
// auto-loads every extensions/*.ts, and the SDK doesn't resolve under tsx).

const FILE = "alpha\nbeta\ngamma\ndelta\nepsilon\n";

test("fileTag: stable under CRLF and trailing whitespace, 8-hex", () => {
	const a = fileTag("a\nb\n");
	assert.match(a, /^[0-9A-F]{8}$/);
	assert.equal(fileTag("a  \nb\t\n"), a); // trailing ws stripped
	assert.equal(fileTag(normalizeText("a\r\nb\r\n")), a); // CRLF normalized upstream
	assert.notEqual(fileTag("a\nc\n"), a);
});

test("annotate numbers from startLine", () => {
	assert.equal(annotate(["x", "y"], 5), "5:x\n6:y");
});

test("parse: all ops, single-line shorthand, escaping, wrapper optional", () => {
	const patch = `*** Begin Patch
[f.txt#A1B2]
replace 2..3:
+B
++plus
delete 5
insert after 1:
+-dash
insert head:
+top
*** End Patch`;
	const [sec] = parsePatch(patch);
	assert.equal(sec.path, "f.txt");
	assert.equal(sec.tag, "A1B2");
	assert.equal(sec.hunks.length, 4);
	assert.deepEqual(sec.hunks[0], { op: "replace", start: 2, end: 3, body: ["B", "+plus"] });
	assert.deepEqual(sec.hunks[1], { op: "delete", start: 5, end: 5 });
	assert.deepEqual(sec.hunks[2], { op: "insert", pos: "after", line: 1, body: ["-dash"] });
	assert.deepEqual(sec.hunks[3], { op: "insert", pos: "head", body: ["top"] });
	// no wrapper also parses
	assert.equal(parsePatch("[g.txt#FFFF]\ndelete 1..2").length, 1);
});

test("parse: multi-file sections", () => {
	const secs = parsePatch("[a#0001]\ndelete 1\n[b#0002]\ninsert tail:\n+end");
	assert.equal(secs.length, 2);
	assert.equal(secs[1].path, "b");
});

test("parse: malformed → model-readable errors", () => {
	assert.throws(() => parsePatch("delete 1"), /before any \[path#TAG\]/);
	assert.throws(() => parsePatch("[a#0001]\nwhat 1..2:"), /bad patch line/);
	assert.throws(() => parsePatch("[a#0001]\ninsert after 1:\ndelete 2"), /no "\+" body rows/);
	assert.throws(() => parsePatch("[a#0001]"), /no hunks/);
	assert.throws(() => parsePatch("[a#0001]\ndelete 1\n+extra"), /outside a hunk/);
	assert.throws(() => parsePatch("[a#0001]\nreplace 3..2:"), /range/);
});

test("apply: replace + insert + delete, bottom-up, trailing newline kept", () => {
	const hunks = parsePatch("[f#0000]\nreplace 2..2:\n+BETA\ninsert after 4:\n+NEW\ndelete 5")[0].hunks;
	const r = applyHunks(FILE, hunks);
	assert.equal(r.newText, "alpha\nBETA\ngamma\ndelta\nNEW\n");
	assert.equal(r.firstChangedLine, 2);
	assert.deepEqual(r.counts, { replaced: 1, inserted: 1, deleted: 1 });
});

test("apply: head/tail, no trailing newline preserved", () => {
	const hunks = parsePatch("[f#0000]\ninsert head:\n+first\ninsert tail:\n+last")[0].hunks;
	const r = applyHunks("mid", hunks);
	assert.equal(r.newText, "first\nmid\nlast");
});

test("apply: post-apply positions for re-grounding", () => {
	const hunks = parsePatch("[f#0000]\ninsert before 1:\n+zero\nreplace 3..3:\n+GAMMA")[0].hunks;
	const r = applyHunks(FILE, hunks);
	assert.equal(r.newText, "zero\nalpha\nbeta\nGAMMA\ndelta\nepsilon\n");
	assert.deepEqual(r.changed, [
		{ line: 1, count: 1 },
		{ line: 4, count: 1 },
	]);
});

test("apply: bounds + overlap rejected", () => {
	assert.throws(() => applyHunks(FILE, parsePatch("[f#0000]\ndelete 6")[0].hunks), /out of bounds/);
	assert.throws(() => applyHunks(FILE, parsePatch("[f#0000]\ninsert after 9:\n+x")[0].hunks), /out of bounds/);
	assert.throws(
		() => applyHunks(FILE, parsePatch("[f#0000]\nreplace 1..3:\n+x\ndelete 2..4")[0].hunks),
		/overlapping/,
	);
});

test("relocate: shifted file remaps line numbers", () => {
	// live = snapshot with two lines prepended → all anchors shift by +2
	const live = "new1\nnew2\n" + FILE;
	const hunks = parsePatch("[f#0000]\nreplace 2..2:\n+BETA")[0].hunks;
	const moved = relocateHunks(FILE, live, hunks);
	const r = applyHunks(live, moved);
	assert.equal(r.newText, "new1\nnew2\nalpha\nBETA\ngamma\ndelta\nepsilon\n");
});

test("relocate: ambiguous / vanished context rejected", () => {
	const live = "beta\nx\nbeta\nx\nbeta\n"; // window "alpha,beta,gamma" gone
	const hunks = parsePatch("[f#0000]\nreplace 2..2:\n+B")[0].hunks;
	assert.throws(() => relocateHunks(FILE, live, hunks), /cannot uniquely relocate/);
});

test("relocate: head/tail pass through untouched", () => {
	const hunks = parsePatch("[f#0000]\ninsert head:\n+top")[0].hunks;
	assert.deepEqual(relocateHunks(FILE, "totally\ndifferent\n", hunks), hunks);
});

// ---- QA-round fixes ----

test("B3: replace with no body rows errors instead of silently deleting", () => {
	assert.throws(() => parsePatch("[f#0000]\nreplace 2..4:\ndelete 5"), /no "\+" body rows/);
	assert.throws(() => parsePatch("[f#0000]\nreplace 2..2:"), /to remove lines use delete/);
});

test("insert with no body gives self-correcting error (shows head/tail + bare +)", () => {
	try {
		parsePatch("[f#0000]\ninsert before 1:");
		assert.fail("should have thrown");
	} catch (e) {
		const m = (e as Error).message;
		assert.match(m, /insert head:/);
		assert.match(m, /insert tail:/);
		assert.match(m, /blank line/);
	}
});

test("B4: insert before/after 0 rejected at parse time", () => {
	assert.throws(() => parsePatch("[f#0000]\ninsert before 0:\n+x"), /insert line 0/);
	assert.throws(() => parsePatch("[f#0000]\ninsert after 0:\n+x"), /insert line 0/);
});

test("E2: trailing whitespace on header/op lines tolerated; body keeps its trailing spaces", () => {
	const [sec] = parsePatch("[f.txt#A1B2]  \nreplace 2..2:  \n+kept  ");
	assert.equal(sec.tag, "A1B2");
	assert.deepEqual(sec.hunks[0], { op: "replace", start: 2, end: 2, body: ["kept  "] });
});

test("B1: detectStyle/restoreStyle round-trip CRLF and BOM", () => {
	const raw = "﻿a\r\nb\r\n";
	const style = detectStyle(raw);
	assert.deepEqual(style, { crlf: true, bom: true });
	const norm = normalizeText(raw);
	assert.equal(norm, "a\nb\n");
	assert.equal(restoreStyle(norm, style), raw);
	assert.equal(restoreStyle("x\ny\n", { crlf: false, bom: false }), "x\ny\n");
});

test("B5: ±2 relocation window rejects the duplicate-block trap (±1 mis-targeted it)", () => {
	// snapshot: two identical A/dup/B blocks; target = the SECOND dup (line 5).
	const snap = "A\ndup\nB\nA\ndup\nB\nC\n";
	// live: the second block was removed. With ±1 context the window was just
	// A/dup/B — uniquely matching the SURVIVING first block → silent wrong-copy
	// edit. With ±2 the window (B,A,dup,B,C) no longer exists in live → throws.
	const live = "A\ndup\nB\nC\n";
	const hunks = parsePatch("[f#0000]\nreplace 5..5:\n+DUP2")[0].hunks;
	assert.throws(() => relocateHunks(snap, live, hunks), /cannot uniquely relocate/);
});
