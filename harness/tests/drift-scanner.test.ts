import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildTruncatedDiff, extractFindings, isReviewableCommit, MAX_DIFF } from "../lib/drift-policy.ts";
// Run: cd ~/.pi/agent && TELEMETRY_FILE=$(mktemp) TELEMETRY_SOURCE=test \
//        npx -y tsx --test tests/drift-scanner.test.ts
// (TELEMETRY_FILE is not optional: without it these tests append REAL rows to
//  ~/.pi/agent/telemetry/events.jsonl tagged source=\"interactive\", polluting the
//  live telemetry stream the harness is measured from.)

const txt = (s: string) => [{ type: "text", text: s }];

test("isReviewableCommit: matches real commit forms", () => {
	assert.equal(isReviewableCommit("git commit -m x"), true);
	assert.equal(isReviewableCommit('git commit -m "multi word msg"'), true);
	assert.equal(isReviewableCommit("git -C sub commit -m y"), true);
	assert.equal(isReviewableCommit("git add -A && git commit -m x"), true);
});

test("isReviewableCommit: skips amend, non-commits, and look-alikes", () => {
	assert.equal(isReviewableCommit("git commit --amend --no-edit"), false);
	assert.equal(isReviewableCommit("git status"), false);
	assert.equal(isReviewableCommit("npm test"), false);
	assert.equal(isReviewableCommit("git log --grep=commit"), false);
	assert.equal(isReviewableCommit("git commit-tree abc"), false);
});

test("buildTruncatedDiff: passes short diffs, caps long ones with a flag", () => {
	assert.deepEqual(buildTruncatedDiff("abc"), { text: "abc", truncated: false });
	const big = "x".repeat(MAX_DIFF + 5000);
	const r = buildTruncatedDiff(big);
	assert.equal(r.truncated, true);
	assert.equal(r.text.length, MAX_DIFF);
});

test("extractFindings: only posts complete, non-CLEAN reviews", () => {
	// Real findings on a clean "stop" → returned verbatim.
	assert.equal(extractFindings(txt("- util.js: dead ref oldHelper"), "stop"), "- util.js: dead ref oldHelper");
	// Non-"stop" finishes never post, even with text present (no garbage/partials).
	assert.equal(extractFindings(txt("- util.js: dead ref"), "error"), null);
	assert.equal(extractFindings(txt("- util.js: partial"), "aborted"), null);
	assert.equal(extractFindings(txt("- util.js: cut off"), "length"), null);
	// CLEAN sentinel (any case) → null.
	assert.equal(extractFindings(txt("CLEAN"), "stop"), null);
	assert.equal(extractFindings(txt("clean"), "stop"), null);
	// Empty / reasoning-only (no text block) → null.
	assert.equal(extractFindings(txt("   "), "stop"), null);
	assert.equal(extractFindings([{ type: "thinking", text: undefined } as { type: string; text?: string }], "stop"), null);
	// "clean" as a substring of real findings still posts (sentinel must be the whole reply).
	assert.equal(extractFindings(txt("- a.js: cleanup() is now orphaned"), "stop"), "- a.js: cleanup() is now orphaned");
});

// The two tests below import the EXTENSION, which value-imports
// @earendil-works/pi-ai/compat. That resolves under pi's jiti alias in
// production and under tsx in this repo (pi-ai is a devDependency), but NOT in
// the mirrored ~/.pi/agent, whose node_modules is runtime-only — see the note
// at the top of lib/drift-policy.ts. Skipping there keeps the mirrored suite
// truthful instead of reporting a red that says nothing about the code; the
// repo run (npm run verify) is where these two are authoritative.
// Synchronous on purpose: a top-level await here fails to transform under
// tsx's CJS output, which would break the file everywhere instead of skipping
// two tests somewhere.
const piAiResolvable = existsSync(join(process.cwd(), "node_modules", "@earendil-works", "pi-ai"));
const extTest = piAiResolvable ? test : test.skip;

