import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEntries } from '../src/parse.js';
import { buildReport } from '../src/report.js';

test('omitted trailing fields take their documented defaults', () => {
  assert.deepEqual(parseEntries('alpha|3'), [
    { label: 'alpha', amount: 3, weight: 1 },
  ]);
  assert.deepEqual(parseEntries('solo'), [
    { label: 'solo', amount: 0, weight: 1 },
  ]);
});

test('parseEntries always returns finite numbers', () => {
  for (const entry of parseEntries('alpha|3\nbeta\ngamma|1|2')) {
    assert.equal(Number.isFinite(entry.amount), true, `amount for ${entry.label}`);
    assert.equal(Number.isFinite(entry.weight), true, `weight for ${entry.label}`);
  }
});

test('report values short lines the same as fully written ones', () => {
  assert.equal(buildReport('alpha|3'), buildReport('alpha|3|1'));
  assert.equal(buildReport('solo'), buildReport('solo|0|1'));
});

test('report totals a ledger that mixes short and full lines', () => {
  const report = buildReport('alpha|3\nbeta|2|2\ngamma');
  assert.equal(
    report,
    [
      'alpha       3.00',
      'beta        4.00',
      'gamma       0.00',
      'TOTAL       7.00',
    ].join('\n'),
  );
});
