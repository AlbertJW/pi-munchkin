import assert from "node:assert/strict";
import test from "node:test";
import {
	buildPlanGateReceipt,
	clearPlanGateReceipt,
	consumePlanGateReceipt,
	publishPlanGateReceipt,
} from "../lib/plan-gate-receipt.ts";

test("receipts are call-bound, one-shot, deduplicated, and aggregate-red", () => {
	clearPlanGateReceipt();
	const first = buildPlanGateReceipt("call-a", "run-a", [
		{ command: " npm   test ", pass: true },
		{ command: "npm test", pass: false },
	]);
	const second = buildPlanGateReceipt("call-b", "run-b", [{ command: "npm test", pass: true }]);
	assert.ok(first && second);
	publishPlanGateReceipt(first);
	publishPlanGateReceipt(second);
	assert.equal(consumePlanGateReceipt("call-a")?.allPassed, false);
	assert.equal(consumePlanGateReceipt("call-a"), null);
	assert.equal(consumePlanGateReceipt("call-b")?.allPassed, true);
});

test("pending receipt storage discards the oldest entry at its hard cap", () => {
	clearPlanGateReceipt();
	for (let index = 0; index < 129; index += 1) {
		const receipt = buildPlanGateReceipt(`call-${index}`, `run-${index}`, [{ command: "npm test", pass: true }]);
		assert.ok(receipt);
		publishPlanGateReceipt(receipt);
	}
	assert.equal(consumePlanGateReceipt("call-0"), null);
	assert.equal(consumePlanGateReceipt("call-128")?.runId, "run-128");
	clearPlanGateReceipt();
});
