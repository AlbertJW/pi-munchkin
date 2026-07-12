import assert from "node:assert/strict";
import test from "node:test";
import { extractReflectFindings, MAX_FINDINGS_CHARS, MAX_ROUNDS, REFLECT_PROMPT, shouldIterate } from "../lib/reflect-policy.ts";

test("CLEAN, empty, and non-stop reviews surface nothing", () => {
	assert.equal(extractReflectFindings([{ type: "text", text: "CLEAN" }], "stop"), null);
	assert.equal(extractReflectFindings([{ type: "text", text: "clean — looks fine" }], "stop"), null);
	assert.equal(extractReflectFindings([{ type: "thinking", text: "hmm" }], "stop"), null);
	assert.equal(extractReflectFindings([{ type: "text", text: "- [RISK] x: y" }], "length"), null, "truncated review must not post");
});

test("material findings pass through, oversized ones clamp", () => {
	assert.equal(extractReflectFindings([{ type: "text", text: "- [CUT] item 4: not needed" }], "stop"), "- [CUT] item 4: not needed");
	const huge = extractReflectFindings([{ type: "text", text: "x".repeat(10_000) }], "stop");
	assert.ok(huge && huge.length <= MAX_FINDINGS_CHARS + 40 && huge.includes("truncated"));
});

test("round ceiling: iterate on findings only, never past MAX_ROUNDS", () => {
	assert.equal(shouldIterate(0, "- [BLOCKER] a: b"), true);
	assert.equal(shouldIterate(MAX_ROUNDS - 1, "- [RISK] a: b"), true);
	assert.equal(shouldIterate(MAX_ROUNDS, "- [RISK] a: b"), false);
	assert.equal(shouldIterate(0, null), false, "CLEAN ends the loop");
});

test("the anti-growth clause is load-bearing and present", () => {
	assert.ok(REFLECT_PROMPT.includes("FORBIDDEN from proposing new features"));
	assert.ok(REFLECT_PROMPT.includes("CLEAN"));
	assert.ok(/at most 5 lines/.test(REFLECT_PROMPT));
});
