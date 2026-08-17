#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { constants, createReadStream } from "node:fs";
import { lstat, open } from "node:fs/promises";
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

// Committed-but-unpushed range. The working-tree diff above cannot see content
// that was already committed — a commit→scan→push sequence would report clean on
// a live secret (this repo has a prior committed-endpoint incident). Three-dot
// diff = our side since the merge-base, so together the two diffs cover
// everything a push would publish. Skipped with a notice when origin/main is
// absent (fresh clone, offline CI) rather than failing the scan outright.
let rangeNote = "";
try {
  const rangeDiff = git(["diff", "origin/main...HEAD", "--no-color", "--no-ext-diff", "--unified=0"]);
  const rangeAdded = parseUnifiedDiff(rangeDiff);
  inspected += rangeAdded.length;
  findings.push(...scanAddedLines(rangeAdded));
} catch {
  rangeNote = "; unpushed-commit range NOT scanned (origin/main unavailable)";
}
const untracked = git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean);
for (const file of untracked) {
  let handle;
  try {
    const linkMetadata = await lstat(file);
    if (!linkMetadata.isFile()) {
      findings.push({ file, line: 0, pattern: "UNTRACKED_NON_REGULAR" });
      continue;
    }
    // Re-open without following symlinks, then inspect the opened descriptor's
    // metadata. This closes the lstat/open substitution window.
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = await handle.stat();
    if (!metadata.isFile()) {
      findings.push({ file, line: 0, pattern: "UNTRACKED_NON_REGULAR" });
      continue;
    }
    if (metadata.size > 32 * 1024 * 1024) {
      findings.push({ file, line: 0, pattern: "UNTRACKED_FILE_TOO_LARGE" });
      continue;
    }
    const lines = createInterface({ input: createReadStream(file, { fd: handle.fd, autoClose: false }), crlfDelay: Infinity });
    let lineNumber = 0;
    for await (const text of lines) {
      lineNumber += 1;
      inspected += 1;
      findings.push(...scanAddedLines([{ file, line: lineNumber, text }]));
    }
  } catch {
    findings.push({ file, line: 0, pattern: "UNTRACKED_READ_FAILED" });
  } finally {
    await handle?.close().catch(() => {});
  }
}
const safeFile = (file) => file.replace(/[\x00-\x1f\x7f]/g, "?").slice(0, 512);
for (const finding of findings) console.error(`${safeFile(finding.file)}:${finding.line}: ${finding.pattern}`);
if (findings.length) {
  console.error(`secret scan: ${findings.length} finding(s); matched text suppressed`);
  process.exitCode = 1;
} else {
  console.log(`secret scan: clean (${inspected} added line(s) inspected${rangeNote})`);
}
