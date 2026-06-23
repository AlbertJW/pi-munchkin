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
