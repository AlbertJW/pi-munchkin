import { csvToJson } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('converts parsed data to JSON string', () => {
  const data = [
    { name: 'John', age: '30' },
    { name: 'Jane', age: '25' }
  ];
  const result = csvToJson(data);
  const parsed = JSON.parse(result);
  assert.deepStrictEqual(parsed, data);
});

test('formats JSON with indentation', () => {
  const data = [{ name: 'John' }];
  const result = csvToJson(data);
  assert.ok(result.includes('\n'), 'Should contain newlines');
  assert.ok(result.includes('  '), 'Should contain indentation');
});

test('handles empty array', () => {
  const result = csvToJson([]);
  assert.strictEqual(result, '[]');
});
