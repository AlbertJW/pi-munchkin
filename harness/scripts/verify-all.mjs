#!/usr/bin/env node
// verify-all — run the five verification stages concurrently.
//
// The stages are genuinely independent: each writes only to its own mkdtemp
// directory (package-smoke packs into its own --pack-destination; the optimizer
// check runs real_gate.sh --dry, which touches nothing). Serially they cost
// ~40s, dominated by the two slowest; concurrently they cost about as much as
// the slowest one alone.
//
// Output is captured per stage and printed grouped, in a fixed order — never
// interleaved, because a failure you cannot attribute to a stage is worse than
// a slow suite. Every stage runs to completion even after one fails, so a
// single run reports every problem instead of only the first.
//
//   npm run verify              concurrent (default)
//   npm run verify -- --serial  one at a time, original ordering

import { spawn } from "node:child_process";

const STAGES = [
  // `health` re-runs a full tsc that `typecheck` already covers; skipping the
  // duplicate is the single largest saving here and changes no coverage.
  { name: "test", command: "npm", args: ["run", "-s", "test"] },
  { name: "typecheck", command: "npm", args: ["run", "-s", "typecheck"] },
  { name: "health", command: "npm", args: ["run", "-s", "health"], env: { SKIP_TSC: "1" } },
  { name: "pack:smoke", command: "npm", args: ["run", "-s", "pack:smoke"] },
  { name: "verify:optimizer", command: "npm", args: ["run", "-s", "verify:optimizer"] },
];

function run(stage) {
  const startedAt = process.hrtime.bigint();
  return new Promise((resolve) => {
    const child = spawn(stage.command, stage.args, {
      env: { ...process.env, ...(stage.env ?? {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", (error) => {
      resolve({ ...stage, code: 1, output: `${output}\nfailed to spawn: ${error.message}`, ms: 0 });
    });
    child.on("close", (code) => {
      resolve({ ...stage, code: code ?? 1, output, ms: Number((process.hrtime.bigint() - startedAt) / 1_000_000n) });
    });
  });
}

const serial = process.argv.includes("--serial");
const started = Date.now();
let results;
if (serial) {
  results = [];
  for (const stage of STAGES) results.push(await run(stage));
} else {
  results = await Promise.all(STAGES.map(run));
}

for (const result of results) {
  console.log(`\n${"=".repeat(70)}\n== ${result.name}  (${result.code === 0 ? "PASS" : "FAIL"}, ${(result.ms / 1000).toFixed(1)}s)\n${"=".repeat(70)}`);
  process.stdout.write(result.output.endsWith("\n") || result.output === "" ? result.output : `${result.output}\n`);
}

const failed = results.filter((result) => result.code !== 0);
const wall = ((Date.now() - started) / 1000).toFixed(1);
if (failed.length) {
  console.error(`\nverify: FAILED in ${wall}s — ${failed.map((result) => result.name).join(", ")}`);
  process.exit(1);
}
console.log(`\nverify: all ${results.length} stages passed in ${wall}s${serial ? " (serial)" : ""}`);
