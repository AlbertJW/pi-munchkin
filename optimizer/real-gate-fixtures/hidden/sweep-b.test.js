import test from 'node:test';
import assert from 'node:assert/strict';
import { run, parse } from '../src/pipeline.js';

// Multi-defect graded suite (sweep-b): five independent invariants of
// docs/PIPELINE.md, each isolated so partial fixes earn partial credit. The
// pipeline's own `npm test` gate (scripts/pipeline-gate.mjs) fails iteratively
// on the broken state, which is the point — recovery loops here open
// verification episodes (this is the loop-cohort instrument).

test('D1 blank lines are skipped, real malformed lines still throw', () => {
  assert.equal(parse('a,goods,5\n\nb,services,3').length, 2);
  assert.throws(() => parse('a,goods,5\ngarbage'), Error);
});

test('D2 EXP is an accepted category', () => {
  assert.doesNotThrow(() => run('a,EXP,-2'));
});

test('D3 zero-amount records are kept and flagged', () => {
  const { records } = run('a,goods,0\nb,goods,5');
  const zero = records.find((r) => r.id === 'a');
  assert.ok(zero, 'zero-amount record was dropped');
  assert.equal(zero.zero, true);
});

test('D4 average excludes EXP records from the denominator', () => {
  // goods 6 + services 4 + EXP -2 = total 8; non-EXP count 2 -> 4
  assert.equal(run('a,goods,6\nb,services,4\nc,EXP,-2').average, 4);
});

test('D5 categories are in first-seen feed order, not alphabetical', () => {
  assert.deepEqual(run('a,services,1\nb,goods,1').categories, ['services', 'goods']);
});
