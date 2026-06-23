import { parseCSV } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Authoritative spec for t6: whitespace INSIDE quoted fields must be preserved;
// unquoted fields are still trimmed. The current splitCSVLine trims every field
// (even quoted ones) — that's the bug to fix without breaking existing tests.

test('preserves leading/trailing whitespace inside quoted fields', () => {
  const csv = 'name,note\n"  John  ","  hello world  "';
  const r = parseCSV(csv);
  assert.strictEqual(r[0].name, '  John  ');
  assert.strictEqual(r[0].note, '  hello world  ');
});

test('still trims unquoted fields', () => {
  const csv = 'name,age\n  John  ,  30  ';
  const r = parseCSV(csv);
  assert.strictEqual(r[0].name, 'John');
  assert.strictEqual(r[0].age, '30');
});

test('quoted empty string stays empty, not collapsed', () => {
  const csv = 'a,b\n"",x';
  const r = parseCSV(csv);
  assert.strictEqual(r[0].a, '');
  assert.strictEqual(r[0].b, 'x');
});
