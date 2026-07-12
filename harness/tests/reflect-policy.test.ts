import assert from "node:assert/strict";
import test from "node:test";
import { extractReflectFindings, MAX_FINDINGS_CHARS, MAX_ROUNDS, METHODS, REFLECT_PROMPT, shouldIterate, voteFindings } from "../lib/reflect-policy.ts";

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

test("sc voting: recurring findings survive, one-off hallucinations die, all-CLEAN wins", () => {
	const real = "- [CUT] plugin system step 3: remove it, single exporter needs no registry";
	const realReworded = "- [CUT] step 3 plugin registry system: delete — one exporter, no registry needed";
	const halluc = "- [VERIFY] missing commit step: add git commit";
	// real flaw recurs (different wording), hallucination appears once
	assert.equal(voteFindings([real, `${realReworded}\n${halluc}`, real], 2), real);
	// all samples CLEAN -> null
	assert.equal(voteFindings([null, null, null], 2), null);
	// nothing reaches quorum -> null
	assert.equal(voteFindings([halluc, null, null], 2), null);
	assert.equal(METHODS.sc.samples, 3);
});

test("sc voting: step references anchor identity across wild rephrasings and formats", () => {
	// from live DD samples: same flaw, prose-numbered vs dashed, near-zero word overlap
	const s0 = "1. **Step 3 is YAGNI/over-engineering.** A dynamic plugin system for hypothetical future exporters adds massive overhead.";
	const s1 = "- **Unrequested architecture (Step 3):** Plugin registry is scope creep. Cut it.";
	const v = voteFindings([s0, s1, null], 2);
	assert.ok(v && /step 3/i.test(v), `step-3 finding must survive: ${v}`);
});

test("the anti-growth clause is load-bearing and present", () => {
	assert.ok(REFLECT_PROMPT.includes("FORBIDDEN from proposing new features"));
	assert.ok(REFLECT_PROMPT.includes("CLEAN"));
	assert.ok(/at most 5 lines/.test(REFLECT_PROMPT));
});
