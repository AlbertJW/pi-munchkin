import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCredits } from '../src/allocate.js';

test('grants one request when the pool is large enough', () => {
  assert.deepStrictEqual(allocateCredits([{ id: 'a', requested: 3, urgency: 1 }], 10), [
    { id: 'a', granted: 3 },
  ]);
});

test('caps one request at the available pool', () => {
  assert.deepStrictEqual(allocateCredits([{ id: 'a', requested: 8, urgency: 1 }], 5), [
    { id: 'a', granted: 5 },
  ]);
});

test('rejects an invalid pool', () => {
  assert.throws(() => allocateCredits([], -1), RangeError);
});
