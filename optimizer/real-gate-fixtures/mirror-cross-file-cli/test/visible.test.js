import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { canTransition } from '../src/policy.js';

test('visible: normalizes an existing status through the CLI', () => {
  const run = spawnSync(process.execPath, ['src/cli.js'], { input: ' job-7 : RUNNING \n', encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.deepStrictEqual(JSON.parse(run.stdout), [{ id: 'job-7', status: 'running' }]);
});

test('visible: preserves adjacent transition behavior', () => {
  assert.equal(canTransition('running', 'done'), true);
  assert.equal(canTransition('queued', 'done'), false);
});
