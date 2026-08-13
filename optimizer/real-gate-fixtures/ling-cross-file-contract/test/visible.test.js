import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_ORDER, canTransition } from '../src/policy.js';
import { parseJob } from '../src/parse-job.js';

test('parses and normalises existing statuses', () => {
  assert.deepStrictEqual(parseJob('build: RUNNING '), { id: 'build', status: 'running' });
});

test('keeps the existing ordered policy', () => {
  assert.deepStrictEqual(STATUS_ORDER.filter((status) => status !== 'blocked'), ['queued', 'running', 'done']);
  assert.equal(canTransition('running', 'done'), true);
  assert.equal(canTransition('done', 'running'), false);
});

test('rejects unknown statuses', () => {
  assert.throws(() => parseJob('build:mystery'), /invalid job/);
});
