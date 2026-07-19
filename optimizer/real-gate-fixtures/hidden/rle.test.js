// HIDDEN grader for rle — the model never sees this.
import { encode, decode } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('multi-digit run encode', () => assert.equal(encode('A'.repeat(12)), '12A'));
test('multi-digit run decode', () => assert.equal(decode('12A'), 'A'.repeat(12)));
test('no runs unchanged', () => assert.equal(encode('XYZ'), 'XYZ'));
test('round trip', () => { const s = 'WWWWAAADEXXXXXX'; assert.equal(decode(encode(s)), s); });
