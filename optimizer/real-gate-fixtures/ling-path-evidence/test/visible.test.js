import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTicket } from '../src/index.js';

test('uppercases an ordinary ticket prefix', () => {
  assert.equal(normalizeTicket(' app-42 '), 'APP-42');
});

test('rejects non-string values', () => {
  assert.throws(() => normalizeTicket(42), TypeError);
});
