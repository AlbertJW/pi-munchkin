import test from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/pipeline.js';

test('a clean two-line feed totals and averages', () => {
  const result = run('a,goods,5\nb,services,3');
  assert.equal(result.total, 8);
  assert.equal(result.average, 4);
  assert.equal(result.records.length, 2);
});

test('categories cover both kinds', () => {
  const result = run('a,goods,5\nb,services,3');
  assert.deepEqual(result.categories, ['goods', 'services']);
});
