import { normaliseRoute } from '../src/normalise-route.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('adds a leading slash and collapses repeated separators', () => {
  assert.equal(normaliseRoute('api//users///42'), '/api/users/42');
});
test('removes a trailing slash except for root', () => {
  assert.equal(normaliseRoute('/api/users/'), '/api/users');
  assert.equal(normaliseRoute(''), '/');
});
test('preserves a query string while normalising the path', () => {
  assert.equal(normaliseRoute('api//users/?active=1'), '/api/users?active=1');
});
