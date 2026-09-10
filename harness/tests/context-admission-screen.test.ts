import assert from "node:assert/strict";
import test from "node:test";
import { evaluateContextAdmissionScreen } from "../lib/context-admission-screen.ts";

const required = {
	normal_outcome: "admitted",
	oversize_outcome: "rejected",
	oversize_reason: "aggregate_budget_exceeded",
	normal_forwarded_requests: 1,
	oversize_forwarded_requests: 0,
};
const blocked = { exit_code: 1, forwarded_requests: 0, telemetry: { present: true, outcome: "rejected", reason_class: "aggregate_budget_exceeded" } };

test("a forwarded normal request with a failed Pi process cannot qualify a context-admission screen", () => {
	const result = evaluateContextAdmissionScreen({ exit_code: 1, forwarded_requests: 1, telemetry: { present: true, outcome: "admitted", reason_class: "within_budget" } }, blocked, required);
	assert.equal(result.normal_exposed, false);
	assert.equal(result.passed, false);
});

test("a successful normal request and a rejected pre-dispatch oversized request qualify the narrow mechanism rule", () => {
	const result = evaluateContextAdmissionScreen({ exit_code: 0, forwarded_requests: 1, telemetry: { present: true, outcome: "admitted", reason_class: "within_budget" } }, blocked, required);
	assert.deepEqual(result, { normal_exposed: true, oversize_blocked_pre_dispatch: true, passed: true });
});
