import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { isPositiveNumber, resolveReadPath } from "../lib/context-inlet.ts";

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
