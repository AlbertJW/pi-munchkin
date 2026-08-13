import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTicket } from '../src/index.js';

test('normalises whitespace and leading zeroes through the public export', () => {
  assert.equal(normalizeTicket('  ops - 00073  '), 'OPS-73');
  assert.equal(normalizeTicket('web-000'), 'WEB-0');
});

test('accepts alphabetic project prefixes and decimal digits only', () => {
  for (const value of ['123-4', 'OPS-', 'OPS-7x', 'OPS_7', '', 'OPS--7']) {
    assert.throws(() => normalizeTicket(value), TypeError, value);
  }
});

test('the package export owns the repaired implementation', async () => {
  const index = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'));
  assert.match(index, /tickets\/normalize-ticket\.js/);
});
