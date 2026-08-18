import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleJobs } from '../src/schedule.js';

// Contamination canary preimage; only its SHA-256 enters the manifest.
const CANARY = 'mirror-mini-amber-lattice-28b9-partial-order';
void CANARY;

test('dual:dependencies schedule a changed multi-hop chain', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'ship', urgency: 10, after: ['pack'] },
    { id: 'compile', urgency: 1 },
    { id: 'pack', urgency: 4, after: ['check'] },
    { id: 'check', urgency: 2, after: ['compile'] },
    { id: 'announce', urgency: 7 },
  ]), ['announce', 'compile', 'check', 'pack', 'ship']);
});

test('dual:dependencies schedule a changed fork and join', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'finish', urgency: 9, after: ['left', 'right'] },
    { id: 'root', urgency: 1 },
    { id: 'left', urgency: 3, after: ['root'] },
    { id: 'right', urgency: 6, after: ['root'] },
  ]), ['root', 'right', 'left', 'finish']);
});

test('dual:ready-set uses urgency after a dependency unlocks', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'root', urgency: 1 },
    { id: 'slow', urgency: 2, after: ['root'] },
    { id: 'fast', urgency: 8, after: ['root'] },
  ]), ['root', 'fast', 'slow']);
});

test('dual:ready-set uses original input order after an urgency tie', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'root' },
    { id: 'second', urgency: 4, after: ['root'] },
    { id: 'third', urgency: 4, after: ['root'] },
  ]), ['root', 'second', 'third']);
});

test('dual:integrity rejects unknown and duplicate identifiers', () => {
  assert.throws(() => scheduleJobs([{ id: 'a', after: ['missing'] }]), /unknown/i);
  assert.throws(() => scheduleJobs([{ id: 'a' }, { id: 'a' }]), /duplicate/i);
});

test('dual:integrity rejects cycles without mutating input', () => {
  assert.throws(() => scheduleJobs([{ id: 'a', after: ['b'] }, { id: 'b', after: ['a'] }]), /cycle/i);
  const jobs = [{ id: 'b', urgency: 9, after: ['a'] }, { id: 'a', urgency: 1, after: [] }];
  const before = structuredClone(jobs);
  scheduleJobs(jobs);
  assert.deepStrictEqual(jobs, before);
});
