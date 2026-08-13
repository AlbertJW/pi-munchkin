import test from 'node:test';
import assert from 'node:assert/strict';
import { scheduleJobs } from '../src/release-plan.js';

test('dependencies outrank urgency until they are satisfied', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'deploy', urgency: 10, after: ['package'] },
    { id: 'test', urgency: 2, after: ['build'] },
    { id: 'build', urgency: 1 },
    { id: 'package', urgency: 3, after: ['test'] },
    { id: 'docs', urgency: 5 },
  ]), ['docs', 'build', 'test', 'package', 'deploy']);
});

test('chooses among newly available jobs by urgency then input order', () => {
  assert.deepStrictEqual(scheduleJobs([
    { id: 'root' },
    { id: 'left', urgency: 2, after: ['root'] },
    { id: 'right', urgency: 7, after: ['root'] },
    { id: 'finish', urgency: 9, after: ['left', 'right'] },
  ]), ['root', 'right', 'left', 'finish']);
});

test('rejects malformed dependency graphs', () => {
  assert.throws(() => scheduleJobs([{ id: 'a', after: ['missing'] }]), /unknown/i);
  assert.throws(() => scheduleJobs([{ id: 'a' }, { id: 'a' }]), /duplicate/i);
  assert.throws(() => scheduleJobs([{ id: 'a', after: ['b'] }, { id: 'b', after: ['a'] }]), /cycle/i);
});

test('does not mutate jobs or dependency arrays', () => {
  const jobs = [{ id: 'b', after: ['a'], urgency: 9 }, { id: 'a', after: [], urgency: 1 }];
  const before = structuredClone(jobs);
  scheduleJobs(jobs);
  assert.deepStrictEqual(jobs, before);
});
