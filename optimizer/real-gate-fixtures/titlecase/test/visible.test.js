import { titleCase } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('basic two words', () => assert.equal(titleCase('hello world'), 'Hello World'));
test('several words', () => assert.equal(titleCase('the quick brown fox'), 'The Quick Brown Fox'));
