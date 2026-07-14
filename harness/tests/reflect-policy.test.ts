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

test("sc voting: votes are per-sample — one sample repeating itself is ONE vote", () => {
	const halluc = "- [VERIFY] missing commit step: add a git commit before shipping";
	const hallucReworded = "- [VERIFY] commit step missing: add git commit before the ship step";
	// one rambling sample states the same finding twice; no other sample agrees ->
	// must NOT reach a 2-vote quorum (pre-fix it counted 2 votes from one voter)
	assert.equal(voteFindings([`${halluc}\n${hallucReworded}`, null, null], 2), null);
	// the same two lines split across two samples ARE two independent votes
	assert.ok(voteFindings([halluc, hallucReworded, null], 2));
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

test("premortem method: contract-compliant prompt, wired into the registry", () => {
	assert.ok(METHODS.premortem.prompt, "premortem carries its own prompt");
	const p = METHODS.premortem.prompt as string;
	assert.ok(p.includes("FAILED SPECTACULARLY"));
	assert.ok(p.includes("- [RISK]"), "findings must use the RISK line contract");
	assert.ok(p.includes("CLEAN"), "CLEAN sentinel preserved");
	assert.ok(p.includes("FORBIDDEN from proposing"), "anti-growth clause preserved");
	assert.ok(Object.values(METHODS).every((m) => m.blurb.length > 0), "every method self-describes for /reflect help");
});
