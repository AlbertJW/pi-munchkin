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

function resolves(ref) {
  try {
    git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

// The baseline this scan diffs against. CI checks out a single commit, so the
// working-tree diff is empty and `origin/main` may not exist at all — the scan
// then inspected ZERO lines and still printed "clean", which reads as a gate but
// gated nothing (2026-08-21). Resolution order, first that exists wins; nothing
// resolving is FAIL, never a pass:
//   SECRET_SCAN_BASE  explicit override (manual audit of an arbitrary range)
//   origin/$GITHUB_BASE_REF   pull_request — everything the PR would merge
//   $GITHUB_EVENT_BEFORE      push — exactly what this push publishes, which is
//                             the only baseline that covers a push to main (there
//                             origin/main IS HEAD, so its range is empty)
//   origin/main               local default: everything not yet published
// CI must check out with `fetch-depth: 0`; a shallow clone resolves none of these
// and the stage fails loudly instead of waving the push through.
const before = process.env.GITHUB_EVENT_BEFORE || "";
const baseCandidates = [
  process.env.SECRET_SCAN_BASE,
  process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`,
  /^[0-9a-f]{40}$/.test(before) && !/^0+$/.test(before) ? before : "",
  "origin/main",
].filter(Boolean);
const base = baseCandidates.find(resolves);
if (!base) {
  console.error(`secret scan: no baseline resolved from [${baseCandidates.join(", ")}]`);
  console.error("secret scan: refusing to report a result on an unscanned range (CI needs fetch-depth: 0)");
  process.exit(1);
}

const diff = git(["diff", "HEAD", "--no-color", "--no-ext-diff", "--unified=0"]);
const added = parseUnifiedDiff(diff);
let inspected = added.length;
const findings = scanAddedLines(added);

// Committed-but-unpublished range. The working-tree diff above cannot see content
// that was already committed — a commit→scan→push sequence would report clean on
// a live secret (this repo has a prior committed-endpoint incident). Three-dot
// diff = our side since the merge-base, so together the two diffs cover
// everything a push would publish.
const rangeDiff = git(["diff", `${base}...HEAD`, "--no-color", "--no-ext-diff", "--unified=0"]);
const rangeAdded = parseUnifiedDiff(rangeDiff);
inspected += rangeAdded.length;
findings.push(...scanAddedLines(rangeAdded));
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
    // metadata. O_NOFOLLOW closes the symlink substitution window; O_NONBLOCK closes
    // the remaining one — a regular file swapped for a FIFO after the lstat is not a
    // symlink, so O_NOFOLLOW admits it and a blocking open would hang this scan
    // forever (2026-08-18: the comment previously claimed the window was closed).
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
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
} else if (inspected === 0) {
  // Not "clean" — nothing was published-to-be. Saying clean here is the false
  // assurance this stage exists to avoid.
  console.log(`secret scan: nothing pending against ${base}`);
} else {
  console.log(`secret scan: clean (${inspected} added line(s) inspected against ${base})`);
}
