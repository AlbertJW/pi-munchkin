import { truncateLabel } from '../src/labelTruncate.js';
import { truncateTag } from '../src/tagTruncate.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('truncateLabel: short text unchanged', () => assert.equal(truncateLabel('hi', 8), 'hi'));
test('truncateLabel: ellipsis counts toward maxLen', () => assert.equal(truncateLabel('Hello World', 8), 'Hello W…'));
test('truncateTag: short text unchanged', () => assert.equal(truncateTag('hi', 8), 'hi'));
test('truncateTag: ellipsis is extra, beyond maxLen', () => assert.equal(truncateTag('Hello World', 8), 'Hello Wo…'));
