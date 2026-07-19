// HIDDEN grader for titlecase — the model never sees this.
import { titleCase } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('apostrophe is not a word boundary', () => assert.equal(titleCase("i don't know"), "I Don't Know"));
test('hyphen is not a word boundary', () => assert.equal(titleCase('well-known fact'), 'Well-known Fact'));
test('all-caps with apostrophe', () => assert.equal(titleCase("DON'T STOP"), "Don't Stop"));
