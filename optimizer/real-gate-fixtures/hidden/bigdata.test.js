// HIDDEN Fail-to-Pass grader for bigdata: recomputes the expected top-3 from
// data/events.jsonl at grading time (never hardcoded — fixture and grader can't
// drift) and asserts src/top3.json matches exactly.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("src/top3.json holds the top-3 users by total ok-amount, descending", () => {
  const totals = new Map();
  for (const line of readFileSync("data/events.jsonl", "utf8").split("\n")) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.status !== "ok") continue;
    totals.set(r.user, (totals.get(r.user) ?? 0) + r.amount);
  }
  const expected = [...totals.entries()]
    .map(([user, total]) => ({ user, total: Math.round(total * 100) / 100 }))
    .sort((a, b) => b.total - a.total || a.user.localeCompare(b.user))
    .slice(0, 3);

  const got = JSON.parse(readFileSync("src/top3.json", "utf8"));
  assert.equal(Array.isArray(got), true, "top3.json must be an array");
  assert.equal(got.length, 3, "exactly 3 entries");
  for (let i = 0; i < 3; i++) {
    assert.equal(got[i].user, expected[i].user, `rank ${i + 1} user`);
    assert.ok(Math.abs(got[i].total - expected[i].total) < 0.01, `rank ${i + 1} total (${got[i].total} vs ${expected[i].total})`);
  }
});
