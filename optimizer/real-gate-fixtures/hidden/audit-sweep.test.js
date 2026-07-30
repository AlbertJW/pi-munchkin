// audit-sweep GRADED grader — plain node script, NOT node:test.
// Runs 8 independent per-defect checks, writes .audit-grade.json
// {fixed, total, defects}, prints a summary, exits 0 iff 8/8.
// The gate's binary score stays strict; the deferred subscores passthrough
// reads the JSON for graded analysis.
import { writeFileSync } from "node:fs";
import assert from "node:assert/strict";
import { reset, findItem } from "../src/db.js";
import { validateLine } from "../src/validate.js";
import { placeOrder, listOrders, topOrders, _resetIds } from "../src/orders.js";
import { getStock, _clearCache } from "../src/inventory.js";
import { subtotal } from "../src/pricing.js";
import { totalWithDiscount } from "../src/discounts.js";
import { dayKey } from "../src/util/dates.js";
import { page } from "../src/util/format.js";
import { dailyRevenue } from "../src/report.js";

const defects = {};
function check(name, fn) {
  try { reset(); _resetIds(); _clearCache(); fn(); defects[name] = true; }
  catch { defects[name] = false; }
}

check("d1_pagination", () => {
  const items = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.deepEqual(page(items, 1, 10), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(page(items, 2, 10), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
});

check("d2_zero_qty", () => {
  assert.equal(validateLine({ sku: "BK-001", qty: 0 }).ok, false);
});

check("d3_integer_cents", () => {
  const sub = subtotal([{ sku: "BK-002", qty: 3 }]); // 380 * 3 — floats give 1139.9999…
  assert.equal(sub, 1140);
  assert.ok(Number.isInteger(sub));
});

check("d4_discount_after_tax", () => {
  // FD-201: 999, food 5% → taxed 1049; 33% off after tax → round(1049*0.67)=703.
  assert.equal(totalWithDiscount([{ sku: "FD-201", qty: 1 }], 33), 703);
});

check("d5_day_key", () => {
  assert.equal(dayKey(new Date(Date.UTC(2026, 0, 15))), "2026-01-15");
  assert.notEqual(dayKey(new Date(Date.UTC(2026, 1, 15))), dayKey(new Date(Date.UTC(2026, 0, 15))));
});

check("d6_report_no_mutation", () => {
  const a = placeOrder([{ sku: "BK-001", qty: 1 }]);
  placeOrder([{ sku: "BK-002", qty: 5 }]);
  topOrders(1);
  assert.equal(listOrders()[0].id, a.id, "topOrders must not reorder the log");
});

check("d7_fresh_stock", () => {
  assert.equal(getStock("EL-101"), 12);
  placeOrder([{ sku: "EL-101", qty: 2 }]);
  assert.equal(getStock("EL-101"), 10, "stock reads must reflect placements");
});

check("d8_category_tax_in_report", () => {
  placeOrder([{ sku: "FD-201", qty: 2 }], new Date(Date.UTC(2026, 0, 15)));
  const total = [...dailyRevenue().values()].reduce((s, v) => s + v, 0);
  // 1998 + 5% food tax = 2098 (rounded compare keeps this independent of d3).
  assert.equal(Math.round(total), 2098);
});

const fixed = Object.values(defects).filter(Boolean).length;
writeFileSync(".audit-grade.json", JSON.stringify({ fixed, total: 8, defects }, null, 2));
console.log(`audit-sweep grade: ${fixed}/8`, defects);
process.exit(fixed === 8 ? 0 : 1);
