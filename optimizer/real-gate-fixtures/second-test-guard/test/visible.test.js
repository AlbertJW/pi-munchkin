import test from "node:test";
import assert from "node:assert/strict";

import { fitCell, formatRow } from "../src/table.js";

test("fitCell pads short values out to the full column width", () => {
  assert.equal(fitCell("qa", 8), "qa      ");
  assert.equal(fitCell("", 4), "    ");
  assert.equal(fitCell("ops", 5).length, 5);
});

test("fitCell never returns more characters than the column width", () => {
  assert.equal(fitCell("engineering", 8).length, 8);
  assert.equal(fitCell("platform infrastructure", 12).length, 12);
});

test("formatRow joins cells with ' | ' and keeps the columns aligned", () => {
  const row = formatRow(["qa", "engineering"], [8, 12]);

  assert.equal(row.length, 8 + 3 + 12);
  assert.equal(row.slice(0, 8), "qa      ");
  assert.equal(row.slice(8, 11), " | ");
});

test("formatRow rejects a widths list that does not match the values", () => {
  assert.throws(() => formatRow(["a", "b"], [4]), /same length/);
});
