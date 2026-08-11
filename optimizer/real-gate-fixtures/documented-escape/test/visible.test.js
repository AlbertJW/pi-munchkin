import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount, formatCents } from '../src/money.js';
import { buildReport } from '../src/report.js';

test('parseAmount reads plain decimal strings as cents', () => {
  assert.equal(parseAmount('12'), 1200);
  assert.equal(parseAmount('12.5'), 1250);
  assert.equal(parseAmount('12.50'), 1250);
  assert.equal(parseAmount('-3.75'), -375);
  assert.equal(parseAmount('0'), 0);
});

test('parseAmount rejects values that are not amounts at all', () => {
  assert.throws(() => parseAmount('abc'));
  assert.throws(() => parseAmount(''));
  assert.throws(() => parseAmount('12.345'));
  assert.throws(() => parseAmount(12.5));
  assert.throws(() => parseAmount(null));
});

test('formatCents renders cents back to a decimal string', () => {
  assert.equal(formatCents(1250), '12.50');
  assert.equal(formatCents(0), '0.00');
  assert.equal(formatCents(-375), '-3.75');
  assert.equal(formatCents(120000), '1200.00');
});

test('buildReport totals plain entries and formats one line each', () => {
  const report = buildReport([
    { id: 'A1', amount: '10.00' },
    { id: 'A2', amount: '2.50' },
    { id: 'A3', amount: '-1.25' }
  ]);
  assert.deepEqual(report.lines, ['A1: 10.00', 'A2: 2.50', 'A3: -1.25']);
  assert.equal(report.total, 1125);
});

test('buildReport still honours an explicit strict source', () => {
  const report = buildReport([{ id: 'B1', amount: '5.00', source: 'strict' }]);
  assert.deepEqual(report.lines, ['B1: 5.00']);
  assert.equal(report.total, 500);
});

test('buildReport returns an empty report for no entries', () => {
  assert.deepEqual(buildReport([]), { lines: [], total: 0 });
});
