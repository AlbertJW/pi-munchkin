// Pass-to-Pass (visible): balanced detection + the no-nesting depth cases.
import { analyze } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('detects balanced and unbalanced strings', () => {
  assert.strictEqual(analyze('[]').balanced, true);
  assert.strictEqual(analyze('[][]').balanced, true);
  assert.strictEqual(analyze('[').balanced, false);
  assert.strictEqual(analyze('][').balanced, false);
});

test('depth is 0 when there are no brackets', () => {
  assert.strictEqual(analyze('').maxDepth, 0);
  assert.strictEqual(analyze('abc').maxDepth, 0);
});
