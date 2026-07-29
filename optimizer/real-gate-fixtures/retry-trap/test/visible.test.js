import { slugify } from "../src/slug.js";
import test from "node:test";
import assert from "node:assert/strict";

test("plain names slugify cleanly", () => {
  assert.equal(slugify("Data Pipeline 2.0"), "data-pipeline-2-0");
});

test("mapped accents transliterate per the naming spec", () => {
  assert.equal(slugify("Señor Muñoz"), "senor-munoz");
  assert.equal(slugify("À la carte menu"), "a-la-carte-menu");
});

test("slugs are idempotent", () => {
  assert.equal(slugify(slugify("Data Pipeline 2.0")), "data-pipeline-2-0");
});
