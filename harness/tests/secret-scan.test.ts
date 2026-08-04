import test from "node:test";
import assert from "node:assert/strict";
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
