import test from "node:test";
import assert from "node:assert/strict";
import { reset, findItem } from "../src/db.js";
import { validateLine } from "../src/validate.js";
import { placeOrder, listOrders, _resetIds } from "../src/orders.js";
import { taxForLines } from "../src/tax.js";
import { subtotal } from "../src/pricing.js";
import { cents } from "../src/util/format.js";

test("cents formatting", () => {
  assert.equal(cents(1140), "$11.40");
  assert.equal(cents(-905), "-$9.05");
});

test("validation rejects malformed lines", () => {
  assert.equal(validateLine({ sku: 42, qty: 1 }).ok, false);
  assert.equal(validateLine({ sku: "BK-001", qty: -1 }).ok, false);
  assert.equal(validateLine({ sku: "BK-001", qty: 2 }).ok, true);
});

test("placing an order decrements stock and enforces availability", () => {
  reset(); _resetIds();
  placeOrder([{ sku: "EL-102", qty: 3 }]);
  assert.equal(findItem("EL-102").stock, 5);
  assert.throws(() => placeOrder([{ sku: "EL-102", qty: 99 }]), /insufficient stock/);
});

test("orders are logged in placement order", () => {
  reset(); _resetIds();
  const a = placeOrder([{ sku: "BK-001", qty: 1 }]);
  const b = placeOrder([{ sku: "FD-202", qty: 2 }]);
  assert.deepEqual(listOrders().map((o) => o.id), [a.id, b.id]);
});

test("per-category tax math", () => {
  reset();
  assert.equal(taxForLines([{ sku: "BK-001", qty: 2 }]), 180); // 900 * 0.20
  assert.equal(taxForLines([{ sku: "FD-201", qty: 1 }]), 50);  // 999 * 0.05
});

test("single-line subtotal", () => {
  reset();
  assert.equal(subtotal([{ sku: "BK-001", qty: 1 }]), 450);
});
