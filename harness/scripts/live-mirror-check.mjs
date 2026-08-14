#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { relative, resolve } from "node:path";
import { buildLiveMirrorPlan, compareLiveMirror, findLiveMirrorOrphans } from "../lib/live-mirror.ts";
import { discoverExtensionEntriesInDir } from "../lib/surface-walk.ts";

// Pi auto-loads every top-level extensions/*.ts it finds. Comparing manifest ->
// live therefore proves the declared files are present and identical, but says
// nothing about files the live directory has and the manifest does not: an
// extension dropped from the manifest keeps loading forever while this check
// stays green. Anything unmanaged must be named here, with a reason.
const DOCUMENTED_LOCAL_ONLY = new Set([
  // Fault injector for the gauntlet; deliberately excluded from the package and
  // inert unless CHAOS is set. Recorded in docs/SURFACE_BOUNDARIES.md because it
  // is part of the LOADED surface hash even though it ships in no release.
  "chaos.ts",
]);

const root = resolve(import.meta.dirname, "../..");
const agentDir = resolve(process.argv[2] ?? process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent"));
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const entries = await buildLiveMirrorPlan(root, manifest);
const drift = await compareLiveMirror(root, agentDir, entries);
const managed = new Set(entries.map((entry) => entry.destination));
let unmanaged = [];
try {
  const extensionsRoot = resolve(agentDir, "extensions");
  const loadableOwners = new Set((await discoverExtensionEntriesInDir(extensionsRoot)).map((entry) =>
    relative(extensionsRoot, entry).split(/[\\/]/)[0]));
  const managedOwners = new Set([...managed]
    .filter((destination) => destination.startsWith("extensions/"))
    .map((destination) => destination.slice("extensions/".length).split("/")[0]));
  unmanaged = [...loadableOwners]
    .filter((name) => !managedOwners.has(name) && !DOCUMENTED_LOCAL_ONLY.has(name));
} catch { /* no live extensions dir — the drift report below already says so */ }

// The owner-granularity check above catches FLAT orphans (owner "micro-gate.ts"),
// but a file left inside the package dir has owner "pi-munchkin" (managed), so it
// slips through. findLiveMirrorOrphans walks the package dir itself to catch it.
const { orphans, staging } = await findLiveMirrorOrphans(agentDir, entries);

if (drift.length) {
  for (const item of drift) console.error(`${item.destination}: ${item.reason}`);
  console.error(`live mirror check: ${drift.length} of ${entries.length} first-party files differ`);
  process.exitCode = 1;
} else if (unmanaged.length) {
  for (const name of unmanaged) console.error(`extensions/${name}: loaded live but not in the package manifest`);
  console.error(`live mirror check: ${entries.length} declared files match, but ${unmanaged.length} unmanaged extension(s) will auto-load`);
  console.error("Remove them from the live directory, or add them to DOCUMENTED_LOCAL_ONLY with a reason.");
  process.exitCode = 1;
} else if (orphans.length || staging.length) {
  for (const rel of orphans) console.error(`${rel}: in the live package dir but not declared by the manifest (orphan)`);
  for (const rel of staging) console.error(`${rel}: staging leftover from an interrupted apply`);
  console.error(`live mirror check: ${entries.length} declared files match, but ${orphans.length} orphan(s) + ${staging.length} staging leftover(s) remain under the package dir`);
  console.error("Delete them with: npm run mirror:apply -- --prune (human-gated).");
  process.exitCode = 1;
} else {
  console.log(`live mirror check: ${entries.length} first-party files match; no unmanaged extensions or orphans`);
}
