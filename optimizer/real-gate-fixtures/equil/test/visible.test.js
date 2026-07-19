import { equilibria } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('single middle equilibrium', () => assert.deepEqual(equilibria([1, 1, 1, 3, 1, 1, 1]), [3]));
