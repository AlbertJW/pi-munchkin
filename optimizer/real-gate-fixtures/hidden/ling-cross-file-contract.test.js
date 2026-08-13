import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_ORDER, canTransition } from '../src/policy.js';
import { parseJob } from '../src/parse-job.js';

test('blocked is present in the shared status order', () => {
  assert.deepStrictEqual([...STATUS_ORDER], ['queued', 'blocked', 'running', 'done']);
});

test('parser consumes the shared blocked vocabulary', () => {
  assert.deepStrictEqual(parseJob('task-7: BLOCKED '), { id: 'task-7', status: 'blocked' });
});

test('transitions follow the new adjacent order', () => {
  assert.equal(canTransition('queued', 'blocked'), true);
  assert.equal(canTransition('blocked', 'running'), true);
  assert.equal(canTransition('queued', 'running'), false);
  assert.equal(canTransition('blocked', 'done'), false);
});

test('the parser has no private duplicate status list', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/parse-job.js', import.meta.url), 'utf8'));
  assert.match(source, /STATUS_ORDER/);
  assert.doesNotMatch(source, /new Set\(\s*\[['"]queued/);
});
