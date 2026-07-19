// HIDDEN grader for roman — the model never sees this.
import { fromRoman } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('reject IIX', () => assert.equal(fromRoman('IIX'), null));
test('reject VV', () => assert.equal(fromRoman('VV'), null));
test('reject IIII', () => assert.equal(fromRoman('IIII'), null));
test('reject IL', () => assert.equal(fromRoman('IL'), null));
test('still parses valid CMXLIV', () => assert.equal(fromRoman('CMXLIV'), 944));
