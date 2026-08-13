import assert from 'node:assert/strict';
import { allocateCredits } from '../src/allocate.js';

const requests = [
  { id: 'urgent', requested: 4, urgency: 9 },
  { id: 'normal', requested: 4, urgency: 3 },
  { id: 'later', requested: 4, urgency: 1 },
];
assert.deepStrictEqual(allocateCredits(requests, 6), [
  { id: 'urgent', granted: 4 },
  { id: 'normal', granted: 2 },
  { id: 'later', granted: 0 },
]);
