import assert from "node:assert/strict";
import test from "node:test";
import { looksLikeCwdEscape, outputGuardMessage, totalContentChars } from "../lib/bash-output.ts";

test("totalContentChars sums only text blocks", () => {
	assert.equal(totalContentChars([{ type: "text", text: "abc" }, { type: "image", text: "ignored" }]), 3);
	assert.equal(totalContentChars(undefined), 0);
	assert.equal(totalContentChars([]), 0);
});

test("looksLikeCwdEscape flags $HOME, bare ~, and absolute paths outside cwd", () => {
	assert.equal(looksLikeCwdEscape("find $HOME -name '*.log'", "/tmp/project"), true);
	assert.equal(looksLikeCwdEscape("ls ~/Downloads", "/tmp/project"), true);
	assert.equal(looksLikeCwdEscape("find /Users/albert/LLM -name '*.json'", "/tmp/project"), true);
	assert.equal(looksLikeCwdEscape("find /tmp/project/src -name '*.ts'", "/tmp/project"), false);
	assert.equal(looksLikeCwdEscape("grep -r foo .", "/tmp/project"), false);
});

test("outputGuardMessage names the char counts and only appends escape guidance when suspected", () => {
	const plain = outputGuardMessage(9000, 8000, false);
	assert.ok(plain.includes("9000"));
	assert.ok(plain.includes("8000"));
	assert.ok(!plain.includes("searched outside"));
	const escaped = outputGuardMessage(9000, 8000, true);
	assert.ok(escaped.includes("searched outside"));
});
