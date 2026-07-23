import test from "node:test";
import assert from "node:assert/strict";
import { parseCSV } from "../src/index.js";

test("trim false preserves unquoted field whitespace", () => {
  assert.deepEqual(parseCSV(" name , age \n John , 30 ", { trim: false }),
                   [{ " name ": " John ", " age ": " 30 " }]);
});

test("default remains trimmed", () => {
  assert.deepEqual(parseCSV(" name , age \n John , 30 "), [{ name: "John", age: "30" }]);
});

test("trim false still respects quoted fields with embedded commas", () => {
  const csv = 'name,address\n"John Doe","123 Main St, Apt 4"';
  assert.deepEqual(parseCSV(csv, { trim: false }),
                   [{ name: "John Doe", address: "123 Main St, Apt 4" }]);
});
