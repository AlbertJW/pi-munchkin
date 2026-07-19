import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../src/index.js";

test("existing public exports remain available", () => {
  assert.equal(typeof api.encode, "function");
  assert.equal(typeof api.decode, "function");
});
