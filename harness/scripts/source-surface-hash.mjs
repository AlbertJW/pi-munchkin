#!/usr/bin/env node

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
files.add(resolve(root, "harness", "APPEND_SYSTEM.md"));
console.log(await hashSurface(root, files));