extTest("the review is DETACHED: turn_end returns without waiting for the model", async () => {
	// pi awaits extension handlers serially inside the agent loop, so awaiting a
	// 90-second local-model review here froze the entire session on every
	// reviewable commit. turn_end must return promptly and deliver the advisory
	// later, as a followUp.
	const { execSync } = await import("node:child_process");
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { makeFakePi, fire } = await import("./integration-harness.ts");

	const cwd = mkdtempSync(join(tmpdir(), "drift-detach-"));
	execSync("git init -q . && git config user.email t@t && git config user.name t", { cwd, shell: "/bin/bash" });
	execSync("echo hello > a.txt && git add -A && git commit -q -m 'feat: add a'", { cwd, shell: "/bin/bash" });

	// A model call that never settles within the test's lifetime. If turn_end awaits
	// it, the await below hangs and the test times out — which is the bug.
	let modelCallStarted = false;
	const neverSettles = new Promise(() => { modelCallStarted = true; });

	const fp = makeFakePi();
	const mod = await import(`../extensions/drift-scanner.ts?detach=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);

	const ctx = {
		cwd,
		model: { provider: "test", id: "test-model" },
		modelRegistry: {
			getApiKeyAndHeaders: async () => { modelCallStarted = true; await neverSettles; return { ok: true }; },
		},
		signal: undefined,
	};
	const event = {
		turnIndex: 1,
		message: {
			role: "assistant",
			content: [{ type: "toolCall", id: "t1", name: "bash", arguments: { command: "git commit -m 'feat: add a'" } }],
		},
	};

	const started = Date.now();
	await fire(fp, "turn_end", event, ctx);
	const elapsed = Date.now() - started;

	assert.ok(elapsed < 5000, `turn_end must not block on the review (took ${elapsed}ms)`);
	assert.equal(modelCallStarted, true, "the review still starts — it is detached, not dropped");
	assert.equal(fp.sent.length, 0, "nothing delivered yet; the advisory arrives later as followUp");
});

extTest("a commit landing during an in-flight review is NOT swallowed — it gets reviewed next turn", async () => {
	// The detach fix originally marked handledHead BEFORE the in-flight guard, so
	// a second commit arriving mid-review was recorded as handled on the way to
	// the bail and then never reviewed at all (2026-07-30 triage #11). The mark
	// must come after the guard: bail unmarked, pick the commit up next turn.
	const { execSync } = await import("node:child_process");
	const { mkdtempSync } = await import("node:fs");
	const { tmpdir } = await import("node:os");
	const { join } = await import("node:path");
	const { makeFakePi, fire } = await import("./integration-harness.ts");

	const cwd = mkdtempSync(join(tmpdir(), "drift-inflight-"));
	execSync("git init -q . && git config user.email t@t && git config user.name t", { cwd, shell: "/bin/bash" });
	execSync("echo one > a.txt && git add a.txt && git commit -q -m 'feat: one'", { cwd, shell: "/bin/bash" });

	// First review holds `reviewing` until we release it.
	let release!: () => void;
	const gate = new Promise<void>((r) => { release = r; });
	let authCalls = 0;
	const fp = makeFakePi();
	const mod = await import(`../extensions/drift-scanner.ts?inflight=${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	const ctx = {
		cwd,
		model: { provider: "test", id: "test-model" },
		modelRegistry: {
			getApiKeyAndHeaders: async () => { authCalls += 1; await gate; return { ok: false }; }, // ok:false ends the review quietly after the gate
		},
		signal: undefined,
	};
	const commitEvent = (id: string) => ({
		turnIndex: 1,
		message: { role: "assistant", content: [{ type: "toolCall", id, name: "bash", arguments: { command: "git commit -m x" } }] },
	});

	await fire(fp, "turn_end", commitEvent("t1"), ctx); // starts review #1, which now blocks on `gate`
	assert.equal(authCalls, 1, "first review started");

	// Second commit lands while review #1 is in flight.
	execSync("echo two > b.txt && git add b.txt && git commit -q -m 'feat: two'", { cwd, shell: "/bin/bash" });
	await fire(fp, "turn_end", commitEvent("t2"), ctx); // must bail on the in-flight guard WITHOUT marking handled
	assert.equal(authCalls, 1, "no overlapping second review");

	release(); // review #1 completes
	await new Promise((r) => setTimeout(r, 50)); // let the detached finally{} clear `reviewing`

	await fire(fp, "turn_end", commitEvent("t3"), ctx); // next turn: the swallowed commit must now be reviewed
	assert.equal(authCalls, 2, "the commit that landed mid-review is reviewed on the next turn, not silently skipped");
});
