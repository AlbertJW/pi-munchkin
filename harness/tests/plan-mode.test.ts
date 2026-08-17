import assert from "node:assert/strict";
import test from "node:test";
import { boundedDirectRequest, planMode } from "../lib/plan-mode.ts";
import { planStorageMode } from "../lib/plan-state-storage.ts";

test("plan mode defaults to forced and recognizes only explicit alternatives", () => {
	assert.equal(planMode({}), "forced");
	assert.equal(planMode({ PLAN_MODE: "adaptive" }), "adaptive");
	assert.equal(planMode({ PLAN_MODE: "off" }), "off");
	assert.equal(planMode({ PLAN_MODE: "bogus" }), "forced");
});
test("plan storage is private by default with explicit project and capsule-off rollbacks", () => {
	assert.equal(planStorageMode({}), "capsule");
	assert.equal(planStorageMode({ PLAN_MODE: "forced" }), "capsule");
	assert.equal(planStorageMode({ PLAN_STORAGE: "project" }), "project");
	assert.equal(planStorageMode({ RUN_CAPSULE: "off" }), "project");
	assert.equal(planStorageMode({ PLAN_STORAGE: "bogus" }), "capsule");
});
test("adaptive direct requests are bounded and fail closed on risky operations", () => {
	assert.equal(boundedDirectRequest("fix one typo"), "fix one typo");
	assert.equal(boundedDirectRequest("rm -rf build"), null);
	assert.equal(boundedDirectRequest("deploy the service"), null);
	assert.equal(boundedDirectRequest("a\nb"), null);
	assert.equal(boundedDirectRequest("x".repeat(241)), null);
});
