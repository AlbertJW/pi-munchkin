import { encode, decode } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('encode basic', () => assert.equal(encode('AABCCCDEEEE'), '2AB3CD4E'));
test('decode basic', () => assert.equal(decode('2AB3CD4E'), 'AABCCCDEEEE'));
