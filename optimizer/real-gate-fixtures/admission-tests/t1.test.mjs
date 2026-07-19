import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "../src/index.js";

test("parseCsv is the only project spelling", () => {
  assert.deepEqual(parseCsv("a\n1"), [{ a: "1" }]);
  for (const dir of ["src", "test"]) {
    for (const file of readdirSync(dir).filter((x) => x.endsWith(".js"))) {
      assert.doesNotMatch(readFileSync(join(dir, file), "utf8"), /parseCSV/);
    }
  }
});
