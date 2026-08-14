import test from 'node:test';
import assert from 'node:assert/strict';
import { planBuild } from '../src/index.js';

test('a dependency-free plan keeps input order', () => {
  const order = planBuild([{ name: 'a', needs: [] }, { name: 'b', needs: [] }]);
  assert.deepEqual(order, ['a', 'b']);
});

test('the result is an array of names', () => {
  const order = planBuild([{ name: 'x', needs: [] }]);
  assert.deepEqual(order, ['x']);
});
