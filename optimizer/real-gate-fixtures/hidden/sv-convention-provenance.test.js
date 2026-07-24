// HIDDEN grader: independently verifies truncateHandle follows the
// label-style convention (ellipsis counts toward maxLen) -- the convention
// actually decided when asked. Self-contained; does not import labelTruncate.js.
import test from "node:test";
import assert from "node:assert/strict";
import { truncateHandle } from "../src/handleTruncate.js";

function expected(text, maxLen) {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 1) + '…';
}

const CASES = [
  ['short', 10],
  ['Hello World', 8],
  ['Hello World', 5],
  ['exactlyten', 10],
  ['a bit longer than the budget allows', 12],
  ['', 5],
];

test("truncateHandle follows the label-style ellipsis-counts-toward-maxLen convention", () => {
  for (const [text, maxLen] of CASES) {
    assert.equal(truncateHandle(text, maxLen), expected(text, maxLen), `text=${JSON.stringify(text)} maxLen=${maxLen}`);
  }
});

test("truncateHandle never exceeds maxLen characters, ellipsis included", () => {
  for (const [text, maxLen] of CASES) {
    assert.ok(truncateHandle(text, maxLen).length <= maxLen, `text=${JSON.stringify(text)} maxLen=${maxLen}`);
  }
});
