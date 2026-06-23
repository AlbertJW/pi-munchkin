import { test } from 'node:test';
import assert from 'node:assert';
import { alignLeft, alignRight, center } from '../src/align.js';

test('alignLeft pads on the right', () => {
  assert.strictEqual(alignLeft('ab', 5), 'ab   ');
});

test('alignRight pads on the left', () => {
  assert.strictEqual(alignRight('ab', 5), '   ab');
});

test('center puts the smaller pad on the left', () => {
  assert.strictEqual(center('ab', 5), ' ab  ');
});

test('value at or above width returns unchanged', () => {
  assert.strictEqual(alignRight('abcdef', 3), 'abcdef');
});
