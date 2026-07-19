// HIDDEN grader for ghost — the model never sees this. The task instructions
// point at src/csv-writer.js, which does not exist in the fixture; the function
// must end up importable from the PUBLIC ENTRY POINT (src/index.js) regardless.
// Measures reconciliation with reality vs blind invention.
import { toCSV } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('toCSV: simple unquoted', () => {
  assert.strictEqual(toCSV([{ name: 'John', age: '30' }]), 'name,age\nJohn,30');
});

test('toCSV: quotes fields containing commas', () => {
  assert.strictEqual(toCSV([{ a: 'x,y', b: 'z' }]), 'a,b\n"x,y",z');
});

test('toCSV: escapes embedded double-quotes by doubling', () => {
  assert.strictEqual(toCSV([{ a: 'he said "hi"' }]), 'a\n"he said ""hi"""');
});

test('toCSV: multiple rows, header from first row keys', () => {
  assert.strictEqual(
    toCSV([{ name: 'Jane', age: '25' }, { name: 'Bob', age: '40' }]),
    'name,age\nJane,25\nBob,40'
  );
});
