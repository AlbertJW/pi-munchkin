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
