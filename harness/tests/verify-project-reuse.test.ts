// verify_project reuses a result only when provably nothing changed. Real git repos,
// a real `npm test` gate that counts its runs in a file outside the repository.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fire, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

function project(options: { git?: boolean; gateWritesUntracked?: boolean } = {}) {
	const dir = mkdtempSync(join(tmpdir(), "vg-reuse-"));
	const counter = join(mkdtempSync(join(tmpdir(), "vg-reuse-count-")), "runs");
	writeFileSync(counter, "");
	const body = `require('fs').appendFileSync(${JSON.stringify(counter)}, 'x')` +
		(options.gateWritesUntracked ? `; require('fs').writeFileSync('coverage-' + Date.now() + '.txt', 'c')` : "");
	writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts: { test: `node -e "${body.replace(/"/g, '\\"')}"` } }));
	writeFileSync(join(dir, "app.js"), "module.exports = 1;\n");
	if (options.git !== false) {
		execFileSync("git", ["init", "-q"], { cwd: dir });
		execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "add", "-A"], { cwd: dir });
		execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"], { cwd: dir });
	}
	return { dir, runs: () => readFileSync(counter, "utf8").length };
}

async function harness(cwd: string) {
	const fp = makeFakePi();
	const previous = process.env.VERIFY_EXECUTION_ORDER;
	process.env.VERIFY_EXECUTION_ORDER = "execution";
	const mod = await import(`../extensions/verify-gate.ts?reuse=${Date.now()}-${Math.random()}`);
	if (previous === undefined) delete process.env.VERIFY_EXECUTION_ORDER; else process.env.VERIFY_EXECUTION_ORDER = previous;
	mod.default(fp.pi as never);
	await fire(fp, "session_start", {}, { cwd });
	let n = 0;
	const verify = async (params: Record<string, unknown> = {}) => {
		const id = `vp${++n}`;
		await fire(fp, "tool_execution_start", { toolCallId: id, toolName: "verify_project", args: params }, { cwd, ui: { notify() {} } });
		const result = await fp.tools.get("verify_project").execute(id, params, undefined, undefined, { cwd });
		await fire(fp, "tool_execution_end", { toolCallId: id, toolName: "verify_project", result, isError: false }, { cwd, ui: { notify() {} } });
		return result.content[0].text as string;
	};
	const toolStart = (toolName: string, args: Record<string, unknown>) =>
		fire(fp, "tool_execution_start", { toolCallId: `t${++n}`, toolName, args }, { cwd, ui: { notify() {} } });
	return { fp, verify, toolStart };
}

test("an identical verify_project with nothing changed reuses the result", async () => {
	const p = project();
	const h = await harness(p.dir);
	try {
		assert.match(await h.verify(), /passed/);
		await h.toolStart("read", { path: "app.js" });
		const second = await h.verify();
		assert.equal(p.runs(), 1, "the gate ran once");
		assert.match(second, /result was reused; pass force: true to re-run/);
	} finally { resetPiGlobals(); }
});

test("any possibly-mutating tool, a file change, force, or a new user message re-runs the gate", async () => {
	const p = project();
	const h = await harness(p.dir);
	try {
		await h.verify();
		await h.toolStart("edit", { path: "app.js" }); await h.verify();
		assert.equal(p.runs(), 2, "an edit tool call invalidates");
		await h.toolStart("bash", { command: "npm install" }); await h.verify();
		assert.equal(p.runs(), 3, "a possibly-mutating bash command invalidates");
		writeFileSync(join(p.dir, "app.js"), "module.exports = 2;\n"); await h.verify();
		assert.equal(p.runs(), 4, "a change made outside any tool is caught by the fingerprint");
		await h.verify({ force: true });
		assert.equal(p.runs(), 5, "force re-runs");
		await fire(h.fp, "before_agent_start", { prompt: "next" }, { cwd: p.dir }); await h.verify();
		assert.equal(p.runs(), 6, "a new user message re-runs");
	} finally { resetPiGlobals(); }
});

test("outside git, or when the gate itself changes the tree, nothing is reused", async () => {
	const plain = project({ git: false });
	const h1 = await harness(plain.dir);
	try { await h1.verify(); await h1.verify(); assert.equal(plain.runs(), 2, "no fingerprint without git"); } finally { resetPiGlobals(); }
	const writer = project({ gateWritesUntracked: true });
	const h2 = await harness(writer.dir);
	try { await h2.verify(); await h2.verify(); assert.equal(writer.runs(), 2, "a gate that writes files is never reused"); } finally { resetPiGlobals(); }
});
