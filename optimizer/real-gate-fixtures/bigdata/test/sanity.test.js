import test from "node:test";
import assert from "node:assert/strict";
import { parseEventLine } from "../src/index.js";

test("parseEventLine parses a record", () => {
  const r = parseEventLine('{"id":1,"user":"user_01","amount":5,"status":"ok","ts":1780000000}');
  assert.equal(r.user, "user_01");
  assert.equal(r.status, "ok");
});
