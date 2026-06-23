import assert from "node:assert/strict";
import test from "node:test";
import { thresh, resolveStopMode } from "../extensions/loop-breaker.ts";

test("thresh: explicit LB_* env wins for both tiers", () => {
	process.env.LB_REPEAT_T1 = "7";
	try {
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, true), 7);
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, false), 7);
	} finally {
		delete process.env.LB_REPEAT_T1;
	}
});

test("thresh: local default < cloud default when env unset", () => {
	assert.equal(thresh("LB_STREAK_SOFT", 12, 8, true), 8);
	assert.equal(thresh("LB_STREAK_SOFT", 12, 8, false), 12);
});

test("thresh: env value below floor is clamped to 2", () => {
	process.env.LB_REPEAT_T1 = "1";
	try {
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, true), 2);
	} finally {
		delete process.env.LB_REPEAT_T1;
	}
});

test("resolveStopMode: default is abort (graceful run-stop); env overrides", () => {
	assert.equal(resolveStopMode(undefined), "abort"); // new default: tier 3 stops the run
	assert.equal(resolveStopMode("shutdown"), "shutdown");
	assert.equal(resolveStopMode("block"), "block"); // opt back into old soft behavior
	assert.equal(resolveStopMode("garbage"), "abort");
});
