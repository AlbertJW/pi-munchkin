import { parseCSV, csvToJson } from '../src/index.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('handles single row with no data', () => {
  const result = parseCSV('name,age');
  assert.deepStrictEqual(result, []);
});

test('handles CSV with extra whitespace', () => {
  const csv = ' name , age \n John , 30 \n Jane , 25 ';
  const result = parseCSV(csv);
  assert.deepStrictEqual(result, [
    { name: 'John', age: '30' },
    { name: 'Jane', age: '25' }
  ]);
});

test('handles single column CSV', () => {
  const csv = 'name\nJohn\nJane';
  const result = parseCSV(csv);
  assert.deepStrictEqual(result, [
    { name: 'John' },
    { name: 'Jane' }
  ]);
});

test('handles malformed CSV with extra columns', () => {
  const csv = 'name,age\nJohn,30,extra\nJane,25';
  const result = parseCSV(csv);
  assert.deepStrictEqual(result[0].name, 'John');
  assert.deepStrictEqual(result[0].age, '30');
});

test('handles malformed CSV with fewer columns', () => {
  const csv = 'name,age\nJohn\nJane,25';
  const result = parseCSV(csv);
  assert.deepStrictEqual(result[0].name, 'John');
  assert.strictEqual(result[0].age, '');
});

test('handles single quoted field', () => {
  const csv = 'name\n"John"';
  const result = parseCSV(csv);
  assert.deepStrictEqual(result, [{ name: 'John' }]);
});

test('handles escaped quotes in CSV', () => {
  const csv = 'name\n"John ""The Great"" Doe"';
  const result = parseCSV(csv);
  assert.deepStrictEqual(result, [{ name: 'John "The Great" Doe' }]);
});
