#!/usr/bin/env node
// live-mirror-apply — copy exactly the first-party files the package manifest
// declares into a live agent directory, then prove zero drift.
//
// This exists because the rollout step "mirror the harness into ~/.pi/agent" had
// no script: it was done by hand or by an ad-hoc copy each time, which is the
// single manual step the whole measurement chain depends on. It shares
// buildLiveMirrorManifest with live-mirror-check, so the set copied and the set
// verified cannot drift apart.
//
// Rollout is human-gated: this refuses to run unless the source tree is a clean
// checkout of a pushed commit, so a live harness can never contain code that is
// not in the public repository.
//
//   node harness/scripts/live-mirror-apply.mjs [agent-dir] [--force]

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { buildLiveMirrorManifest, compareLiveMirror } from "../lib/live-mirror.ts";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((arg) => arg !== "--force");
const force = process.argv.includes("--force");
const agentDir = resolve(args[0] ?? process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent"));

const git = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();

if (!force) {
  const problems = [];
  try {
    if (git("status", "--porcelain")) problems.push("working tree is dirty");
    const head = git("rev-parse", "HEAD");
    let upstream = "";
    try { upstream = git("rev-parse", "@{upstream}"); } catch { problems.push("no upstream branch"); }
    if (upstream && upstream !== head) problems.push("HEAD is not pushed to its upstream");
  } catch (error) {
    problems.push(`git inspection failed: ${error.message}`);
  }
  if (problems.length) {
    console.error(`live mirror apply: refusing — ${problems.join("; ")}`);
    console.error("A live harness must be reproducible from the public repository. Commit and push first, or pass --force for a deliberate experiment.");
    process.exit(1);
  }
}

const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const entries = await buildLiveMirrorManifest(root, manifest);
for (const entry of entries) {
  const destination = resolve(agentDir, entry.destination);
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(resolve(root, entry.source), destination);
}

const drift = await compareLiveMirror(root, agentDir, entries);
if (drift.length) {
  for (const item of drift) console.error(`${item.destination}: ${item.reason}`);
  console.error(`live mirror apply: copied ${entries.length} files but ${drift.length} still differ`);
  process.exit(1);
}
console.log(`live mirror apply: ${entries.length} first-party files copied to ${agentDir}; zero drift`);
console.log("Next: record the loaded surface hash in docs/SURFACE_BOUNDARIES.md —");
console.log(`  node --experimental-strip-types harness/scripts/surface-hash.ts ${agentDir}`);
