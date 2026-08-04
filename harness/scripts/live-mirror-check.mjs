#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { buildLiveMirrorManifest, compareLiveMirror } from "../lib/live-mirror.ts";

const root = resolve(import.meta.dirname, "../..");
const agentDir = resolve(process.argv[2] ?? process.env.PI_CODING_AGENT_DIR ?? resolve(homedir(), ".pi", "agent"));
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const entries = await buildLiveMirrorManifest(root, manifest);
const drift = await compareLiveMirror(root, agentDir, entries);
if (drift.length) {
  for (const item of drift) console.error(`${item.destination}: ${item.reason}`);
  console.error(`live mirror check: ${drift.length} of ${entries.length} first-party files differ`);
  process.exitCode = 1;
} else {
  console.log(`live mirror check: ${entries.length} first-party files match; local-only additions ignored`);
}
