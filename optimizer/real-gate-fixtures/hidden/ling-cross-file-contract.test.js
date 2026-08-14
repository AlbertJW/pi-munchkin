import test from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_ORDER, canTransition } from '../src/policy.js';

// Behaviour-only suite (2026-08-15 repair). The old fourth test read the
// parser's SOURCE and regex-asserted it referenced STATUS_ORDER — inadmissible
// under the behaviour-only rule. The single-source-of-truth property is now
// tested OBSERVABLY: a novel status appended to STATUS_ORDER before the parser
// module first initializes must be accepted by the parser. A private duplicate
// vocabulary cannot pass, whatever it is named. (parse-job is deliberately NOT
// imported at the top of this file — the coupling test below must own its
// first initialization.)

test('blocked is present in the shared status order', () => {
  assert.deepStrictEqual([...STATUS_ORDER], ['queued', 'blocked', 'running', 'done']);
});

test('transitions follow the new adjacent order', () => {
  assert.equal(canTransition('queued', 'blocked'), true);
  assert.equal(canTransition('blocked', 'running'), true);
  assert.equal(canTransition('queued', 'running'), false);
  assert.equal(canTransition('blocked', 'done'), false);
});

test('the parser derives its vocabulary from STATUS_ORDER', async () => {
  STATUS_ORDER.push('paused');
  const { parseJob } = await import('../src/parse-job.js');
  assert.deepStrictEqual(parseJob('j9: PAUSED '), { id: 'j9', status: 'paused' });
  assert.deepStrictEqual(parseJob('task-7: BLOCKED '), { id: 'task-7', status: 'blocked' });
});

test('the parser still rejects statuses outside the shared order', async () => {
  const { parseJob } = await import('../src/parse-job.js');
  assert.throws(() => parseJob('task-9: cancelled'), Error);
  assert.throws(() => parseJob(': running'), Error);
});
