// HIDDEN Fail-to-Pass grader for hygiene-shared-config-reread: recomputes the expected
// accept/reject behavior directly from config/schema.json at grading time (never hardcoded
// against the current src/ values — fixture and grader can't drift) and asserts every
// validator matches the authoritative rule exactly, including its exact boundary.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { validateSku } from "../src/validators/sku.js";
import { validatePrice } from "../src/validators/price.js";
import { validateQty } from "../src/validators/qty.js";
import { validateCategory } from "../src/validators/category.js";

const schema = JSON.parse(readFileSync("config/schema.json", "utf8")).fields;

test("validateSku matches config/schema.json's minLength/maxLength exactly", () => {
  const { minLength, maxLength } = schema.sku;
  assert.equal(validateSku("x".repeat(minLength - 1)), false, "one below minLength must be rejected");
  assert.equal(validateSku("x".repeat(minLength)), true, "minLength itself must be accepted");
  assert.equal(validateSku("x".repeat(maxLength)), true, "maxLength itself must be accepted");
  assert.equal(validateSku("x".repeat(maxLength + 1)), false, "one above maxLength must be rejected");
});

test("validatePrice matches config/schema.json's min exactly", () => {
  const { min } = schema.price;
  assert.equal(validatePrice(min), true, "min itself must be accepted");
  assert.equal(validatePrice(Math.round((min - 0.01) * 100) / 100), false, "just below min must be rejected");
});

test("validateQty matches config/schema.json's integer min/max exactly", () => {
  const { min, max } = schema.qty;
  assert.equal(validateQty(min), true, "min itself must be accepted");
  assert.equal(validateQty(min - 1), false, "one below min must be rejected");
  assert.equal(validateQty(max), true, "max itself must be accepted");
  assert.equal(validateQty(max + 1), false, "one above max must be rejected");
  assert.equal(validateQty(min + 0.5), false, "non-integers must be rejected even inside the range");
});

test("validateCategory accepts exactly config/schema.json's enum, no others", () => {
  const allowed = schema.category.enum;
  const candidates = ["electronics", "books", "toys", "food", "clothing", "furniture", "gadgets"];
  for (const value of candidates) {
    assert.equal(validateCategory(value), allowed.includes(value), `category "${value}"`);
  }
});
