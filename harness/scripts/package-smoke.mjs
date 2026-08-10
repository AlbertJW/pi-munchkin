#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink } from "node:fs/promises";
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
  // c49/c50 sit right after loop-breaker: their turn_end handlers read state
  // loop-breaker publishes on the globalThis bus in ITS turn_end, and handler
  // order follows this list.
  "harness/extensions/tool-call-rescue.ts",
  "harness/extensions/verify-gate.ts",
  "harness/extensions/plan-runner.ts",
  "harness/extensions/reflect.ts",
  "harness/extensions/drift-scanner.ts",
  "harness/extensions/git-guard.ts",
  "harness/extensions/context-inlet-guard.ts",
  "harness/extensions/context-watcher.ts",
  "harness/extensions/span-tools.ts",
  "harness/extensions/compact-tool.ts",
  "harness/extensions/active-tool-prompts.ts",
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
  // session-blackboard's context hook must run BEFORE context-surface so
  // receipts measure the post-lens view (same ordering rule as context-dedup).
  "harness/extensions/session-blackboard.ts",
  "harness/extensions/context-surface.ts",
  "harness/extensions/bash-output-guard.ts",
  "harness/extensions/payload-audit.ts",
  // Must register after compact_context and the vendor subagent. It makes its
  // defer/preserve decision at session_start against the complete registry.
  "harness/extensions/tool-activation.ts",
  // Reads the activation manager's redacted state for /munchkin-doctor.
  "harness/extensions/runtime-truth.ts",
  // Last intervention producer wins nothing directly in enforce mode: the
  // arbiter is loaded after every producer and decides once at turn_end.
  "harness/extensions/control-arbiter.ts",
  // Shadow observer sees finalized middleware, control decisions, and legacy
  // turn snapshots before disagreement recording.
  "harness/extensions/run-kernel.ts",
  // Private state projection consumes finalized kernel snapshots and must
  // checkpoint before the last-loaded telemetry durability boundary.
  "harness/extensions/run-capsule.ts",
  // Durability boundary is registered last so settled/shutdown rows from every
  // first-party extension are queued before the final async flush.
  "harness/extensions/telemetry-flush.ts",
];
assert.deepEqual(extensions, expectedExtensions, "pi.extensions must expose the complete ordered production surface");
assert(!extensions.includes("harness/extensions/chaos.ts"), "chaos must not be enabled in the release manifest");
assert.deepEqual(skills, ["skills/deep-research", "skills/lavish-review"], "pi.skills must expose exactly the shipped skill set");

const work = await mkdtemp(resolve(tmpdir(), "pi-munchkin-pack-"));
const packDir = resolve(work, "pack");
const extractDir = resolve(work, "extract");
const agentDir = resolve(work, "home", ".pi", "agent");
const processEnv = {
  PATH: process.env.PATH,
  HOME: resolve(work, "home"),
  TMPDIR: work,
};
for (const key of ["LANG", "LC_ALL", "SYSTEMROOT", "WINDIR"]) {
  if (process.env[key]) processEnv[key] = process.env[key];
}
await mkdir(packDir, { recursive: true });
await mkdir(extractDir, { recursive: true });
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

  for (const expected of ["README.md", "LICENSE", "NOTICE.md", "harness/APPEND_SYSTEM.md", "harness/lib/role-routing.ts", "examples/run-model.example.sh", "skills/deep-research/SKILL.md", ...extensions]) {
    assert(files.has(expected), `packed artifact is missing ${expected}`);
  }
  for (const forbidden of ["harness/extensions/chaos.ts", "harness/lib/chaos-policy.ts", "harness/lib/tag-words.ts", "optimizer/munchkin.py"]) {
    assert(!files.has(forbidden), `packed artifact unexpectedly contains ${forbidden}`);
  }

  // Follow every relative import from each manifest entry so a packed extension
  // cannot load from the checkout while a transitive source file is absent.
  const visited = await walkRelativeImports(extensions.map((entry) => resolve(root, entry)));
  for (const sourcePath of visited) {
    const packagePath = relative(root, sourcePath).split("\\").join("/");
    assert(files.has(packagePath), `packed artifact is missing imported source ${packagePath}`);
  }

  // Extract locally and resolve peers through the checkout's already-installed
  // development dependencies. This verifies the actual tarball without any
  // registry access; the networked isolated-consumer matrix is a separate job.
  const tarball = resolve(packDir, packed[0].filename);
  execFileSync("tar", ["-xzf", tarball, "-C", extractDir], {
    cwd: root,
    stdio: "pipe",
    env: processEnv,
  });
  const installedRoot = resolve(extractDir, "package");
  await symlink(resolve(root, "node_modules"), resolve(installedRoot, "node_modules"), "dir");
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
  assert.deepEqual(loadedSkills.skills.map(({ name }) => name), ["deep-research", "lavish-review"], "installed tarball must discover the shipped skill set");

  console.log(`package smoke: ${files.size} files; installed tarball loads ${extensions.length} extension entry points and ${loadedSkills.skills.length} skill`);
} finally {
  await rm(work, { recursive: true, force: true });
}
