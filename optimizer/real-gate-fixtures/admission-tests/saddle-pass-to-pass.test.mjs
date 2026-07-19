import test from "node:test";
import assert from "node:assert/strict";
import * as api from "../src/index.js";

test("existing public export remains available", () => {
  assert.equal(typeof api.saddlePoints, "function");
});
