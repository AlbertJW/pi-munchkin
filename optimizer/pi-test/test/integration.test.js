import { parseCSV, csvToJson } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('end-to-end: CSV string to JSON string', () => {
  const csv = 'name,age\nJohn,30\nJane,25';
  const parsed = parseCSV(csv);
  const json = csvToJson(parsed);
  const result = JSON.parse(json);
  assert.deepStrictEqual(result, [
    { name: 'John', age: '30' },
    { name: 'Jane', age: '25' }
  ]);
});

test('end-to-end: complex CSV with quoted fields', () => {
  const csv = 'name,address\n"John Doe","123 Main St, Apt 4"\n"Jane Smith","456 Oak St"';
  const parsed = parseCSV(csv);
  const json = csvToJson(parsed);
  const result = JSON.parse(json);
  assert.strictEqual(result[0].address, '123 Main St, Apt 4');
  assert.strictEqual(result[1].address, '456 Oak St');
});

test('end-to-end: empty values', () => {
  const csv = 'name,age\nJohn,\nJane,30\n,25';
  const parsed = parseCSV(csv);
  const json = csvToJson(parsed);
  const result = JSON.parse(json);
  assert.strictEqual(result[0].age, '');
  assert.strictEqual(result[1].name, 'Jane');
  assert.strictEqual(result[2].name, '');
});
