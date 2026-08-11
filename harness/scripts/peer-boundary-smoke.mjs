#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const work = await mkdtemp(resolve(tmpdir(), "pi-munchkin-peer-boundary-"));
const packDir = resolve(work, "pack");
const home = resolve(work, "home");
const env = { ...process.env, HOME: home, TMPDIR: work, npm_config_cache: resolve(work, "npm-cache") };

async function installCase(label, version, shouldPass, tarball) {
  const consumer = resolve(work, label);
  const packages = resolve(work, `${label}-packages`);
  await mkdir(consumer, { recursive: true });
  await mkdir(packages, { recursive: true });
  await writeFile(resolve(consumer, "package.json"), JSON.stringify({ private: true }, null, 2));
  const localPackages = [];
  for (const [directory, name, packageVersion] of [
    ["coding-agent", "@earendil-works/pi-coding-agent", version],
    ["pi-ai", "@earendil-works/pi-ai", version],
    ["typebox", "typebox", "1.1.38"],
  ]) {
    const packageDir = resolve(packages, directory);
    await mkdir(packageDir, { recursive: true });
    await writeFile(resolve(packageDir, "package.json"), JSON.stringify({ name, version: packageVersion }, null, 2));
    localPackages.push(packageDir);
  }
  const result = spawnSync("npm", [
    "install", "--strict-peer-deps", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock",
    tarball, ...localPackages,
  ], { cwd: consumer, stdio: "pipe", env });
  assert.equal(result.status === 0, shouldPass, `${label}: expected install ${shouldPass ? "success" : "failure"}`);
  console.log(`${label}: ${shouldPass ? "accepted" : "rejected"} as expected`);
}

try {
  await mkdir(packDir, { recursive: true });
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root, encoding: "utf8", env,
  }));
  const tarball = resolve(packDir, packed[0].filename);
  await installCase("below-lower", "0.80.5", false, tarball);
  await installCase("at-lower", "0.80.6", true, tarball);
  await installCase("inside-upper-minor", "0.84.99", true, tarball);
  await installCase("at-upper", "0.85.0", false, tarball);
} finally {
  await rm(work, { recursive: true, force: true });
}
