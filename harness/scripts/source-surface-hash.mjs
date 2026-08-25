#!/usr/bin/env node

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { hashSurface, walkPromptFiles, walkRelativeImports } from "../lib/surface-walk.ts";

const root = resolve(process.argv[2] ?? resolve(import.meta.dirname, "../.."));
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const entries = (manifest.pi?.extensions ?? []).map((entry) => resolve(root, entry));
const files = await walkRelativeImports(entries);
for (const role of await readdir(resolve(root, "harness", "agents"))) {
  if (role.endsWith(".md")) files.add(resolve(root, "harness", "agents", role));
}
// Surface outside the import graph: every skill file (text AND scripts) + the
// governor append (excluded before 2026-08-11 — hashes across that date do not pool).
for (const dir of manifest.pi?.skills ?? []) {
  for (const file of await walkPromptFiles(resolve(root, dir))) files.add(file);
}
// Same roster the loaded surface hashes (surface-walk.discoverEntryPoints). None of
// the last four exist in this repo today; they are covered so that adding one later
// cannot slip a model-visible prompt change past the hash the way AGENTS.md did on
// the live side.
// First-match-wins per group, mirroring resource-loader.js's loadContextFileFromDir.
// Listing the casings independently double-counts the same file on a case-insensitive
// filesystem and diverges from a case-sensitive one.
for (const group of [["APPEND_SYSTEM.md"], ["SYSTEM.md"], ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"]]) {
  const present = group.map((name) => resolve(root, "harness", name)).find((candidate) => existsSync(candidate));
  if (present) files.add(present);
}
console.log(await hashSurface(root, { orderedEntryPoints: entries, files }));
