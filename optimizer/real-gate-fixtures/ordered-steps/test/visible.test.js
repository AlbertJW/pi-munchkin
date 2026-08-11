import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRoster } from '../src/roster.js';

test('normalises and masks the address', () => {
  const rows = buildRoster([
    { id: 'm1', email: '  Alan.Turing@Example.COM ', name: 'Alan Turing' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm1', email: 'a***@example.com', name: 'Alan Turing' },
  ]);
});

test('keeps the domain intact, including subdomains', () => {
  const rows = buildRoster([
    { id: 'm2', email: 'katherine@mail.example.org', name: 'Katherine J' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm2', email: 'k***@mail.example.org', name: 'Katherine J' },
  ]);
});

test('trims a supplied display name', () => {
  const rows = buildRoster([
    { id: 'm3', email: 'bill@example.com', name: '   Margaret Hamilton  ' },
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm3', email: 'b***@example.com', name: 'Margaret Hamilton' },
  ]);
});

test('handles several entries and emits only the three row fields', () => {
  const rows = buildRoster([
    { id: 'm4', email: 'ada@example.com', name: 'Ada L' },
    { id: 'm5', email: 'GRACE@example.com', name: 'Grace H' },
  ]);
  assert.deepStrictEqual(rows.map((r) => Object.keys(r).sort()), [
    ['email', 'id', 'name'],
    ['email', 'id', 'name'],
  ]);
  assert.deepStrictEqual(rows, [
    { id: 'm4', email: 'a***@example.com', name: 'Ada L' },
    { id: 'm5', email: 'g***@example.com', name: 'Grace H' },
  ]);
});

test('does not mutate the input entries', () => {
  const entries = [{ id: 'm6', email: '  Hedy.Lamarr@Example.com  ', name: 'Hedy Lamarr' }];
  buildRoster(entries);
  assert.deepStrictEqual(entries, [
    { id: 'm6', email: '  Hedy.Lamarr@Example.com  ', name: 'Hedy Lamarr' },
  ]);
});
