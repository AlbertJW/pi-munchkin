import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateCredits } from '../src/allocate.js';

test('allocates by urgency but returns rows in input order', () => {
  const requests = [
    { id: 'low', requested: 4, urgency: 1 },
    { id: 'high', requested: 3, urgency: 8 },
    { id: 'mid', requested: 5, urgency: 4 },
  ];
  assert.deepStrictEqual(allocateCredits(requests, 6), [
    { id: 'low', granted: 0 },
    { id: 'high', granted: 3 },
    { id: 'mid', granted: 3 },
  ]);
});

test('breaks urgency ties by input order and clamps negative requests', () => {
  assert.deepStrictEqual(allocateCredits([
    { id: 'first', requested: 4, urgency: 2 },
    { id: 'second', requested: 4, urgency: 2 },
    { id: 'invalid', requested: -5, urgency: 10 },
  ], 6), [
    { id: 'first', granted: 4 },
    { id: 'second', granted: 2 },
    { id: 'invalid', granted: 0 },
  ]);
});

test('does not mutate request order or objects', () => {
  const requests = [{ id: 'low', requested: 2, urgency: 1 }, { id: 'high', requested: 2, urgency: 9 }];
  const before = structuredClone(requests);
  allocateCredits(requests, 2);
  assert.deepStrictEqual(requests, before);
});
