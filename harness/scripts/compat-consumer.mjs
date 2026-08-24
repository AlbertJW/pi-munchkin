#!/usr/bin/env node

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const minor = process.argv[2];
if (!/^0\.(?:80|81|82|83|84)$/.test(minor ?? "")) {
  console.error("usage: compat-consumer.mjs 0.80|0.81|0.82|0.83|0.84");
  process.exit(2);
}

const nextMinor = `0.${Number(minor.split(".")[1]) + 1}.0`;
const lower = minor === "0.80" ? "0.80.6" : `${minor}.0`;
const piRange = `>=${lower} <${nextMinor}`;
const work = await mkdtemp(resolve(tmpdir(), `pi-munchkin-compat-${minor.replace(".", "-")}-`));
const packDir = resolve(work, "pack");
const consumer = resolve(work, "consumer");
const home = resolve(work, "home");
const agentDir = resolve(home, ".pi", "agent");
const npmEnv = { ...process.env, HOME: home, TMPDIR: work, npm_config_cache: resolve(work, "npm-cache") };
const runtimeEnv = { ...npmEnv };
for (const key of Object.keys(runtimeEnv)) {
  if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete runtimeEnv[key];
}
Object.assign(runtimeEnv, {
  ACTIVE_TOOL_PROMPTS: "active",
  VERIFY_EXECUTION_ORDER: "execution",
  TELEMETRY: "off",
});

try {
  await mkdir(packDir, { recursive: true });
  await mkdir(consumer, { recursive: true });
  await mkdir(agentDir, { recursive: true });
  const packed = JSON.parse(execFileSync("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", packDir], {
    cwd: root,
    encoding: "utf8",
    env: npmEnv,
  }));
  assert.equal(packed.length, 1);
  const tarball = resolve(packDir, packed[0].filename);
  await writeFile(resolve(consumer, "package.json"), JSON.stringify({ private: true, type: "module" }, null, 2));
  execFileSync("npm", [
    "install", "--strict-peer-deps", "--ignore-scripts", "--no-audit", "--no-fund", "--no-package-lock",
    tarball,
    `@earendil-works/pi-coding-agent@${piRange}`,
    `@earendil-works/pi-ai@${piRange}`,
    `@earendil-works/pi-agent-core@${piRange}`,
    `@earendil-works/pi-tui@${piRange}`,
    "typescript@5.9.3", "@types/node@25.2.3",
  ], { cwd: consumer, stdio: "pipe", env: npmEnv });

  const installedRoot = resolve(consumer, "node_modules", "pi-munchkin");
  const manifest = JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8"));
  const tsconfig = {
    compilerOptions: {
      target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
      noEmit: true, skipLibCheck: true, esModuleInterop: true, allowImportingTsExtensions: true,
      types: ["node"],
    },
    include: [
      "node_modules/pi-munchkin/harness/extensions/**/*.ts",
      "node_modules/pi-munchkin/harness/lib/**/*.ts",
      "node_modules/pi-munchkin/harness/vendor/**/*.ts",
    ],
    exclude: [],
  };
  await writeFile(resolve(consumer, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  execFileSync(resolve(consumer, "node_modules", ".bin", "tsc"), ["-p", "tsconfig.json", "--noEmit"], {
    cwd: consumer, stdio: "pipe", env: runtimeEnv,
  });

  const runner = `
    import assert from "node:assert/strict";
    import { readFile } from "node:fs/promises";
    import { resolve } from "node:path";
    import { discoverAndLoadExtensions, loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
    const installedRoot = resolve("node_modules/pi-munchkin");
    const manifest = JSON.parse(await readFile(resolve(installedRoot, "package.json"), "utf8"));
    const extensions = manifest.pi.extensions;
    const loaded = await discoverAndLoadExtensions(extensions.map((entry) => resolve(installedRoot, entry)), installedRoot, ${JSON.stringify(agentDir)});
    assert.deepEqual(loaded.errors, [], "every extension must load");
    assert.equal(loaded.extensions.length, extensions.length, "extension count must match manifest");
    const definitions = new Map(loaded.extensions.flatMap((extension) =>
      [...extension.tools.values()].map(({ definition }) => [definition.name, definition])));
    for (const name of ["compact_context", "search_spans", "read_span", "plan_write", "plan_update", "verify_project", "subagent"]) {
      const definition = definitions.get(name);
      assert(definition, name + " must be present in the complete registry");
      assert(Array.isArray(definition.promptGuidelines) && definition.promptGuidelines.length > 0,
        name + " must carry active-only promptGuidelines");
    }
    const skills = loadSkillsFromDir({ dir: resolve(installedRoot, "skills"), source: "package" });
    assert.deepEqual(skills.diagnostics, [], "skills must have no diagnostics");
    assert.deepEqual(skills.skills.map(({ name }) => name), ["deep-research", "lavish-review"]);
    console.log(JSON.stringify({ extensions: loaded.extensions.length, skills: skills.skills.length }));
  `;
  await writeFile(resolve(consumer, "load-smoke.mjs"), runner);
  const loadResult = JSON.parse(execFileSync(process.execPath, ["load-smoke.mjs"], {
    cwd: consumer, encoding: "utf8", env: runtimeEnv,
  }));
  console.log(`Pi ${minor}: typecheck green; ${loadResult.extensions} extensions and ${loadResult.skills} skills loaded`);
} finally {
  await rm(work, { recursive: true, force: true });
}
