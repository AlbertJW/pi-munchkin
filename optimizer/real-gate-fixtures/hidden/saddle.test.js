// HIDDEN grader for saddle — the model never sees this.
import { saddlePoints } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('no saddle point', () => assert.deepEqual(saddlePoints([[2, 1], [1, 2]]), []));
test('empty matrix', () => assert.deepEqual(saddlePoints([]), []));
test('row-major single', () => assert.deepEqual(saddlePoints([[1, 2, 3], [3, 4, 5]]), [{ row: 1, col: 3 }]));
