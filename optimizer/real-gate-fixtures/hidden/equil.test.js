// HIDDEN grader for equil — the model never sees this.
import { equilibria } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('endpoints count', () => assert.deepEqual(equilibria([0, -3, 5, -4, -2, 3, 1, 0]), [0, 3, 7]));
test('left endpoint only', () => assert.deepEqual(equilibria([0, 1, -1]), [0]));
