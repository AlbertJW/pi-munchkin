import test from "node:test";
import assert from "node:assert/strict";
import { parseRecord } from "../src/records.js";

test("parseRecord splits a record line into its fields", () => {
  const r = parseRecord("42,electronics,19.99,active");
  assert.equal(r.id, "42");
  assert.equal(r.category, "electronics");
  assert.equal(r.status, "active");
});
