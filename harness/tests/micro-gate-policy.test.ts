import assert from "node:assert/strict";
import test from "node:test";
import { changedPaths, checksFor, firstError } from "../lib/micro-gate-policy.ts";

test("changedPaths: hashline headers, builtin path arg, junk is empty", () => {
	assert.deepEqual(changedPaths("edit", { input: "[src/a.js#A1B2]\n@@\n-x\n+y\n[src/b.py#mossy-gate]\n@@" }),
		["src/a.js", "src/b.py"]);
	assert.deepEqual(changedPaths("edit", { path: "src/c.json", edits: [] }), ["src/c.json"]);
	assert.deepEqual(changedPaths("write", { path: "out.js", content: "x" }), ["out.js"]);
	assert.deepEqual(changedPaths("edit", { input: "no headers here" }), []);
	assert.deepEqual(changedPaths("edit", null), []);
});

test("checksFor: dedup, checkable extensions only, capped", () => {
	const checks = checksFor(["a.js", "a.js", "b.md", "c.py", "d.json", "e.mjs"], 3);
	assert.deepEqual(checks.map((c) => `${c.file}:${c.kind}`), ["a.js:node", "c.py:python", "d.json:json"]);
	assert.deepEqual(checksFor(["readme.md", "notes.txt"]), [], "uncheckable files -> no checks");
});

test("firstError: first non-empty, bounded to actionable size", () => {
	assert.equal(firstError([]), null);
	assert.equal(firstError([{ file: "a.js", err: "  " }]), null);
	const long = Array.from({ length: 40 }, (_, i) => `line${i}`).join("\n");
	const e = firstError([{ file: "a.js", err: "" }, { file: "b.js", err: long }]);
	assert.ok(e?.startsWith("b.js:") && e.split("\n").length <= 6, "location first, wall of text bounded");
});
