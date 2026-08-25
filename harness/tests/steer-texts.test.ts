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

test("VG_STEER_NO_GATE: overridable and never claims an exact gate", () => {
	// The no-detected-gate steer must not use the "exact gate" wording (there is none)
	// and, like every steer, must be PI_MSG-overridable for the munchkin search space.
	const def = steerText(
		"VG_STEER_NO_GATE",
		"[verify-gate] No project gate was detected in this directory, and the files changed this turn have no recorded verification. Say how you verified the change, or that there is no gate to run here.",
		{},
	);
	assert.match(def, /No project gate was detected/);
	assert.doesNotMatch(def, /exact gate/);
	process.env.PI_MSG_VG_STEER_NO_GATE = "custom no-gate note";
	try {
		assert.equal(steerText("VG_STEER_NO_GATE", "default", {}), "custom no-gate note");
	} finally {
		delete process.env.PI_MSG_VG_STEER_NO_GATE;
	}
});

test("model-facing rejections never prescribe a human-only remedy", async () => {
	// The model cannot type a slash command and cannot set an environment variable for
	// the process it is already running inside. A rejection that names one leaves it
	// with no legal next move, so it retries — and every one of these strings sits on a
	// path that feeds the loop-breaker ladder. Four live instances were fixed on
	// 2026-08-26 (plan_update's "start with /plan", FORCE_PLAN_WRITE=off in a block
	// reason, ketch's two "/ketch-status", and git-guard advertising GIT_GUARD=off);
	// this pins the class rather than the four.
	const { readFileSync, readdirSync } = await import("node:fs");
	const { join } = await import("node:path");
	const dir = join(import.meta.dirname, "..", "extensions");
	const offenders: string[] = [];
	for (const name of readdirSync(dir).filter((file) => file.endsWith(".ts"))) {
		const source = readFileSync(join(dir, name), "utf8")
			.replace(/\/\*[\s\S]*?\*\//g, "")   // block comments
			.replace(/^\s*\/\/.*$/gm, "");        // line comments
		// Constructs whose audience is unambiguously the MODEL: tool-call block reasons
		// and plan-tool rejections. ctx.ui.notify(...) is the user's channel and is
		// deliberately excluded — /plan-go is exactly the right thing to tell a human.
		const modelFacing = [
			...source.matchAll(/reason:\s*\n?\s*(`[^`]*`|"[^"]*")/g),
			...source.matchAll(/rejectPlanTool\(\s*(`[^`]*`|"[^"]*")/g),
		].map((match) => match[1]);
		for (const text of modelFacing) {
			if (/(?:^|[\s(])\/[a-z][a-z-]{2,}/.test(text)) offenders.push(`${name}: slash command in ${text.slice(0, 80)}`);
			if (/\b[A-Z][A-Z_0-9]{4,}=[a-z0-9]+/.test(text)) offenders.push(`${name}: env var in ${text.slice(0, 80)}`);
		}
	}
	assert.deepEqual(offenders, [], `model-facing text prescribing something only a human can do:\n${offenders.join("\n")}`);
});
