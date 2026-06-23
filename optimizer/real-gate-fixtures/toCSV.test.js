import { toCSV, parseCSV } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Authoritative spec for t5: toCSV(data) serializes an array of row objects to a
// CSV string (inverse of parseCSV). Header from the first row's keys; a field is
// quoted iff it contains a comma, double-quote, or newline, with internal quotes
// doubled (RFC 4180). Rows joined by '\n', no trailing newline.

test('toCSV: simple unquoted', () => {
  assert.strictEqual(toCSV([{ name: 'John', age: '30' }]), 'name,age\nJohn,30');
});

test('toCSV: quotes fields containing commas', () => {
  assert.strictEqual(toCSV([{ a: 'x,y', b: 'z' }]), 'a,b\n"x,y",z');
});

test('toCSV: escapes embedded double-quotes by doubling', () => {
  assert.strictEqual(toCSV([{ a: 'he said "hi"' }]), 'a\n"he said ""hi"""');
});

test('toCSV: quotes fields containing newlines', () => {
  assert.strictEqual(toCSV([{ a: 'line1\nline2' }]), 'a\n"line1\nline2"');
});

test('toCSV: multiple rows, header from first row keys', () => {
  assert.strictEqual(
    toCSV([{ name: 'Jane', age: '25' }, { name: 'Bob', age: '40' }]),
    'name,age\nJane,25\nBob,40'
  );
});

test('toCSV round-trips through parseCSV', () => {
  const data = [{ name: 'Jane', note: 'a, b' }, { name: 'Bob', note: 'c' }];
  assert.deepStrictEqual(parseCSV(toCSV(data)), data);
});
