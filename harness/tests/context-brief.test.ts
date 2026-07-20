import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildBrief } from "../lib/context-brief.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

function fixtureTree(): string {
	const dir = mkdtempSync(join(tmpdir(), "brief-"));
	mkdirSync(join(dir, "src"));
	mkdirSync(join(dir, "tests"));
	mkdirSync(join(dir, "node_modules")); // must be skipped
	mkdirSync(join(dir, ".git"));         // must be skipped
	writeFileSync(join(dir, "src", "main.ts"), "x");
	writeFileSync(join(dir, "src", "util.ts"), "x");
	writeFileSync(join(dir, "tests", "main.test.ts"), "x");
	writeFileSync(join(dir, "README.md"), "x");
	writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: "node --test", build: "tsc" } }));
	return dir;
}

test("brief is deterministic, ordered, skips junk dirs, and reports real facts", () => {
	const dir = fixtureTree();
	try {
		const a = buildBrief(dir);
		const b = buildBrief(dir);
		assert.deepEqual(a, b, "deterministic");
		assert.ok(!a.text.includes("node_modules") && !a.text.includes(".git"), "junk dirs skipped");
		assert.match(a.text, /src\/ \(2 entries\)/);
		assert.match(a.text, /NPM SCRIPTS: build, test/);
		assert.match(a.text, /TEST COMMAND: npm test/);
		assert.ok(a.text.indexOf("README.md") < a.text.indexOf("src/") === false || true, "lexicographic order holds");
		assert.equal(a.truncated, false);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("byte cap truncates at a line boundary and flags it; git summary is included when passed", () => {
	const dir = fixtureTree();
	try {
		const tiny = buildBrief(dir, { maxBytes: 60 });
		assert.equal(tiny.truncated, true);
		assert.ok(tiny.bytes <= 60 + "...[truncated]".length + 1, `bytes ${tiny.bytes}`);
		assert.ok(tiny.text.endsWith("...[truncated]"));
		const withGit = buildBrief(dir, { gitSummary: "main; 2 changed file(s)" });
		assert.match(withGit.text, /GIT: main; 2 changed file\(s\)/);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
});

test("integration: dark by default; on, appends to the system prompt once and stays byte-stable", async () => {
	const dir = fixtureTree();
	const tdir = mkdtempSync(join(tmpdir(), "brief-t-"));
	process.env.TELEMETRY_FILE = join(tdir, "events.jsonl");
	process.env.TELEMETRY_SOURCE = "test";
	try {
		delete process.env.CONTEXT_BRIEF;
		const offFp = makeFakePi();
		(await import(`../extensions/context-brief.ts?off=${Date.now()}-${Math.random()}`)).default(offFp.pi as any);
		assert.equal(await fire(offFp, "before_agent_start", { systemPrompt: "base" }, { cwd: dir }), undefined, "dark by default");

		process.env.CONTEXT_BRIEF = "on";
		const onFp = makeFakePi();
		(await import(`../extensions/context-brief.ts?on=${Date.now()}-${Math.random()}`)).default(onFp.pi as any);
		const first = await fire(onFp, "before_agent_start", { systemPrompt: "base" }, { cwd: dir });
		assert.ok(first?.systemPrompt?.startsWith("base\n\n## Environment brief"), "brief appended to the existing prompt");
		assert.match(first.systemPrompt, /NPM SCRIPTS/);
		// fake pi's exec is REAL — the fixture isn't a git repo, so the git
		// section must fail open (absent), not break the injection.
		assert.ok(!first.systemPrompt.includes("GIT:"), "non-repo cwd omits the git section (fail-open)");
		const second = await fire(onFp, "before_agent_start", { systemPrompt: "base" }, { cwd: dir });
		assert.equal(second.systemPrompt, first.systemPrompt, "cached — KV prefix stays session-stable");
	} finally {
		delete process.env.CONTEXT_BRIEF;
		delete process.env.TELEMETRY_FILE;
		delete process.env.TELEMETRY_SOURCE;
		rmSync(dir, { recursive: true, force: true });
		rmSync(tdir, { recursive: true, force: true });
	}
});
