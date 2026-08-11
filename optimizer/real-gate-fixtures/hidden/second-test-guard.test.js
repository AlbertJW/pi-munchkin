import test from "node:test";
import assert from "node:assert/strict";

import { fitCell, formatRow } from "../src/table.js";

test("over-long values are truncated and marked with an ellipsis", () => {
  assert.equal(fitCell("engineering", 6), "engin…");
  assert.equal(fitCell("observability", 10), "observabi…");
  assert.equal(fitCell("reliability engineering", 15), "reliability en…");
});

test("a truncated cell still occupies exactly the column width", () => {
  const cell = fitCell("reliability engineering", 9);

  assert.equal(cell.length, 9);
  assert.equal(cell.endsWith("…"), true);
});

test("values that exactly fill the column are left untouched", () => {
  assert.equal(fitCell("release", 7), "release");
  assert.equal(fitCell("qa", 2), "qa");
});

test("a row keeps its total width when one of its cells is truncated", () => {
  const row = formatRow(["observability", "qa"], [10, 4]);

  assert.equal(row, "observabi… | qa  ");
  assert.equal(row.length, 10 + 3 + 4);
});
