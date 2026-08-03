import assert from "node:assert/strict";
import test from "node:test";
import { fire, makeFakePi } from "./integration-harness.ts";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSpecPaths, pathMatchesSpec, steerMessage } from "../extensions/spec-adherence.ts";

// Hermetic fixture: the extension resolves prompt-named paths against the SESSION cwd,
// so the tests must own that directory rather than depend on ambient repo files
// (an earlier version asserted README.md existed in cwd — true in pi_munchkin, false
// in ~/.pi/agent, so the mirrored copy failed).
function specWorkdir(): string {
	const dir = mkdtempSync(join(tmpdir(), "spec-adherence-"));
	mkdirSync(join(dir, "docs"), { recursive: true });
	writeFileSync(join(dir, "docs", "naming.md"), "# spec\nAuthoritative mappings.\n");
	return dir;
}

// pi carries `args` on tool_execution_START and _UPDATE but NOT on _END — the
// emitter builds each event explicitly (agent-session.js:487-514). Tests MUST go
// through this pair. The previous version hand-fired a single _end carrying
// `args`, a shape pi never produces, and that fiction is what certified the
// extension's read-detection as working while it was dead code for a whole
// candidate cycle. Never hand-build an event shape without checking the emitter.
async function toolCall(
	fp: ReturnType<typeof makeFakePi>, toolCallId: string, toolName: string,
	args: Record<string, unknown>, isError: boolean,
): Promise<void> {
	await fire(fp, "tool_execution_start", { toolCallId, toolName, args });
	await fire(fp, "tool_execution_end", { toolCallId, toolName, result: {}, isError });
}

// Run: cd ~/.pi/agent && TELEMETRY_FILE=$(mktemp) TELEMETRY_SOURCE=test \
//        npx -y tsx --test tests/spec-adherence.test.ts
// (TELEMETRY_FILE is not optional: without it these tests append REAL rows to
//  ~/.pi/agent/telemetry/events.jsonl tagged source=\"interactive\", polluting the
//  live telemetry stream the harness is measured from.)

test("extracts only prompt-named paths that exist under cwd", () => {
	const onDisk = new Set(["/w/docs/naming.md", "/w/data/charmap.json"]);
	const exists = (p: string) => onDisk.has(p);
	const prompt = "See docs/naming.md (authoritative) and data/charmap.json; ignore ghost.md and /etc/passwd.txt and ../up.md";
	assert.deepEqual(extractSpecPaths(prompt, "/w", exists), ["docs/naming.md", "data/charmap.json"]);
	assert.deepEqual(extractSpecPaths("no paths here", "/w", exists), []);
	assert.deepEqual(extractSpecPaths("./docs/naming.md twice, docs/naming.md again", "/w", exists), ["docs/naming.md"]);
});

test("a read only counts on a PATH BOUNDARY, not a bare suffix", () => {
	// `.endsWith(spec)` alone marked docs/other-naming.md as satisfying naming.md,
	// which would silently suppress a steer the model had earned.
	assert.equal(pathMatchesSpec("docs/naming.md", "docs/naming.md"), true);
	assert.equal(pathMatchesSpec("/abs/root/docs/naming.md", "docs/naming.md"), true);
	assert.equal(pathMatchesSpec("naming.md", "naming.md"), true);
	assert.equal(pathMatchesSpec("docs/other-naming.md", "naming.md"), false, "suffix without a separator is a different file");
	assert.equal(pathMatchesSpec("docs/renaming.md", "naming.md"), false);
});

test("steer message names the path and the corrective action", () => {
	const msg = steerMessage("docs/naming.md");
	assert.match(msg, /docs\/naming\.md/);
	assert.match(msg, /Read it before the next attempt/);
});

test("extension lifecycle: arm → fail twice → steer once per unread spec, dark off", async () => {
	const fp = makeFakePi();
	const sent = fp.sent;
	const prev = process.env.SPEC_ADHERENCE;
	let work = "";
	try {
		delete process.env.SPEC_ADHERENCE;
		const off = await import(`../extensions/spec-adherence.ts?off=${Date.now()}-${Math.random()}`);
		off.default(fp.pi as never);
		assert.equal(fp.handlers.size, 0, "dark by default");

		process.env.SPEC_ADHERENCE = "on";
		const mod = await import(`../extensions/spec-adherence.ts?on=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		work = specWorkdir();
		await fire(fp, "session_start", {}, { cwd: work });
		await fire(fp, "before_agent_start", { prompt: "Fix slugs per docs/naming.md, the authoritative spec." });

		await fire(fp, "turn_end", { turnIndex: 1 });
		assert.equal(sent.length, 0, "no steer before failures accumulate");

		await toolCall(fp, "tc1", "edit", { path: "src/x.ts" }, true);
		await fire(fp, "turn_end", { turnIndex: 2 });
		assert.equal(sent.length, 0, "one failure is not enough");

		await toolCall(fp, "tc2", "edit", { path: "src/x.ts" }, true);
		await fire(fp, "turn_end", { turnIndex: 3 });
		assert.equal(sent.length, 1, "two failing mutations + unread spec → steer");
		assert.match(sent[0], /docs\/naming\.md/);

		await fire(fp, "turn_end", { turnIndex: 4 });
		assert.equal(sent.length, 1, "once per path — no repeat");
		assert.equal(fp.deliveries[0].deliverAs, "steer");
		assert.equal(fp.deliveries[0].effective, "delivered", "the steer must actually reach the model");
	} finally {
		if (prev === undefined) delete process.env.SPEC_ADHERENCE; else process.env.SPEC_ADHERENCE = prev;
		if (work) rmSync(work, { recursive: true, force: true });
	}
});

test("reading the spec (read tool or bash cat) suppresses the steer", async () => {
	const fp = makeFakePi();
	const sent = fp.sent;
	const prev = process.env.SPEC_ADHERENCE;
	process.env.SPEC_ADHERENCE = "on";
	const work = specWorkdir();
	try {
		const mod = await import(`../extensions/spec-adherence.ts?read=${Date.now()}-${Math.random()}`);
		mod.default(fp.pi as never);
		await fire(fp, "session_start", {}, { cwd: work });
		await fire(fp, "before_agent_start", { prompt: "Follow docs/naming.md exactly." });
		await toolCall(fp, "tc1", "bash", { command: "cat docs/naming.md | head -50" }, false);
		await toolCall(fp, "tc2", "edit", {}, true);
		await toolCall(fp, "tc3", "edit", {}, true);
		await fire(fp, "turn_end", { turnIndex: 3 });
		assert.equal(sent.length, 0, "spec was read via bash cat — no steer");
	} finally {
		if (prev === undefined) delete process.env.SPEC_ADHERENCE; else process.env.SPEC_ADHERENCE = prev;
		rmSync(work, { recursive: true, force: true });
	}
});
