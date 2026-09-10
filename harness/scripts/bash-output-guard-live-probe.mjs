#!/usr/bin/env node
/*
 * Matched control/treatment Qwen screen for the dark bash-output guard.  It
 * keeps only event counts, hashes, and byte totals; Pi JSON output is parsed
 * in memory and discarded because it may contain shell output.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile } from "../lib/private-artifact.ts";
import { localProxyTarget } from "../lib/local-proxy-route.ts";
import { summarizePiJsonScreen } from "../lib/pi-json-screen.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_MANIFEST = resolve(ROOT, "tests/fixtures/bash-output-guard-qwen-v1.json");
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1";
const GUARD = resolve(ROOT, "extensions/bash-output-guard.ts");
const TELEMETRY_FLUSH = resolve(ROOT, "extensions/telemetry-flush.ts");
const JSON_SUMMARY = resolve(ROOT, "lib/pi-json-screen.ts");
const PROXY_ROUTE = resolve(ROOT, "lib/local-proxy-route.ts");

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a, b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}
function endpointHash(value) {
  try { const url = new URL(value); return sha(`${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === "https:" ? "443" : "80")}${url.pathname.replace(/\/+$/, "") || "/"}`); }
  catch { return sha("invalid"); }
}
function parseArgs() {
  const out = {};
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (["--dry", "--prepare", "--run"].includes(item)) out[item.slice(2)] = true;
    else if (item.startsWith("--") && process.argv[index + 1]) out[item.slice(2)] = process.argv[++index];
  }
  return out;
}
function validateManifest(value) {
  if (!value || value.schema !== "pi.bash-output-guard-live-screen/v1" || typeof value.revision !== "string") throw new Error("invalid bash-output screen manifest");
  if (typeof value.model !== "string" || typeof value.served_model !== "string" || !Number.isSafeInteger(value.declared_context_window) || value.declared_context_window < 1024) throw new Error("invalid model binding");
  if (!Number.isSafeInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 1024 || !Number.isSafeInteger(value.max_bash_output_chars) || value.max_bash_output_chars < 128 || !Number.isSafeInteger(value.max_provider_requests_per_case) || value.max_provider_requests_per_case < 2 || value.max_provider_requests_per_case > 8) throw new Error("invalid screen limits");
  if (!Array.isArray(value.cases) || value.cases.length !== 4) throw new Error("screen must declare four matched cases");
  const expected = ["control-ordinary", "treatment-noisy", "treatment-ordinary", "control-noisy"];
  for (let index = 0; index < expected.length; index += 1) {
    const item = value.cases[index];
    if (!item || item.id !== expected[index] || !["on", "off"].includes(item.guard) || !["ordinary", "noisy"].includes(item.kind) || typeof item.expected_final !== "string") throw new Error("invalid matched case");
  }
}
function modelsConfig(manifest, endpoint) {
  return { providers: { "local-llamacpp": { baseUrl: endpoint, api: "openai-completions", apiKey: "none", compat: { supportsDeveloperRole: false, supportsReasoningEffort: false, supportsUsageInStreaming: false, maxTokensField: "max_tokens", thinkingFormat: "qwen-chat-template", supportsStrictMode: false }, models: [{ id: manifest.served_model, name: manifest.served_model, reasoning: true, input: ["text"], contextWindow: manifest.declared_context_window, maxTokens: manifest.max_tokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } };
}
function run(command, args, options) {
  return new Promise((resolveResult) => {
    const child = spawn(command, args, { cwd: options.cwd, env: options.env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = ""; let stderr = ""; let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill("SIGTERM"); }, options.timeout_ms);
    child.stdout.on("data", (data) => { stdout += data; });
    child.stderr.on("data", (data) => { stderr += data; });
    child.on("error", (error) => { stderr += String(error); });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolveResult({ exit_code: code ?? -1, signal: signal ?? null, timed_out: timedOut, stdout_sha256: sha(stdout), stderr_sha256: sha(stderr), stdout_bytes: Buffer.byteLength(stdout), stderr_bytes: Buffer.byteLength(stderr), pi: summarizePiJsonScreen(stdout) });
    });
  });
}
async function privateWrite(root, name, value) {
  const directory = resolve(root); const path = resolve(directory, name);
  if (!path.startsWith(`${directory}/`)) throw new Error("artifact path escapes root");
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, directoryMode: 0o700 });
  return path;
}
async function makeProxy(target, maxRequests) {
  let forwarded = 0; let overLimit = false;
  const server = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (forwarded >= maxRequests) { overLimit = true; response.statusCode = 429; response.end("{\"error\":\"screen request limit\"}"); return; }
    forwarded += 1;
    try {
      const upstream = await fetch(localProxyTarget(target, request.url ?? "/"), { method: request.method, headers: { "content-type": String(request.headers["content-type"] ?? "application/json") }, body: Buffer.concat(chunks) });
      response.statusCode = upstream.status;
      const contentType = upstream.headers.get("content-type"); if (contentType) response.setHeader("content-type", contentType);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch { response.statusCode = 502; response.end("{\"error\":\"local forwarding failure\"}"); }
  });
  await new Promise((resolveListen, rejectListen) => { server.once("error", rejectListen); server.listen(0, "127.0.0.1", resolveListen); });
  const address = server.address(); if (!address || typeof address === "string") throw new Error("local proxy did not bind TCP");
  return { endpoint: `http://127.0.0.1:${address.port}/v1`, forwarded: () => forwarded, overLimit: () => overLimit, close: () => new Promise((resolveClose) => server.close(resolveClose)) };
}
function rows(text) { return text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }); }
function guardFacts(allRows) {
  const hits = allRows.filter((row) => row?.ext === "bash-output-guard" && row?.kind === "withheld");
  return { withheld: hits.length, max_withheld_chars: hits.reduce((max, row) => Math.max(max, typeof row.chars === "number" ? row.chars : 0), 0) };
}
function task(caseInfo) {
  const command = caseInfo.kind === "ordinary"
    ? "printf 'BASH_GUARD_ORDINARY\\n'"
    : "i=0; while [ \"$i\" -lt 12000 ]; do printf x; i=$((i+1)); done; printf '\\n'";
  return `Use the bash tool exactly once and execute exactly this command: ${command}\nAfter that one tool result, do not call any more tools. Reply with exactly ${caseInfo.expected_final} and nothing else.`;
}

const options = parseArgs();
const manifestPath = resolve(typeof options.manifest === "string" ? options.manifest : DEFAULT_MANIFEST);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);
const manifestSha = sha(stable(manifest));
const source = { probe_sha256: sha(await readFile(SCRIPT_PATH)), bash_guard_sha256: sha(await readFile(GUARD)), telemetry_flush_sha256: sha(await readFile(TELEMETRY_FLUSH)), json_summary_sha256: sha(await readFile(JSON_SUMMARY)), local_proxy_route_sha256: sha(await readFile(PROXY_ROUTE)) };
const prepared = { schema: "pi.bash-output-guard-live-preparation/v1", revision: manifest.revision, manifest_sha256: manifestSha, source, model: manifest.model, served_model: manifest.served_model, declared_context_window: manifest.declared_context_window, case_order: manifest.cases.map((item) => item.id), task_sha256: manifest.cases.map((item) => sha(task(item))) };
const approvalSha = sha(stable(prepared));
if (options.dry) { console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2)); process.exit(0); }
if (!options.prepare && !options.run) { console.error("bash-output guard probe requires --dry, --prepare, or --run --approve-sha <sha256>"); process.exit(3); }
if (options.prepare) { console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2)); process.exit(0); }
if (options["approve-sha"] !== approvalSha || options.model !== manifest.model) { console.error("bash-output guard probe approval, model, fixture, or source binding mismatch"); process.exit(3); }

const endpoint = typeof options.endpoint === "string" ? options.endpoint.replace(/\/+$/, "") : DEFAULT_ENDPOINT;
const pi = typeof options.pi === "string" ? options.pi : "pi";
const artifactRoot = typeof options["artifact-root"] === "string" ? options["artifact-root"] : resolve(process.env.HOME ?? tmpdir(), ".pi", "bash-output-evals");
const screenWork = await mkdtemp(resolve(tmpdir(), "pi-bash-output-screen-")); await chmod(screenWork, 0o700);
const proxy = await makeProxy(endpoint, manifest.max_provider_requests_per_case * manifest.cases.length);
try {
  const results = [];
  for (const caseInfo of manifest.cases) {
    const work = resolve(screenWork, caseInfo.id); const agent = resolve(work, "agent"); const telemetry = resolve(work, "telemetry.jsonl");
    await mkdir(agent, { recursive: true, mode: 0o700 }); await chmod(agent, 0o700);
    await writeFile(resolve(agent, "models.json"), JSON.stringify(modelsConfig(manifest, proxy.endpoint)), { mode: 0o600 });
    const before = proxy.forwarded();
    const outcome = await run(pi, ["--mode", "json", "--no-session", "--tools", "bash", "--model", manifest.model, "--extension", GUARD, "--extension", TELEMETRY_FLUSH, "-p", task(caseInfo)], { cwd: work, env: { ...process.env, PI_CODING_AGENT_DIR: agent, BASH_OUTPUT_GUARD: caseInfo.guard, BASH_OUTPUT_MAX_CHARS: String(manifest.max_bash_output_chars), TELEMETRY: "on", TELEMETRY_FILE: telemetry, TELEMETRY_SOURCE: "test" }, timeout_ms: 180000 });
    const facts = guardFacts(rows(await readFile(telemetry, "utf8").catch(() => "")));
    const forwarded = proxy.forwarded() - before;
    const finalSupported = outcome.pi.final_text_sha256 === sha(caseInfo.expected_final);
    const expectedWithheld = caseInfo.guard === "on" && caseInfo.kind === "noisy" ? 1 : 0;
    const completed = outcome.exit_code === 0 && !outcome.timed_out && !proxy.overLimit() && outcome.pi.bash_starts === 1 && outcome.pi.bash_ends === 1 && finalSupported;
    const exposure = facts.withheld === expectedWithheld && (expectedWithheld === 0 || facts.max_withheld_chars > manifest.max_bash_output_chars);
    results.push({ id: caseInfo.id, guard_setting: caseInfo.guard, kind: caseInfo.kind, ...outcome, forwarded_requests: forwarded, guard_facts: { ...facts, expected_withheld: expectedWithheld }, final_supported: finalSupported, completed, exposure });
  }
  const result = { schema: "pi.bash-output-guard-live-result/v1", run_id: randomUUID(), prepared, approval_sha256: approvalSha, requested_model: manifest.model, served_model: manifest.served_model, endpoint_fingerprint: endpointHash(endpoint), inference: true, cases: results, acceptance: { all_completed: results.every((item) => item.completed), all_expected_exposure: results.every((item) => item.exposure), passed: results.every((item) => item.completed && item.exposure) } };
  const artifact = await privateWrite(artifactRoot, `${manifest.revision}-${approvalSha.slice(0, 16)}-${result.run_id}.json`, result);
  console.log(JSON.stringify({ ...result, artifact_written: sha(artifact) }, null, 2));
} finally { await proxy.close().catch(() => undefined); await rm(screenWork, { recursive: true, force: true }); }
