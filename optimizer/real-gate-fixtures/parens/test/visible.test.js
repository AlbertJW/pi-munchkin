import { firstUnmatched } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('unmatched close at 0', () => assert.equal(firstUnmatched(')ab'), 0));
test('balanced returns length', () => assert.equal(firstUnmatched('(a)'), 3));
test('no parens returns length', () => assert.equal(firstUnmatched('ab'), 2));
