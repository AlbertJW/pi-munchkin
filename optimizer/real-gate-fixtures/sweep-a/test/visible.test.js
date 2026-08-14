import test from 'node:test';
import assert from 'node:assert/strict';
import { lineTotal, formatQty, formatMoney, buildReport } from '../src/report.js';

test('small amounts render with two decimals', () => {
  assert.equal(formatMoney(12.5), '12.50');
});

test('quantities are right-aligned in a five character column', () => {
  assert.equal(formatQty({ qty: 42 }), '   42');
});

test('a plain line total converts and adds the handling fee', () => {
  // 42 * 0.2 * 1.25 = 10.50 goods value, + 1.50 handling fee = 12.00
  assert.equal(lineTotal({ qty: 42, price: 0.2, discounted: false }), 12);
});

test('a single-item report renders the row and the TOTAL line', () => {
  const report = buildReport([{ name: 'anchor', qty: 42, price: 0.2, discounted: false }]);
  assert.equal(report, 'anchor    42 12.00\nTOTAL 12.00');
});
