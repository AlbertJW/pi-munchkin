#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { parseUnifiedDiff, scanAddedLines } from "../lib/secret-scan.ts";

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  } catch {
    throw new Error("secret scan: git input collection failed; output suppressed");
  }
}

const diff = git(["diff", "HEAD", "--no-color", "--no-ext-diff", "--unified=0"]);
const added = parseUnifiedDiff(diff);
let inspected = added.length;
const findings = scanAddedLines(added);
const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
for (const file of untracked) {
  const metadata = await stat(file);
  if (metadata.size > 32 * 1024 * 1024) {
    findings.push({ file, line: 0, pattern: "UNTRACKED_FILE_TOO_LARGE" });
    continue;
  }
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  let lineNumber = 0;
  for await (const text of lines) {
    lineNumber += 1;
    inspected += 1;
    findings.push(...scanAddedLines([{ file, line: lineNumber, text }]));
  }
}
const safeFile = (file) => file.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 512);
for (const finding of findings) console.error(`${safeFile(finding.file)}:${finding.line}: ${finding.pattern}`);
if (findings.length) {
  console.error(`secret scan: ${findings.length} finding(s); matched text suppressed`);
  process.exitCode = 1;
} else {
  console.log(`secret scan: clean (${inspected} added line(s) inspected)`);
}
