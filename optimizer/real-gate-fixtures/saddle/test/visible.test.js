import { saddlePoints } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('classic single saddle', () => assert.deepEqual(saddlePoints([[9, 8, 7], [5, 3, 2], [6, 6, 7]]), [{ row: 2, col: 1 }]));
