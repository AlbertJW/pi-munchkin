import { fromRoman } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('XIV', () => assert.equal(fromRoman('XIV'), 14));
test('MCMXCIV', () => assert.equal(fromRoman('MCMXCIV'), 1994));
test('XL', () => assert.equal(fromRoman('XL'), 40));
