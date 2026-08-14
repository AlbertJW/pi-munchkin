#!/usr/bin/env node
// live-mirror-apply — copy exactly the first-party files the package manifest
// declares into a live agent directory, then prove zero drift.
//
// This exists because the rollout step "mirror the harness into ~/.pi/agent" had
// no script: it was done by hand or by an ad-hoc copy each time, which is the
// single manual step the whole measurement chain depends on. It shares
// buildLiveMirrorPlan with live-mirror-check, so the set copied/generated and the set
// verified cannot drift apart.
//
// Rollout is human-gated: this refuses to run unless the source tree is a clean
// checkout of a pushed commit, so a live harness can never contain code that is
// not in the public repository.
//
//   node harness/scripts/live-mirror-apply.mjs [agent-dir] [--force]

import { execFileSync } from "node:child_process";
import { copyFile, mkdir, readFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";
import { readdir, unlink, writeFile } from "node:fs/promises";
import { buildLiveMirrorPlan, compareLiveMirror, findLiveMirrorOrphans, LIVE_PACKAGE_DIR } from "../lib/live-mirror.ts";

const root = resolve(import.meta.dirname, "../..");
const args = process.argv.slice(2).filter((arg) => arg !== "--force" && arg !== "--prune");
const force = process.argv.includes("--force");
const prune = process.argv.includes("--prune");
const agentDir = resolve(args[0] ?? process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent"));

const git = (...argv) => execFileSync("git", argv, { cwd: root, encoding: "utf8" }).trim();

if (!force) {
  const problems = [];
  // A live pi reading the tree mid-copy would observe a mixed old/new surface.
  // Whole-tree atomicity is not on offer from a filesystem, but refusing to
  // roll out UNDER a running pi removes the realistic collision.
  try {
    const running = execFileSync("pgrep", ["-fl", "pi"], { encoding: "utf8" })  // broad; the filter below is the precise test
      .split("\n").filter((line) => /(^|\/)pi( |$)/.test(line.replace(/^\d+\s+/, ""))).length;
    if (running > 0) problems.push(`${running} running pi process(es) — a mid-copy load would see a mixed surface`);
  } catch { /* pgrep exits 1 when nothing matches: that is the good case */ }
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
const entries = await buildLiveMirrorPlan(root, manifest);
// Per-file staging: write beside the target, then rename(2) over it. A crash or
// disk error mid-rollout leaves stale .staging files and INTACT previous
// versions — never a torn file. (Cross-file atomicity is documented as out of
// scope; the running-pi refusal above covers the realistic mixed-read case.)
for (const entry of entries) {
  const destination = resolve(agentDir, entry.destination);
  await mkdir(dirname(destination), { recursive: true });
  const staging = `${destination}.staging-${process.pid}`;
  try {
    if (entry.kind === "copy") await copyFile(resolve(root, entry.source), staging);
    else await writeFile(staging, entry.content, { mode: 0o600 });
    await rename(staging, destination);
  } catch (error) {
    await unlink(staging).catch(() => {});
    throw error;
  }
}

// Remove the FLAT first-party files a previous mirror left at the extensions
// root: they would be discovered by rule 1 and loaded a SECOND time, out of
// order, alongside the ordered package.
const managed = new Set(entries
  .filter((entry) => entry.kind === "copy" && entry.destination.startsWith(`${LIVE_PACKAGE_DIR}/extensions/`))
  .map((entry) => entry.destination.slice(`${LIVE_PACKAGE_DIR}/extensions/`.length)));
let removedStale = 0;
try {
  for (const name of await readdir(resolve(agentDir, "extensions"))) {
    if (managed.has(name)) {
      await unlink(resolve(agentDir, "extensions", name));
      removedStale += 1;
    }
  }
} catch { /* no extensions dir yet: nothing stale to remove */ }

const drift = await compareLiveMirror(root, agentDir, entries);
if (drift.length) {
  for (const item of drift) console.error(`${item.destination}: ${item.reason}`);
  console.error(`live mirror apply: copied ${entries.length} files but ${drift.length} still differ`);
  process.exit(1);
}

// In-package orphans: files the manifest no longer declares but a prior mirror
// left inside the package dir (e.g. a retired extension). Deletion is
// human-gated: report by default, delete only under --prune. The sweep never
// touches the flat extensions root, root lib/vendor/tests, or chaos.ts.
const { orphans, staging } = await findLiveMirrorOrphans(agentDir, entries);
let pruned = 0;
if (orphans.length || staging.length) {
  if (prune) {
    for (const rel of [...orphans, ...staging]) {
      await unlink(resolve(agentDir, rel)).catch(() => {});
      pruned += 1;
    }
  } else {
    for (const rel of orphans) console.error(`orphan (not in manifest): ${rel}`);
    for (const rel of staging) console.error(`staging leftover: ${rel}`);
    console.error(`live mirror apply: ${orphans.length} orphan(s) + ${staging.length} staging leftover(s) under ${LIVE_PACKAGE_DIR}. ` +
      "Re-run with --prune to delete them (human-gated); mirror:check will fail until they are gone.");
  }
}
console.log(`live mirror apply: ${entries.length} first-party artifacts written to ${agentDir}; zero drift`);
console.log(`live mirror apply: ordered entry point verified at ${LIVE_PACKAGE_DIR}/package.json` +
  (removedStale ? `; removed ${removedStale} stale flat extension file(s) that would have loaded out of order` : "") +
  (pruned ? `; pruned ${pruned} in-package orphan/staging file(s)` : ""));
console.log("Next: record the loaded surface hash in docs/SURFACE_BOUNDARIES.md —");
console.log(`  node --experimental-strip-types harness/scripts/surface-hash.ts ${agentDir}`);
