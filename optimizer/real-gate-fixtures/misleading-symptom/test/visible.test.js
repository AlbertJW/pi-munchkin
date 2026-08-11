import test from 'node:test';
import assert from 'node:assert/strict';

import { parseEntries } from '../src/parse.js';
import { buildReport } from '../src/report.js';

test('parseEntries reads fully specified lines and trims fields', () => {
  const entries = parseEntries('  alpha |  2 | 1.5 \nbeta|4|0.5');
  assert.deepEqual(entries, [
    { label: 'alpha', amount: 2, weight: 1.5 },
    { label: 'beta', amount: 4, weight: 0.5 },
  ]);
});

test('parseEntries skips blank lines and comments', () => {
  const entries = parseEntries('# header\n\n   \nalpha|1|1\n  # trailing note');
  assert.deepEqual(entries, [{ label: 'alpha', amount: 1, weight: 1 }]);
});

test('parseEntries applies defaults to empty fields', () => {
  assert.deepEqual(parseEntries('alpha||2'), [
    { label: 'alpha', amount: 0, weight: 2 },
  ]);
  assert.deepEqual(parseEntries('beta|3|'), [
    { label: 'beta', amount: 3, weight: 1 },
  ]);
  assert.deepEqual(parseEntries('gamma|  |  '), [
    { label: 'gamma', amount: 0, weight: 1 },
  ]);
});

test('buildReport renders padded rows and a total', () => {
  const report = buildReport('alpha|2|1.5\n# note\n\nbeta|4|0.5');
  assert.equal(
    report,
    ['alpha       3.00', 'beta        2.00', 'TOTAL       5.00'].join('\n'),
  );
});

test('buildReport handles an empty ledger', () => {
  assert.equal(buildReport('# nothing here\n'), 'TOTAL       0.00');
});
