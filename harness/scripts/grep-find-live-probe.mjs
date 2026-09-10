#!/usr/bin/env node
/*
 * Isolated two-arm native grep/find mechanism screen. Pi JSON output is parsed
 * in memory into safe counters and hashes only; no prompt, source text, path,
 * or model/tool response is stored in its private result artifact.
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
const DEFAULT_MANIFEST = resolve(ROOT, "tests/fixtures/grep-find-qwen-v1.json");
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1";
const TOOL_ACTIVATION = resolve(ROOT, "extensions/tool-activation.ts");
const JSON_SUMMARY = resolve(ROOT, "lib/pi-json-screen.ts");
const PROXY_ROUTE = resolve(ROOT, "lib/local-proxy-route.ts");

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
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
  if (!value || value.schema !== "pi.grep-find-live-screen/v1" || typeof value.revision !== "string") throw new Error("invalid grep/find screen manifest");
  if (typeof value.model !== "string" || typeof value.served_model !== "string" || !Number.isSafeInteger(value.declared_context_window) || value.declared_context_window < 1024) throw new Error("invalid model binding");
  if (!Number.isSafeInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 1024 || !Number.isSafeInteger(value.max_provider_requests_per_case) || value.max_provider_requests_per_case < 2 || value.max_provider_requests_per_case > 8) throw new Error("invalid screen limits");
  if (!/^[0-9a-f]{64}$/.test(value.expected_final_sha256 ?? "") || !Array.isArray(value.cases) || value.cases.length !== 2) throw new Error("invalid screen outcomes");
  const expected = ["control", "treatment"];
  for (let index = 0; index < expected.length; index += 1) {
    const item = value.cases[index];
    if (!item || item.id !== expected[index] || !["on", "off"].includes(item.grep_find)) throw new Error("invalid matched case");
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
async function makeProject(root) {
  await mkdir(resolve(root, "src", "nested"), { recursive: true, mode: 0o700 });
  await mkdir(resolve(root, "notes"), { recursive: true, mode: 0o700 });
  await writeFile(resolve(root, "src", "entry.ts"), "export const app = 'search-screen';\n", { mode: 0o600 });
  await writeFile(resolve(root, "notes", "readme.txt"), "The token is stored in the source tree.\n", { mode: 0o600 });
  await writeFile(resolve(root, "src", "nested", "catalog.ts"), "export const MUNCHKIN_SEARCH_TOKEN = 'ORCHID';\n", { mode: 0o600 });
}
function task() { return "This temporary project has an unknown nested file containing MUNCHKIN_SEARCH_TOKEN. Determine its value using non-mutating tools. Do not use Bash. Find the file and inspect the matching line, then reply with exactly the token value and nothing else."; }
function count(summary, name) { return summary.tool_starts[name] ?? 0; }

const options = parseArgs();
const manifestPath = resolve(typeof options.manifest === "string" ? options.manifest : DEFAULT_MANIFEST);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);
const manifestSha = sha(stable(manifest));
const source = { probe_sha256: sha(await readFile(SCRIPT_PATH)), tool_activation_sha256: sha(await readFile(TOOL_ACTIVATION)), json_summary_sha256: sha(await readFile(JSON_SUMMARY)), local_proxy_route_sha256: sha(await readFile(PROXY_ROUTE)) };
const prepared = { schema: "pi.grep-find-live-preparation/v1", revision: manifest.revision, manifest_sha256: manifestSha, source, model: manifest.model, served_model: manifest.served_model, declared_context_window: manifest.declared_context_window, case_order: manifest.cases.map((item) => item.id), task_sha256: sha(task()) };
const approvalSha = sha(stable(prepared));
if (options.dry || options.prepare) { console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2)); process.exit(0); }
if (!options.run || options["approve-sha"] !== approvalSha || options.model !== manifest.model) { console.error("grep/find probe approval, model, fixture, or source binding mismatch"); process.exit(3); }

const endpoint = typeof options.endpoint === "string" ? options.endpoint.replace(/\/+$/, "") : DEFAULT_ENDPOINT;
const pi = typeof options.pi === "string" ? options.pi : "pi";
const artifactRoot = typeof options["artifact-root"] === "string" ? options["artifact-root"] : resolve(process.env.HOME ?? tmpdir(), ".pi", "grep-find-evals");
const screenWork = await mkdtemp(resolve(tmpdir(), "pi-grep-find-screen-")); await chmod(screenWork, 0o700);
const proxy = await makeProxy(endpoint, manifest.max_provider_requests_per_case * manifest.cases.length);
try {
  const results = [];
  for (const caseInfo of manifest.cases) {
    const work = resolve(screenWork, caseInfo.id); const agent = resolve(work, "agent");
    await mkdir(agent, { recursive: true, mode: 0o700 }); await chmod(agent, 0o700); await makeProject(work);
    await writeFile(resolve(agent, "models.json"), JSON.stringify(modelsConfig(manifest, proxy.endpoint)), { mode: 0o600 });
    const before = proxy.forwarded();
    const outcome = await run(pi, ["--mode", "json", "--no-session", "--model", manifest.model, "--extension", TOOL_ACTIVATION, "-p", task()], { cwd: work, env: { ...process.env, PI_CODING_AGENT_DIR: agent, GREP_FIND_TOOLS: caseInfo.grep_find, MUNCHKIN_TOOL_PROFILE: "core" }, timeout_ms: 180_000 });
    const forwarded = proxy.forwarded() - before;
    const finalSupported = outcome.pi.final_text_sha256 === manifest.expected_final_sha256;
    const nativeExposure = count(outcome.pi, "grep") > 0 && count(outcome.pi, "find") > 0;
    const completed = outcome.exit_code === 0 && !outcome.timed_out && !proxy.overLimit() && forwarded > 0 && forwarded <= manifest.max_provider_requests_per_case && finalSupported;
    results.push({ id: caseInfo.id, grep_find_setting: caseInfo.grep_find, ...outcome, forwarded_requests: forwarded, final_supported: finalSupported, native_exposure: nativeExposure, completed });
  }
  const control = results[0]; const treatment = results[1];
  const result = { schema: "pi.grep-find-live-result/v1", run_id: randomUUID(), prepared, approval_sha256: approvalSha, requested_model: manifest.model, served_model: manifest.served_model, endpoint_fingerprint: endpointHash(endpoint), inference: true, cases: results, acceptance: { control_completed: control.completed, treatment_completed: treatment.completed, control_native_calls: count(control.pi, "grep") + count(control.pi, "find"), treatment_native_exposure: treatment.native_exposure, passed: control.completed && treatment.completed && !control.native_exposure && treatment.native_exposure } };
  const artifact = await privateWrite(artifactRoot, `${manifest.revision}-${approvalSha.slice(0, 16)}-${result.run_id}.json`, result);
  console.log(JSON.stringify({ ...result, artifact_written: sha(artifact) }, null, 2));
} finally { await proxy.close().catch(() => undefined); await rm(screenWork, { recursive: true, force: true }); }
