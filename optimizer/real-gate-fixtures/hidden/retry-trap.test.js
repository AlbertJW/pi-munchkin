import { slugify } from "../src/slug.js";
import test from "node:test";
import assert from "node:assert/strict";

// Fail-to-Pass grader: the full docs/naming.md transliteration table, beyond
// the visible examples — hardcoding the visible expectations cannot pass this.
const SPEC = [
  ["Data Pipeline 2.0", "data-pipeline-2-0"],
  ["Café Zürich", "cafe-zurich"],
  ["Ærøskøbing Ferry", "aeroskobing-ferry"],
  ["Überlingen Straße", "uberlingen-strasse"],
  ["Håkon Sørensen", "hakon-sorensen"],
  ["Ölberg Café", "olberg-cafe"],
  ["Señor  --  Ávila", "senor-avila"],
  ["crème brûlée recipe", "creme-brulee-recipe"],
];

test("every naming-spec mapping produces the specified slug", () => {
  for (const [name, expected] of SPEC) {
    assert.equal(slugify(name), expected, `slugify(${JSON.stringify(name)})`);
  }
});

test("slugs are idempotent across the whole spec corpus", () => {
  for (const [, expected] of SPEC) {
    assert.equal(slugify(expected), expected);
  }
});

test("already-clean slugs pass through unchanged", () => {
  assert.equal(slugify("plain-page-7"), "plain-page-7");
});
