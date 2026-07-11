import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { isPositiveNumber, limitBypassesRiskyGate, resolveReadPath, RISKY_MAX_LIMIT } from "../lib/context-inlet.ts";

test("resolveReadPath resolves relatives against active cwd", () => {
	assert.equal(resolveReadPath("/tmp/project", "src/file.ts"), resolve("/tmp/project/src/file.ts"));
});

test("resolveReadPath preserves absolute paths", () => {
	assert.equal(resolveReadPath("/tmp/project", "/var/log/app.log"), "/var/log/app.log");
});

test("isPositiveNumber treats only positive finite numbers as bounded", () => {
	assert.equal(isPositiveNumber(1), true);
	assert.equal(isPositiveNumber(0), false);
	assert.equal(isPositiveNumber(Number.NaN), false);
	assert.equal(isPositiveNumber("10"), false);
});

test("limitBypassesRiskyGate flags only huge limits on risky files", () => {
	assert.equal(limitBypassesRiskyGate(999999, true), true, "huge limit on risky file must not bypass the gate");
	assert.equal(limitBypassesRiskyGate(RISKY_MAX_LIMIT, true), false, "page-sized limit on risky file is fine");
	assert.equal(limitBypassesRiskyGate(999999, false), false, "normal files keep the old behavior");
	assert.equal(limitBypassesRiskyGate(undefined, true), false, "no limit -> handled by the unbounded path");
	assert.equal(limitBypassesRiskyGate(Number.NaN, true), false);
});
