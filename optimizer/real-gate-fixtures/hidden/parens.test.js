// HIDDEN grader for parens — the model never sees this.
import { firstUnmatched } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('first unclosed open, nested', () => assert.equal(firstUnmatched('((a)'), 0));
test('first unclosed among several', () => assert.equal(firstUnmatched('(((cd)(asdf'), 0));
test('first unclosed, two opens one close', () => assert.equal(firstUnmatched('(()'), 0));
