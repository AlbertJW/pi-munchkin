import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleJobs } from '../src/release-plan.js';

test('orders independent jobs by urgency', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'docs', urgency: 1 },
    { id: 'tests', urgency: 8 },
    { id: 'lint', urgency: 4 },
  ]), ['tests', 'lint', 'docs']);
});

test('uses input order when independent urgency ties', () => {
  assert.deepStrictEqual(scheduleJobs([{ id: 'a', urgency: 2 }, { id: 'b', urgency: 2 }]), ['a', 'b']);
});
