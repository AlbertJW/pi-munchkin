import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { scheduleJobs } from '../src/schedule.js';

test('visible: orders independent jobs by urgency through the CLI', () => {
  const jobs = [{ id: 'docs', urgency: 1 }, { id: 'tests', urgency: 8 }, { id: 'lint', urgency: 4 }];
  const run = spawnSync(process.execPath, ['src/cli.js'], { input: JSON.stringify(jobs), encoding: 'utf8' });
  assert.equal(run.status, 0);
  assert.deepStrictEqual(JSON.parse(run.stdout), ['tests', 'lint', 'docs']);
});

test('visible: preserves input order for independent urgency ties', () => {
  assert.deepStrictEqual(scheduleJobs([{ id: 'a', urgency: 2 }, { id: 'b', urgency: 2 }]), ['a', 'b']);
});
