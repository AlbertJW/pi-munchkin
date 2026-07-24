import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

test("if a git repo was started, it has at least 2 commits (baseline + fix)",
  { skip: !existsSync(".git") },
  () => {
    const log = execFileSync("git", ["log", "--oneline"], { encoding: "utf8" });
    const count = log.trim() ? log.trim().split("\n").length : 0;
    assert.ok(count >= 2, `expected >= 2 commits once git is initialized, found ${count}`);
  });
