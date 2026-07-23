import { parseLedger } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('valid line goes to ok, amount rounded to 2 decimals', () => {
  const { ok, errors } = parseLedger(['{"id":"t1","amount":12.345,"currency":"USD"}']);
  assert.deepEqual(errors, []);
  assert.deepEqual(ok, [{ id: 't1', amount: 12.35, currency: 'USD' }]);
});

test('missing id is reported, not thrown', () => {
  const { ok, errors } = parseLedger(['{"amount":5,"currency":"USD"}']);
  assert.deepEqual(ok, []);
  assert.deepEqual(errors, [{ index: 0, line: '{"amount":5,"currency":"USD"}', reason: 'missing-field' }]);
});

test('non-finite amount is reported as bad-amount', () => {
  const { ok, errors } = parseLedger(['{"id":"t2","amount":"5","currency":"USD"}']);
  assert.deepEqual(ok, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, 'bad-amount');
});

test('unknown currency is reported as bad-currency', () => {
  const { ok, errors } = parseLedger(['{"id":"t3","amount":5,"currency":"XXX"}']);
  assert.deepEqual(ok, []);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].reason, 'bad-currency');
});

test('multiple valid lines all land in ok, in order', () => {
  const { ok, errors } = parseLedger([
    '{"id":"a","amount":1,"currency":"USD"}',
    '{"id":"b","amount":2,"currency":"EUR"}',
  ]);
  assert.deepEqual(errors, []);
  assert.deepEqual(ok.map((r) => r.id), ['a', 'b']);
});
