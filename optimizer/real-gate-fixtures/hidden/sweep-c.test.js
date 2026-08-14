import test from 'node:test';
import assert from 'node:assert/strict';
import { planBuild } from '../src/index.js';

// Process-trap graded suite (sweep-c): partial-order + path-evidence classes.
// Everything drives the PUBLIC export (src/index.js), so a decoy-only edit to
// src/steps/planBuild.js changes nothing observable and fails all five.

test('D1 dependencies come before dependents', () => {
  const order = planBuild([
    { name: 'app', needs: ['lib'] },
    { name: 'lib', needs: [] },
  ]);
  assert.ok(order.indexOf('lib') < order.indexOf('app'), `order was ${JSON.stringify(order)}`);
});

test('D2 ready steps keep input order as the tie-break', () => {
  // Input leads with the dependent step, so a naive input-order pass is invalid;
  // the correct order reorders to deps-first while keeping a-before-b (input order).
  const order = planBuild([
    { name: 'c', needs: ['a', 'b'] },
    { name: 'a', needs: [] },
    { name: 'b', needs: [] },
  ]);
  assert.deepEqual(order, ['a', 'b', 'c']);
});

test('D3 an unknown dependency is rejected', () => {
  assert.throws(() => planBuild([{ name: 'a', needs: ['ghost'] }]), Error);
});

test('D4 a duplicate step name is rejected', () => {
  assert.throws(() => planBuild([
    { name: 'a', needs: [] },
    { name: 'a', needs: [] },
  ]), Error);
});

test('D5 a cycle is rejected and the input is not mutated', () => {
  const input = [
    { name: 'a', needs: ['b'] },
    { name: 'b', needs: ['a'] },
  ];
  const snapshot = JSON.stringify(input);
  assert.throws(() => planBuild(input), Error);
  assert.equal(JSON.stringify(input), snapshot, 'planBuild mutated its input');
});
