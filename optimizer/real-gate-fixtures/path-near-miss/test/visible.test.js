import { normaliseRoute } from '../src/normalise-route.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('already canonical route is unchanged', () => assert.equal(normaliseRoute('/api/users'), '/api/users'));
test('root route is unchanged', () => assert.equal(normaliseRoute('/'), '/'));
