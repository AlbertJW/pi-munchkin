// HIDDEN Fail-to-Pass grader for h3 — the model never sees this. analyze().maxDepth
// is wrong for any nesting (the bug is in src/depth.js, reached via src/index.js).
// The visible test/analyze.test.js is the Pass-to-Pass set.
import { analyze } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('h3: maxDepth of a flat pair is 1', () => {
  assert.strictEqual(analyze('[]').maxDepth, 1);
});
test('h3: maxDepth of nested pairs', () => {
  assert.strictEqual(analyze('[[]]').maxDepth, 2);
  assert.strictEqual(analyze('[[[]]]').maxDepth, 3);
});
test('h3: siblings do not add depth', () => {
  assert.strictEqual(analyze('[][]').maxDepth, 1);
  assert.strictEqual(analyze('[[]][]').maxDepth, 2);
});
