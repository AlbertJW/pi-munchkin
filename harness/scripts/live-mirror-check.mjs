#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { buildLiveMirrorManifest, compareLiveMirror } from "../lib/live-mirror.ts";

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
const entries = await buildLiveMirrorManifest(root, manifest);
const drift = await compareLiveMirror(root, agentDir, entries);
const managed = new Set(entries.map((entry) => entry.destination));
let unmanaged = [];
try {
  unmanaged = (await readdir(resolve(agentDir, "extensions")))
    .filter((name) => name.endsWith(".ts"))
    .filter((name) => !managed.has(`extensions/${name}`) && !DOCUMENTED_LOCAL_ONLY.has(name));
} catch { /* no live extensions dir — the drift report below already says so */ }

if (drift.length) {
  for (const item of drift) console.error(`${item.destination}: ${item.reason}`);
  console.error(`live mirror check: ${drift.length} of ${entries.length} first-party files differ`);
  process.exitCode = 1;
} else if (unmanaged.length) {
  for (const name of unmanaged) console.error(`extensions/${name}: loaded live but not in the package manifest`);
  console.error(`live mirror check: ${entries.length} declared files match, but ${unmanaged.length} unmanaged extension(s) will auto-load`);
  console.error("Remove them from the live directory, or add them to DOCUMENTED_LOCAL_ONLY with a reason.");
  process.exitCode = 1;
} else {
  console.log(`live mirror check: ${entries.length} first-party files match; no unmanaged extensions`);
}
