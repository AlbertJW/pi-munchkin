import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseUnifiedDiff, scanAddedLines } from "../lib/secret-scan.ts";

test("diff secret scan reports only location and pattern identifiers", () => {
  const credential = ["sk", "-abcdefghijklmnopqrstuvwxyz123456"].join("");
  const endpoint = ["http://", "127.0.0.1:9000/internal"].join("");
  const ipv6Endpoint = ["https://", "[::1]/internal"].join("");
  const diff = [
    "diff --git a/example.txt b/example.txt",
    "--- a/example.txt",
    "+++ b/example.txt",
    "@@ -0,0 +1,4 @@",
    `+token=${credential}`,
    `+endpoint=${endpoint}`,
    `+endpoint6=${ipv6Endpoint}`,
    "+TOKEN=dummy-sentinel-value",
  ].join("\n");
  const findings = scanAddedLines(parseUnifiedDiff(diff));
  assert.deepEqual(findings, [
    { file: "example.txt", line: 1, pattern: "PROVIDER_TOKEN" },
    { file: "example.txt", line: 2, pattern: "PRIVATE_ENDPOINT" },
    { file: "example.txt", line: 3, pattern: "PRIVATE_ENDPOINT" },
  ]);
  const output = findings.map(({ file, line, pattern }) => `${file}:${line}: ${pattern}`).join("\n");
  assert(!output.includes(credential));
  assert(!output.includes(endpoint));
  assert(!output.includes(ipv6Endpoint));
  assert(!output.includes("token="));
});

test("PROVIDER_TOKEN placeholder suppression is scoped to the token, not the line", () => {
  const real = ["sk", "-ABCDEFGHIJKLMNOPQRSTUV12345"].join("");
  const fake = ["sk", "-dummydummydummydummydummy"].join("");
  const lines = [
    // the QA repro: a real token whose LINE mentions "test" must still be found
    { file: "a.ts", line: 1, text: `const key = "${real}"; // used in test env` },
    // a genuinely fake token is still suppressed, wherever it sits
    { file: "a.ts", line: 2, text: `const key = "${fake}";` },
  ];
  const findings = scanAddedLines(lines);
  assert.deepEqual(findings, [{ file: "a.ts", line: 1, pattern: "PROVIDER_TOKEN" }]);
});

test("diff scanner refuses an untracked directory symlink without following or crashing", () => {
  const repo = mkdtempSync(join(tmpdir(), "secret-scan-symlink-"));
  const target = mkdtempSync(join(tmpdir(), "secret-scan-target-"));
  const script = join(process.cwd(), "harness", "scripts", "secret-scan-diff.mjs");
  try {
    execFileSync("git", ["init", "-q"], { cwd: repo });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base"], { cwd: repo });
    mkdirSync(join(target, "nested"));
    symlinkSync(target, join(repo, "linked-directory"), "dir");
    const result = spawnSync(process.execPath, [script], { cwd: repo, encoding: "utf8" });
    assert.equal(result.status, 1, "a non-regular untracked entry fails closed");
    assert.match(result.stderr, /^linked-directory:0: UNTRACKED_NON_REGULAR/m);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /EISDIR|secret-scan-target/);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(target, { recursive: true, force: true });
  }
});
