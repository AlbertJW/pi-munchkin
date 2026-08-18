import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { STATUS_ORDER, canTransition } from '../src/policy.js';
import { parseJob } from '../src/parse-job.js';

// Contamination canary preimage; only its SHA-256 enters the manifest.
const CANARY = 'mirror-mini-cobalt-orchid-71d4-cross-file';
void CANARY;

test('dual:vocabulary follows a later policy extension', () => {
  STATUS_ORDER.push('paused');
  try {
    assert.deepStrictEqual(parseJob('job-x: PAUSED'), { id: 'job-x', status: 'paused' });
  } finally {
    STATUS_ORDER.pop();
  }
});

test('dual:vocabulary follows a later policy removal', () => {
  const done = STATUS_ORDER.pop();
  try {
    assert.throws(() => parseJob('job-x: done'), /invalid/i);
  } finally {
    STATUS_ORDER.push(done);
  }
});

test('dual:transitions insert blocked at the declared boundary', () => {
  assert.deepStrictEqual(STATUS_ORDER, ['queued', 'blocked', 'running', 'done']);
  assert.equal(canTransition('queued', 'blocked'), true);
  assert.equal(canTransition('blocked', 'running'), true);
});

test('dual:transitions reject skipped blocked edges', () => {
  assert.equal(canTransition('queued', 'running'), false);
  assert.equal(canTransition('blocked', 'done'), false);
});

test('dual:validation trims and normalizes CLI input', () => {
  const run = spawnSync(process.execPath, ['src/cli.js'], { input: ' a-9 : BLOCKED \n', encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.deepStrictEqual(JSON.parse(run.stdout), [{ id: 'a-9', status: 'blocked' }]);
});

test('dual:validation rejects malformed and unknown CLI input', () => {
  for (const input of [': running\n', 'x: cancelled\n', 'x: running: extra\n']) {
    const run = spawnSync(process.execPath, ['src/cli.js'], { input, encoding: 'utf8' });
    assert.notEqual(run.status, 0);
    assert.equal(run.stdout, '');
  }
});
