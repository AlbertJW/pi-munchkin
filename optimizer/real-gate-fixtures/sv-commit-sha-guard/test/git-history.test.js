import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

// Soft hygiene check for the LIVE session sandbox only. fixture_admission.py's
// static pristine/gold/mutant checks apply file patches directly and never run
// `git init` (its copytree strips any .git dir on purpose), so every one of
// those runs has no .git here and this test is a no-op skip — it never blocks
// admission. In a real gate round the canonical prompt instructs the model to
// git init and commit twice; if it starts that and then botches or abandons it
// partway, this fails loudly on a cheap check instead of silently starving
// PLAN_SHA_GUARD of anything to verify. A model that skips git entirely still
// passes this specific check (skip, not fail) — that gap is intentional and
// documented, not an oversight; see the fixture manifest's sufficiency notes.
test(
  "if a git repo was started, it has at least 2 commits (data-layer + caller)",
  { skip: !existsSync(".git") },
  () => {
    const log = execFileSync("git", ["log", "--oneline"], { encoding: "utf8" });
    const count = log.trim() ? log.trim().split("\n").length : 0;
    assert.ok(count >= 2, `expected >= 2 commits once git is initialized, found ${count}`);
  },
);
