import assert from "node:assert/strict";
import test from "node:test";
import { buildTruncatedDiff, extractFindings, isReviewableCommit, MAX_DIFF } from "../lib/drift-policy.ts";
// Run: cd ~/.pi/agent && npx -y tsx --test tests/drift-scanner.test.ts

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

test("the review is DETACHED: turn_end returns without waiting for the model", async () => {
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
