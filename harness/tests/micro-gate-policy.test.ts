import assert from "node:assert/strict";
import test from "node:test";
import { changedPaths, checksFor, firstError } from "../lib/micro-gate-policy.ts";

test("changedPaths: hashline headers, builtin path arg, junk is empty", () => {
	assert.deepEqual(changedPaths("edit", { input: "[src/a.js#A1B2]\n@@\n-x\n+y\n[src/b.py#mossy-gate]\n@@" }),
		["src/a.js", "src/b.py"]);
	assert.deepEqual(changedPaths("edit", { path: "src/c.json", edits: [] }), ["src/c.json"]);
	assert.deepEqual(changedPaths("write", { path: "out.js", content: "x" }), ["out.js"]);
	assert.deepEqual(changedPaths("bash", { command: "sed -i '' 's/x/y/' src/a.py" }), ["src/a.py"]);
	assert.deepEqual(changedPaths("bash", { command: "head src/a.py" }), [], "read-only shell commands are not mutations");
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

// ---------- anti-slop (c29) ----------

import { formatSlop, jsSlopFindings, PYTHON_SLOP_SCRIPT, slopKindFor } from "../lib/micro-gate-policy.ts";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("slopKindFor routes extensions and rejects the rest", () => {
	assert.equal(slopKindFor("a.py"), "python");
	assert.equal(slopKindFor("a.ts"), "js");
	assert.equal(slopKindFor("a.tsx"), "js");
	assert.equal(slopKindFor("a.mjs"), "js");
	assert.equal(slopKindFor("a.json"), null);
	assert.equal(slopKindFor("Makefile"), null);
});

test("jsSlopFindings: hits fire, near-misses stay silent", () => {
	const dirty = [
		"// @ts-ignore",
		"const x = value as any;",
		"try { go(); } catch (e) {}",
		"/* eslint-disable no-console */",
	].join("\n");
	const findings = jsSlopFindings(dirty);
	assert.ok(findings.some((f) => f.endsWith("ts-suppression")), String(findings));
	assert.ok(findings.some((f) => f.endsWith("as-any")));
	assert.ok(findings.some((f) => f.endsWith("empty-catch")));
	assert.ok(findings.some((f) => f.endsWith("eslint-disable")));

	const clean = [
		"catch (e) { log(e); }",              // handled catch — NOT empty
		"const anytime = schedule();",         // 'any' as substring
		"// discusses ts-ignores in prose? no", // no @ marker
		"const y = value as anyOtherType;",    // not the `any` type
	].join("\n");
	assert.deepEqual(jsSlopFindings(clean), []);
});

test("python slop script: real python3 run — dirty file fires, clean file is silent, exit stays 0", () => {
	const dirty = [
		"from typing import Any",
		"def f(*args, **kwargs):",
		"    try:",
		"        pass",
		"    except:",
		"        pass",
		"def g(x: Any) -> None:",
		"    assert True",
		"    while x:",
		"        continue",
	].join("\n");
	const dir = mkdtempSync(join(tmpdir(), "slop-"));
	try {
		const dirtyPath = join(dir, "dirty.py");
		writeFileSync(dirtyPath, dirty);
		const out = execFileSync("python3", ["-c", PYTHON_SLOP_SCRIPT, dirtyPath], { encoding: "utf8" });
		for (const rule of ["bare-except-pass", "lazy-assert", "args-kwargs-signature", "any-annotation", "continue-in-while"]) {
			assert.ok(out.includes(rule), `expected ${rule} in:\n${out}`);
		}
		const cleanPath = join(dir, "clean.py");
		writeFileSync(cleanPath, "def f(x: int) -> int:\n    for i in range(x):\n        if i > 2:\n            continue\n    return x\n");
		assert.equal(execFileSync("python3", ["-c", PYTHON_SLOP_SCRIPT, cleanPath], { encoding: "utf8" }).trim(), "",
			"clean file (continue in FOR, typed sig) stays silent");
		const brokenPath = join(dir, "broken.py");
		writeFileSync(brokenPath, "def f(:\n");
		assert.equal(execFileSync("python3", ["-c", PYTHON_SLOP_SCRIPT, brokenPath], { encoding: "utf8" }).trim(), "",
			"unparseable file belongs to the parse gate — slop stays silent, exit 0");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("formatSlop bounds to 3 findings across files", () => {
	assert.equal(formatSlop([]), null);
	const out = formatSlop([
		{ file: "a.ts", findings: ["1:as-any", "2:empty-catch"] },
		{ file: "b.py", findings: ["3:lazy-assert", "9:bare-except-pass"] },
	]);
	assert.equal(out, "a.ts:1:as-any\na.ts:2:empty-catch\nb.py:3:lazy-assert");
});
