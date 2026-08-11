import assert from "node:assert/strict";
import test from "node:test";
import { boundedDirectRequest, planMode } from "../lib/plan-mode.ts";

test("plan mode defaults to forced and recognizes only explicit alternatives", () => {
	assert.equal(planMode({}), "forced");
	assert.equal(planMode({ PLAN_MODE: "adaptive" }), "adaptive");
	assert.equal(planMode({ PLAN_MODE: "off" }), "off");
	assert.equal(planMode({ PLAN_MODE: "bogus" }), "forced");
});
test("adaptive direct requests are bounded and fail closed on risky operations", () => {
	assert.equal(boundedDirectRequest("fix one typo"), "fix one typo");
	assert.equal(boundedDirectRequest("rm -rf build"), null);
	assert.equal(boundedDirectRequest("deploy the service"), null);
	assert.equal(boundedDirectRequest("a\nb"), null);
	assert.equal(boundedDirectRequest("x".repeat(241)), null);
});
