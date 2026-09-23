#!/usr/bin/env node
/*
 * Deterministic fault-injection screen for Phase 3A cases 3-11. Each frozen
 * test is run alone; receipts include test/file digests and summary counts,
 * never test stdout, prompts, responses, or thrown error text.
 */
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const DEFAULT_MANIFEST = resolve(ROOT, "harness/tests/fixtures/context-admission-safety-recovery-v2.json");
const sha = (value) => createHash("sha256").update(value).digest("hex");

function parseArgs() {
  const result = {};
  for (let index = 2; index < process.argv.length; index += 1) {
    const arg = process.argv[index];
    if (arg === "--dry" || arg === "--run") result[arg.slice(2)] = true;
    else if (arg.startsWith("--") && process.argv[index + 1]) result[arg.slice(2)] = process.argv[++index];
  }
  return result;
}

function validate(manifest) {
  if (manifest?.schema !== "pi.context-admission-safety-recovery-screen/v2" || manifest.required_case_count !== 11) throw new Error("invalid Phase 3A safety/recovery manifest");
  if (manifest.model !== "local-llamacpp/occamy" || manifest.served_model !== "occamy") throw new Error("unexpected Phase 3A model binding");
  const cases = manifest.deterministic_cases;
  if (!Array.isArray(cases) || cases.length !== 9 || cases.some((item, index) => item.case !== index + 3 || !Array.isArray(item.tests) || item.tests.length === 0)) throw new Error("deterministic cases 3-11 must be complete and ordered");
  for (const item of cases) for (const [file, name] of item.tests) {
    if (typeof file !== "string" || !file.startsWith("harness/tests/") || !file.endsWith(".test.ts") || typeof name !== "string" || !name.length) throw new Error("invalid deterministic test binding");
  }
}

function runTest(file, name, env, timeoutMs = 120_000) {
  return new Promise((resolveResult) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const child = spawn(process.execPath, ["--experimental-strip-types", "--test", `--test-name-pattern=^${escaped}$`, file], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("error", () => { output += "spawn-error"; });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      const count = (label) => Number(output.match(new RegExp(`(?:ℹ\\s+${label}|# ${label})\\s+(\\d+)`))?.[1] ?? 0);
      const summary = { tests: count("tests"), passed: count("pass"), failed: count("fail"), skipped: count("skipped") };
      resolveResult({ ok: code === 0 && !timedOut && summary.tests === 1 && summary.passed === 1 && summary.failed === 0 && summary.skipped === 0, exit_code: code ?? -1, signal: signal ?? null, timed_out: timedOut, output_sha256: sha(output), output_bytes: Buffer.byteLength(output), ...summary });
    });
  });
}

const args = parseArgs();
const manifestPath = resolve(typeof args.manifest === "string" ? args.manifest : DEFAULT_MANIFEST);
const manifestBytes = await readFile(manifestPath);
const manifest = JSON.parse(manifestBytes.toString("utf8"));
validate(manifest);
const testSources = [...new Set(manifest.deterministic_cases.flatMap((item) => item.tests.map(([file]) => file)))].sort();
const productionSources = [
  "harness/extensions/context-admission.ts",
  "harness/extensions/run-capsule.ts",
  "harness/extensions/telemetry-flush.ts",
  "harness/lib/context-accounting.ts",
  "harness/lib/context-profile.ts",
  "harness/lib/telemetry-catalog.ts",
];
const sourceHashes = {};
for (const file of [...new Set([...productionSources, ...testSources])].sort()) sourceHashes[file] = sha(await readFile(resolve(ROOT, file)));
const scriptSha = sha(await readFile(fileURLToPath(import.meta.url)));
const binding = { manifest_sha256: sha(manifestBytes), runner_sha256: scriptSha, source_hashes: sourceHashes, model: manifest.model, served_model: manifest.served_model, artifact: manifest.artifact };
if (args.dry) {
  console.log(JSON.stringify({ schema: "pi.context-admission-safety-recovery-preparation/v2", ...binding, cases: manifest.deterministic_cases.map(({ case: caseNumber, tests }) => ({ case: caseNumber, test_count: tests.length })), inference: false }, null, 2));
  process.exit(0);
}
if (!args.run) {
  console.error("safety/recovery screen requires --dry or --run");
  process.exit(3);
}

const work = await mkdtemp(resolve(tmpdir(), "pi-context-admission-deterministic-"));
await chmod(work, 0o700);
const home = resolve(work, "home");
const telemetry = resolve(work, "telemetry/events.jsonl");
await mkdir(resolve(home, ".config"), { recursive: true, mode: 0o700 });
await mkdir(dirname(telemetry), { recursive: true, mode: 0o700 });
const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: resolve(home, ".config"), TELEMETRY: "on", TELEMETRY_FILE: telemetry, TELEMETRY_SOURCE: "test", TELEMETRY_STRICT: "1" };
for (const key of Object.keys(env)) if (/(?:API_KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL)/i.test(key)) delete env[key];
for (const key of ["TELEMETRY_FD", "TELEMETRY_HMAC_FD", "NODE_OPTIONS", "BASH_ENV", "ENV", "ZDOTDIR"]) delete env[key];
try {
  const results = [];
  for (const item of manifest.deterministic_cases) {
    const tests = [];
    for (const [file, name] of item.tests) {
      const bytes = await readFile(resolve(ROOT, file));
      tests.push({ file, test_name: name, test_source_sha256: sha(bytes), result: await runTest(file, name, env) });
    }
    results.push({ case: item.case, status: tests.every((test) => test.result.ok) ? "PASS" : "FAIL", tests });
  }
  const result = { schema: "pi.context-admission-safety-recovery-deterministic-result/v2", binding, cases: results, passed: results.filter((item) => item.status === "PASS").length, total: results.length, complete: results.length === 9 && results.every((item) => item.status === "PASS"), raw_output_retained: false };
  const artifactRoot = resolve(typeof args["artifact-root"] === "string" ? args["artifact-root"] : resolve(process.env.HOME ?? tmpdir(), ".pi", "context-admission-evals"));
  await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
  await chmod(artifactRoot, 0o700);
  const artifactPath = resolve(artifactRoot, `${manifest.revision}-${Date.now()}.json`);
  await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  await chmod(artifactPath, 0o600);
  console.log(JSON.stringify({ ...result, artifact_path: artifactPath }, null, 2));
  if (!result.complete) process.exitCode = 1;
} finally {
  await rm(work, { recursive: true, force: true });
}
