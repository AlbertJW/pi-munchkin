#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { relative } from "node:path";
import { tmpdir } from "node:os";
import { discoverAndLoadExtensions, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
import { walkRelativeImports } from "../lib/surface-walk.ts";

const root = resolve(import.meta.dirname, "../..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const extensions = manifest.pi?.extensions ?? [];
const skills = manifest.pi?.skills ?? [];

const expectedExtensions = [
  "harness/extensions/hashline.ts",
  "harness/extensions/loop-breaker.ts",
  "harness/extensions/verify-gate.ts",
  "harness/extensions/plan-runner.ts",
  "harness/extensions/reflect.ts",
  "harness/extensions/drift-scanner.ts",
  "harness/extensions/git-guard.ts",
  "harness/extensions/context-inlet-guard.ts",
  "harness/extensions/context-watcher.ts",
  "harness/extensions/span-tools.ts",
  "harness/extensions/compact-tool.ts",
  "harness/extensions/micro-gate.ts",
  "harness/extensions/ketch.ts",
  "harness/extensions/did-you-mean.ts",
  "harness/extensions/teach-hints.ts",
  "harness/extensions/surface-receipt.ts",
  "harness/vendor/pi-subagent/index.ts",
  // Must observe after every prompt-contributing extension so its receipt binds
  // the final provider-visible system prompt, not an intermediate prompt.
  "harness/extensions/context-brief.ts",
  "harness/extensions/context-dedup.ts",
  "harness/extensions/context-surface.ts",
];
assert.deepEqual(extensions, expectedExtensions, "pi.extensions must expose the complete ordered production surface");
assert(!extensions.includes("harness/extensions/chaos.ts"), "chaos must not be enabled in the release manifest");
assert.deepEqual(skills, ["skills/deep-research"], "pi.skills must expose the bounded deep-research workflow");

const work = await mkdtemp(resolve(tmpdir(), "pi-munchkin-pack-"));
const cache = resolve(work, "npm-cache");
const packDir = resolve(work, "pack");
const project = resolve(work, "consumer");
const agentDir = resolve(work, "home", ".pi", "agent");
const processEnv = {
  PATH: process.env.PATH,
  HOME: resolve(work, "home"),
  TMPDIR: work,
  npm_config_cache: cache,
};
for (const key of ["LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"]) {
  if (process.env[key]) processEnv[key] = process.env[key];
}
await mkdir(packDir, { recursive: true });
await mkdir(project, { recursive: true });
await mkdir(agentDir, { recursive: true });

let packed;
try {
  packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8",
    env: processEnv,
  }));
  assert.equal(packed.length, 1, "npm pack must describe exactly one package");
  const files = new Set(packed[0].files.map(({ path }) => path));

  for (const expected of ["README.md", "LICENSE", "NOTICE.md", "harness/APPEND_SYSTEM.md", "skills/deep-research/SKILL.md", ...extensions]) {
    assert(files.has(expected), `packed artifact is missing ${expected}`);
  }
  for (const forbidden of ["harness/extensions/chaos.ts", "harness/lib/chaos-policy.ts", "optimizer/munchkin.py"]) {
    assert(!files.has(forbidden), `packed artifact unexpectedly contains ${forbidden}`);
  }

  // Follow every relative import from each manifest entry so a packed extension
  // cannot load from the checkout while a transitive source file is absent.
  const visited = await walkRelativeImports(extensions.map((entry) => resolve(root, entry)));
  for (const sourcePath of visited) {
    const packagePath = relative(root, sourcePath).split("\\").join("/");
    assert(files.has(packagePath), `packed artifact is missing imported source ${packagePath}`);
  }

  // Install the produced tarball into an isolated consumer and temporary HOME.
  // This catches peer/dependency and package-layout failures that source-tree
  // imports or `npm pack --dry-run` cannot detect.
  await writeFile(resolve(project, "package.json"), JSON.stringify({ private: true }, null, 2));
  const tarball = resolve(packDir, packed[0].filename);
  execFileSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock", tarball], {
    cwd: project,
    stdio: "pipe",
    env: processEnv,
  });
  const installedRoot = resolve(project, "node_modules", manifest.name);
  const installedManifest = JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8"));
  assert.deepEqual(installedManifest.pi?.extensions, extensions, "installed manifest extension list drifted");
  assert.deepEqual(installedManifest.pi?.skills, skills, "installed manifest skill list drifted");
  const loaded = await discoverAndLoadExtensions(
    extensions.map((entry) => resolve(installedRoot, entry)),
    installedRoot,
    agentDir,
  );
  assert.deepEqual(loaded.errors, [], `installed extension load errors:\n${loaded.errors.map(({ path, error }) => `${path}: ${error}`).join("\n")}`);
  assert.equal(loaded.extensions.length, extensions.length, "pi must load every installed manifest extension");
  const loadedSkills = loadSkillsFromDir({ dir: resolve(installedRoot, "skills"), source: "package" });
  assert.deepEqual(loadedSkills.diagnostics, [], `installed skill diagnostics: ${JSON.stringify(loadedSkills.diagnostics)}`);
  assert.deepEqual(loadedSkills.skills.map(({ name }) => name), ["deep-research"], "installed tarball must discover deep-research");

  console.log(`package smoke: ${files.size} files; installed tarball loads ${extensions.length} extension entry points and ${loadedSkills.skills.length} skill`);
} finally {
  await rm(work, { recursive: true, force: true });
}
