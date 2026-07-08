import assert from "node:assert/strict";
import test from "node:test";
import { fill, steerText } from "../lib/steer-texts.ts";

test("fill: replaces known vars, leaves unknown {var} verbatim", () => {
	assert.equal(fill("do {act} after {n}×", { act: "edit", n: 3 }), "do edit after 3×");
	assert.equal(fill("keep {unknown} visible", {}), "keep {unknown} visible");
});

test("steerText: env PI_MSG_<NAME> overrides the template", () => {
	process.env.PI_MSG_TEST_X = "short: {label} now";
	try {
		assert.equal(steerText("TEST_X", "long default {label}", { label: "read a.ts" }), "short: read a.ts now");
	} finally {
		delete process.env.PI_MSG_TEST_X;
	}
});

test("steerText: no override → default template, filled", () => {
	assert.equal(steerText("TEST_UNSET", "d {n}", { n: 2 }), "d 2");
});

// Zero-drift proof: with no PI_MSG_* set, the routed messages must be
// byte-identical to the historical literals that shipped before steer-texts.
test("zero drift: loop-breaker/verify-gate defaults reproduce the historical strings", () => {
	const t1 = steerText(
		"LB_T1_TOOL",
		"[loop-breaker] Repeated {label} {repeat}×, no file change. You have this. " +
			"Do ONE now: {act} · mark blocked + stop · name the one missing fact + how you'll get it. " +
			"Don't re-run that read/grep/command.",
		{ label: "read src/a.ts", repeat: 2, act: "edit" },
	);
	assert.equal(
		t1,
		"[loop-breaker] Repeated read src/a.ts 2×, no file change. You have this. " +
			"Do ONE now: edit · mark blocked + stop · name the one missing fact + how you'll get it. " +
			"Don't re-run that read/grep/command.",
	);
	const vg = steerText(
		"VG_STEER",
		"[verify-gate] You changed files, ran no passing gate. Before finishing: run {gate}, report result, fix + re-run if red. Unverified output must not cross the boundary.{ctn}",
		{ gate: "`npm test`", ctn: "" },
	);
	assert.equal(
		vg,
		"[verify-gate] You changed files, ran no passing gate. Before finishing: run `npm test`, report result, fix + re-run if red. Unverified output must not cross the boundary.",
	);
});
