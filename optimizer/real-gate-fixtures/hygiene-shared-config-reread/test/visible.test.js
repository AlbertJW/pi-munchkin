import test from "node:test";
import assert from "node:assert/strict";
import { validateSku } from "../src/validators/sku.js";
import { validatePrice } from "../src/validators/price.js";
import { validateQty } from "../src/validators/qty.js";
import { validateCategory } from "../src/validators/category.js";

test("validateSku accepts a normal sku, rejects non-strings", () => {
  assert.equal(validateSku("abcdef"), true);
  assert.equal(validateSku(123), false);
});

test("validatePrice accepts a normal price, rejects non-numbers", () => {
  assert.equal(validatePrice(5), true);
  assert.equal(validatePrice("5"), false);
});

test("validateQty accepts a normal integer qty, rejects negatives", () => {
  assert.equal(validateQty(10), true);
  assert.equal(validateQty(-1), false);
});

test("validateCategory accepts a normal known category, rejects junk", () => {
  assert.equal(validateCategory("books"), true);
  assert.equal(validateCategory("not-a-category"), false);
});
