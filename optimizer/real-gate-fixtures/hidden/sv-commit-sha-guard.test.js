// HIDDEN Fail-to-Pass grader for sv-commit-sha-guard: recomputes the expected
// per-category totals directly from data/records.csv at grading time (never
// trusts src/records.js or anything the model wrote — fixture and grader
// can't drift) and asserts src/summary.json matches exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("src/summary.json holds active-only per-category totals, descending", () => {
  const lines = readFileSync("data/records.csv", "utf8").trim().split("\n").slice(1);
  const totals = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    const [, category, amount, status] = line.split(",");
    if (status !== "active") continue;
    totals.set(category, (totals.get(category) ?? 0) + Number(amount));
  }
  const expected = [...totals.entries()]
    .map(([category, total]) => ({ category, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.category.localeCompare(b.category));

  const got = JSON.parse(readFileSync("src/summary.json", "utf8"));
  assert.equal(Array.isArray(got), true, "summary.json must be an array");
  assert.equal(got.length, expected.length, `exactly ${expected.length} categories`);
  for (let i = 0; i < expected.length; i++) {
    assert.equal(got[i].category, expected[i].category, `rank ${i + 1} category`);
    assert.ok(
      Math.abs(got[i].total - expected[i].total) < 0.01,
      `rank ${i + 1} total (${got[i].total} vs ${expected[i].total})`,
    );
  }
});
