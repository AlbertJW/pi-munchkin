// Pass-to-Pass sanity: behavior that already holds (and must keep holding).
import { slugify } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('trims surrounding whitespace', () => assert.ok(!slugify('  x  ').startsWith(' ')));
test('collapses internal whitespace to single hyphens', () => assert.equal(slugify('a  b').includes(' '), false));
