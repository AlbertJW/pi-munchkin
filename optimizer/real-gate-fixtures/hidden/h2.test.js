// HIDDEN Fail-to-Pass grader for h2 — the model never sees this. The shipped parseCSV
// line-splits BEFORE respecting quotes, so a quoted field containing a newline breaks
// (the record is split across lines). A correct fix parses character-by-character.
// The fixture's existing tests are the Pass-to-Pass set (must stay green).
import { parseCSV } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('h2: quoted field containing a newline stays one field', () => {
  const csv = 'name,note\n"Alice","line1\nline2"\n"Bob","ok"';
  const r = parseCSV(csv);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].name, 'Alice');
  assert.strictEqual(r[0].note, 'line1\nline2');
  assert.strictEqual(r[1].name, 'Bob');
  assert.strictEqual(r[1].note, 'ok');
});

test('h2: multiple newlines inside one quoted field', () => {
  const csv = 'a,b\n"x","p\nq\nr"';
  const r = parseCSV(csv);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].b, 'p\nq\nr');
});

test('h2: quoted newline combined with quoted comma', () => {
  const csv = 'k,v\n"1","a, b\nc, d"';
  const r = parseCSV(csv);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].v, 'a, b\nc, d');
});
