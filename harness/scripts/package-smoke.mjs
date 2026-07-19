#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { dirname, relative } from "node:path";
import { tmpdir } from "node:os";
import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const extensions = manifest.pi?.extensions ?? [];

for (const required of [
  "harness/extensions/plan-weaver.ts",
  "harness/extensions/did-you-mean.ts",
  "harness/vendor/pi-subagent/index.ts",
]) {
  assert(extensions.includes(required), `pi.extensions is missing ${required}`);
}
assert(!extensions.includes("harness/extensions/chaos.ts"), "chaos must not be enabled in the release manifest");

const work = await mkdtemp(resolve(tmpdir(), "pi-munchkin-pack-"));
const cache = resolve(work, "npm-cache");
const packDir = resolve(work, "pack");
const project = resolve(work, "consumer");
const agentDir = resolve(work, "home", ".pi", "agent");
await mkdir(packDir, { recursive: true });
await mkdir(project, { recursive: true });
await mkdir(agentDir, { recursive: true });

let packed;
try {
  packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: cache },
  }));
  assert.equal(packed.length, 1, "npm pack must describe exactly one package");
  const files = new Set(packed[0].files.map(({ path }) => path));

  for (const expected of ["README.md", "LICENSE", "NOTICE.md", "harness/APPEND_SYSTEM.md", ...extensions]) {
    assert(files.has(expected), `packed artifact is missing ${expected}`);
  }
  for (const forbidden of ["harness/extensions/chaos.ts", "harness/lib/chaos-policy.ts", "optimizer/munchkin.py"]) {
    assert(!files.has(forbidden), `packed artifact unexpectedly contains ${forbidden}`);
  }

  // Follow every relative import from each manifest entry so a packed extension
  // cannot load from the checkout while a transitive source file is absent.
  const pending = extensions.map((entry) => resolve(root, entry));
  const visited = new Set();
  while (pending.length) {
    const sourcePath = pending.pop();
    if (visited.has(sourcePath)) continue;
    visited.add(sourcePath);
    const packagePath = relative(root, sourcePath).split("\\").join("/");
    assert(files.has(packagePath), `packed artifact is missing imported source ${packagePath}`);
    const source = await readFile(sourcePath, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*)["'](\.{1,2}\/[^"']+)["']/g)) {
      let imported = resolve(dirname(sourcePath), match[1]);
      if (!existsSync(imported) && imported.endsWith(".js") && existsSync(`${imported.slice(0, -3)}.ts`)) {
        imported = `${imported.slice(0, -3)}.ts`;
      }
      if (existsSync(imported)) pending.push(imported);
    }
  }

  // Install the produced tarball into an isolated consumer and temporary HOME.
  // This catches peer/dependency and package-layout failures that source-tree
  // imports or `npm pack --dry-run` cannot detect.
  await writeFile(resolve(project, "package.json"), JSON.stringify({ private: true }, null, 2));
  const tarball = resolve(packDir, packed[0].filename);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball], {
    cwd: project,
    stdio: "pipe",
    env: { ...process.env, HOME: resolve(work, "home"), npm_config_cache: cache },
  });
  const installedRoot = resolve(project, "node_modules", manifest.name);
  const installedManifest = JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8"));
  assert.deepEqual(installedManifest.pi?.extensions, extensions, "installed manifest extension list drifted");
  const loaded = await discoverAndLoadExtensions(
    extensions.map((entry) => resolve(installedRoot, entry)),
    installedRoot,
    agentDir,
  );
  assert.deepEqual(loaded.errors, [], `installed extension load errors:\n${loaded.errors.map(({ path, error }) => `${path}: ${error}`).join("\n")}`);
  assert.equal(loaded.extensions.length, extensions.length, "pi must load every installed manifest extension");

  console.log(`package smoke: ${files.size} files; installed tarball loads ${extensions.length} extension entry points`);
} finally {
  await rm(work, { recursive: true, force: true });
}
