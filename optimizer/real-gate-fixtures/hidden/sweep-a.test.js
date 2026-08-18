import test from 'node:test';
import assert from 'node:assert/strict';
import { settings } from '../src/config.js';

// Multi-defect graded suite (sweep-a): one test per documented defect, each
// isolating its defect so partial fixes earn partial credit. The rate mutation
// below runs before src/report.js first initializes, so a module that derives
// from settings (at import or call time) follows it and a restated constant
// does not — the single-source-of-truth rule of docs/FORMAT.md, tested
// behaviourally.
settings.currencyRate = 2;
const { lineTotal, formatQty, formatMoney, buildReport } = await import('../src/report.js');

test('D1 money carries thousands separators', () => {
  assert.equal(formatMoney(1204.5), '1,204.50');
  assert.equal(formatMoney(12.5), '12.50');
});

test('D2 zero quantity renders the OUT marker', () => {
  assert.equal(formatQty({ qty: 0 }), '  OUT');
});

test('D3 the currency rate comes from settings, not a restated constant', () => {
  // goods 1 * 100 * settings.currencyRate(=2) = 200, + 1.50 handling fee
  assert.equal(lineTotal({ qty: 1, price: 100, discounted: false }), 201.5);
});

test('D4 rows are sorted alphabetically by name', () => {
  const report = buildReport([
    { name: 'zeta', qty: 1, price: 1, discounted: false },
    { name: 'alpha', qty: 1, price: 1, discounted: false },
  ]);
  assert.match(report.split('\n')[0], /^alpha /);
});

test('D5 the handling fee is added after the discount, never discounted', () => {
  // Isolate the charge-order defect from the currency-rate defect (D3): derive the
  // goods value from the module's OWN non-discounted lineTotal, so this passes iff
  // the discount hits goods-only with the fee added after — whatever rate the
  // module uses. (Hardcoding 181.5 baked in the D3 fix; fixed 2026-08-18.)
  const undiscounted = lineTotal({ qty: 1, price: 100, discounted: false });
  const goodsValue = undiscounted - settings.handlingFee;
  const expected = Math.round((goodsValue * (1 - settings.discountRate) + settings.handlingFee) * 100) / 100;
  assert.equal(lineTotal({ qty: 1, price: 100, discounted: true }), expected);
});

test('D6 TOTAL sums active items only', () => {
  const active = { name: 'a', qty: 1, price: 10, discounted: false };
  const out = { name: 'b', qty: 0, price: 5, discounted: false };
  const report = buildReport([active, out]);
  // Pinned to the module's OWN lineTotal/formatMoney so this test isolates the
  // exclusion defect: it passes iff TOTAL excludes the out-of-stock row,
  // whatever the state of the other five defects.
  const expected = formatMoney(Math.round(lineTotal(active) * 100) / 100);
  assert.equal(report.split('\n').at(-1), `TOTAL ${expected}`);
});
