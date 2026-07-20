import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildRules, hintFor } from "../lib/teach-hints.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

const rules = buildRules((name) => name === "node" || name === "git");
const allOn = () => true;

test("rule table: matches teach, near-misses stay silent", () => {
	const cases: Array<[string, string, string | null]> = [
		["bash", "zsh: pytest: command not found", "missing-cmd"],
		["bash", "ls: cannot access 'x': No such file or directory", null], // missing FILE, not command — did-you-mean territory
		["bash", "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '../lib/nope.ts'", "module-not-found"],
		["read", "Cannot find module 'left-pad'", "module-not-found"],
		["edit", "bad patch: no [path#TAG] section found", "bad-patch"],
		["edit", "stale tag: line 9 not in the tagged snapshot — read the file again", null], // hashline already teaches
		["bash", "tests failed: expected 2 to equal 3", null],
	];
	for (const [tool, text, expected] of cases) {
		const match = hintFor(rules, tool, true, text, undefined, allOn);
		assert.equal(match?.rule ?? null, expected, `${tool}: ${text.slice(0, 40)}`);
	}
});

test("hints carry the useful specifics and never fire on success results", () => {
	const missing = hintFor(rules, "bash", true, "zsh: pytest: command not found", undefined, allOn)!;
	assert.match(missing.hint, /'pytest' is not on PATH/);
	assert.match(missing.hint, /node, git/, "lists what IS available from the probe");
	const mod = hintFor(rules, "bash", true, "Cannot find module '../lib/nope.ts'", undefined, allOn)!;
	assert.match(mod.hint, /'\.\.\/lib\/nope\.ts'/);
	assert.equal(hintFor(rules, "bash", false, "zsh: pytest: command not found", undefined, allOn), null);
});

test("per-rule kill switch disables exactly that rule", () => {
	const enabled = (id: string) => id !== "missing-cmd";
	assert.equal(hintFor(rules, "bash", true, "zsh: pytest: command not found", undefined, enabled), null);
	assert.ok(hintFor(rules, "edit", true, "bad patch: no hunks", undefined, enabled));
});

test("integration: dark by default; on, appends one text block and preserves isError", async () => {
	const dir = mkdtempSync(join(tmpdir(), "teach-hints-"));
	process.env.TELEMETRY_FILE = join(dir, "events.jsonl");
	process.env.TELEMETRY_SOURCE = "test";
	try {
		delete process.env.TEACH_HINTS;
		const offFp = makeFakePi();
		(await import(`../extensions/teach-hints.ts?off=${Date.now()}-${Math.random()}`)).default(offFp.pi as any);
		const errorEvent = () => ({
			toolName: "bash", isError: true, input: { command: "pytest" },
			content: [{ type: "text", text: "zsh: pytest: command not found" }],
		});
		assert.equal(await fire(offFp, "tool_result", errorEvent(), { cwd: dir }), undefined, "dark by default");

		process.env.TEACH_HINTS = "on";
		const onFp = makeFakePi();
		(await import(`../extensions/teach-hints.ts?on=${Date.now()}-${Math.random()}`)).default(onFp.pi as any);
		const result = await fire(onFp, "tool_result", errorEvent(), { cwd: dir });
		assert.ok(result?.content, "hint appended");
		assert.equal(result.content.length, 2, "original error block preserved, one hint added");
		assert.match(result.content[1].text, /is not on PATH/);
		assert.equal(result.isError, undefined, "isError untouched (stays true on the event)");

		process.env.TEACH_HINT_MISSING_CMD = "off";
		const killFp = makeFakePi();
		(await import(`../extensions/teach-hints.ts?kill=${Date.now()}-${Math.random()}`)).default(killFp.pi as any);
		assert.equal(await fire(killFp, "tool_result", errorEvent(), { cwd: dir }), undefined, "kill switch silences the rule");
	} finally {
		delete process.env.TEACH_HINTS;
		delete process.env.TEACH_HINT_MISSING_CMD;
		delete process.env.TELEMETRY_FILE;
		delete process.env.TELEMETRY_SOURCE;
		rmSync(dir, { recursive: true, force: true });
	}
});
