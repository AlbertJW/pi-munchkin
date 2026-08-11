import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAmount } from '../src/money.js';
import { buildReport } from '../src/report.js';

test('ledger entries with separators and currency symbols are read', () => {
  const report = buildReport([
    { id: 'L1', amount: '1,234.50', source: 'ledger' },
    { id: 'L2', amount: '$1,200.00', source: 'ledger' },
    { id: 'L3', amount: '42.00', source: 'ledger' }
  ]);
  assert.deepEqual(report.lines, ['L1: 1234.50', 'L2: 1200.00', 'L3: 42.00']);
  assert.equal(report.total, 123450 + 120000 + 4200);
});

test('parenthesised ledger amounts are negative', () => {
  const report = buildReport([
    { id: 'N1', amount: '(89.99)', source: 'ledger' },
    { id: 'N2', amount: '($1,000)', source: 'ledger' },
    { id: 'N3', amount: '-42.00', source: 'ledger' }
  ]);
  assert.deepEqual(report.lines, ['N1: -89.99', 'N2: -1000.00', 'N3: -42.00']);
  assert.equal(report.total, -8999 + -100000 + -4200);
});

test('a mixed report totals both dialects together', () => {
  const report = buildReport([
    { id: 'M1', amount: '10.00' },
    { id: 'M2', amount: '(2,000.00)', source: 'ledger' },
    { id: 'M3', amount: '$5.25', source: 'ledger' },
    { id: 'M4', amount: '-1.00', source: 'strict' }
  ]);
  assert.deepEqual(report.lines, [
    'M1: 10.00',
    'M2: -2000.00',
    'M3: 5.25',
    'M4: -1.00'
  ]);
  assert.equal(report.total, 1000 - 200000 + 525 - 100);
});

test('the strict parser stayed strict', () => {
  assert.throws(() => parseAmount('$1,200.00'));
  assert.throws(() => parseAmount('1,234.50'));
  assert.throws(() => parseAmount('(89.99)'));
  assert.equal(parseAmount('12.50'), 1250);
});

test('a strict entry is not rescued by the ledger dialect', () => {
  assert.throws(() => buildReport([{ id: 'S1', amount: '1,234.50' }]));
  assert.throws(() =>
    buildReport([{ id: 'S2', amount: '(5.00)', source: 'strict' }])
  );
});

test('unreadable ledger data throws instead of becoming zero', () => {
  assert.throws(() =>
    buildReport([{ id: 'X1', amount: 'not-a-number', source: 'ledger' }])
  );
});
