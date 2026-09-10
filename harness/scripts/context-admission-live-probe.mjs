#!/usr/bin/env node
/*
 * A two-cell, transport-counted context-admission qualification.  The first
 * cell proves a normal Pi request reaches the selected model through the
 * actual extension.  The second makes an oversized private system prompt and
 * proves the extension rejects it before the local forwarding proxy can send
 * it.  The proxy records counts and digests only; prompts and responses never
 * become screen artifacts.
 */
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile } from "../lib/private-artifact.ts";
import { evaluateContextAdmissionScreen } from "../lib/context-admission-screen.ts";
import { localProxyTarget } from "../lib/local-proxy-route.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_MANIFEST = resolve(ROOT, "tests/fixtures/context-admission-qwen-v1.json");
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1";
const CONTEXT_ADMISSION = resolve(ROOT, "extensions/context-admission.ts");
const TELEMETRY_FLUSH = resolve(ROOT, "extensions/telemetry-flush.ts");
const SCREEN_EVALUATOR = resolve(ROOT, "lib/context-admission-screen.ts");
const LOCAL_PROXY_ROUTE = resolve(ROOT, "lib/local-proxy-route.ts");

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
}
function endpointHash(value) {
  try {
    const url = new URL(value);
    return sha(`${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === "https:" ? "443" : "80")}${url.pathname.replace(/\/+$/, "") || "/"}`);
  } catch { return sha("invalid"); }
}
function parseArgs() {
  const out = {};
  for (let index = 2; index < process.argv.length; index += 1) {
    const item = process.argv[index];
    if (["--dry", "--prepare", "--validate", "--run"].includes(item)) out[item.slice(2)] = true;
    else if (item.startsWith("--") && process.argv[index + 1]) out[item.slice(2)] = process.argv[++index];
  }
  return out;
}
function validateManifest(value) {
  if (!value || value.schema !== "pi.context-admission-live-screen/v1" || typeof value.revision !== "string") throw new Error("invalid context-admission screen manifest");
  if (typeof value.model !== "string" || typeof value.served_model !== "string" || !Number.isSafeInteger(value.declared_context_window) || value.declared_context_window < 1024) throw new Error("invalid context-admission model binding");
  if (!Number.isSafeInteger(value.max_tokens) || value.max_tokens < 1 || value.max_tokens > 1024 || typeof value.normal_prompt !== "string") throw new Error("invalid context-admission request binding");
  if (!Number.isSafeInteger(value.oversize_bytes) || value.oversize_bytes < value.declared_context_window * 4) throw new Error("oversize fixture is not conservatively above the declared window");
  const required = value.required;
  if (!required || required.normal_outcome !== "admitted" || required.oversize_outcome !== "rejected" || required.oversize_reason !== "aggregate_budget_exceeded" || required.normal_forwarded_requests !== 1 || required.oversize_forwarded_requests !== 0) throw new Error("invalid context-admission acceptance rule");
}
async function privateWrite(root, name, value) {
  const directory = resolve(root);
  const path = resolve(directory, name);
  if (!path.startsWith(`${directory}/`)) throw new Error("artifact path escapes root");
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, directoryMode: 0o700 });
  return path;
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
      resolveResult({ exit_code: code ?? -1, signal: signal ?? null, timed_out: timedOut, stdout_sha256: sha(stdout), stderr_sha256: sha(stderr), stdout_bytes: Buffer.byteLength(stdout), stderr_bytes: Buffer.byteLength(stderr) });
    });
  });
}
async function makeProxy(target) {
  let requests = 0;
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    requests += 1;
    try {
      const upstream = await fetch(localProxyTarget(target, request.url ?? "/"), { method: request.method, headers: { "content-type": String(request.headers["content-type"] ?? "application/json") }, body: Buffer.concat(chunks) });
      response.statusCode = upstream.status;
      const contentType = upstream.headers.get("content-type");
      if (contentType) response.setHeader("content-type", contentType);
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch {
      response.statusCode = 502;
      response.setHeader("content-type", "application/json");
      response.end("{\"error\":\"local forwarding failure\"}");
    }
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("local proxy did not bind TCP");
  return {
    endpoint: `http://127.0.0.1:${address.port}/v1`,
    requests: () => requests,
    close: () => new Promise((resolveClose) => server.close(() => resolveClose())),
  };
}
function telemetryRows(text) {
  return text.split("\n").filter(Boolean).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } });
}
function classification(rows, kind) {
  const row = [...rows].reverse().find((item) => item?.ext === "context-admission" && item?.kind === kind);
  return row ? { present: true, outcome: row.outcome ?? null, reason_class: row.reason_class ?? null, request_digest: row.request_digest ?? null, epoch_digest: row.epoch_digest ?? null } : { present: false, outcome: null, reason_class: null, request_digest: null, epoch_digest: null };
}
function modelsConfig(manifest, endpoint) {
  return {
    providers: {
      "local-llamacpp": {
        baseUrl: endpoint,
        api: "openai-completions",
        apiKey: "none",
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
          thinkingFormat: "qwen-chat-template",
          supportsStrictMode: false,
        },
        models: [{
          id: manifest.served_model,
          name: manifest.served_model,
          reasoning: true,
          input: ["text"],
          contextWindow: manifest.declared_context_window,
          maxTokens: manifest.max_tokens,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        }],
      },
    },
  };
}

const options = parseArgs();
const manifestPath = resolve(typeof options.manifest === "string" ? options.manifest : DEFAULT_MANIFEST);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);
const manifestSha = sha(stable(manifest));
const source = {
  probe_sha256: sha(await readFile(SCRIPT_PATH)),
  context_admission_sha256: sha(await readFile(CONTEXT_ADMISSION)),
  telemetry_flush_sha256: sha(await readFile(TELEMETRY_FLUSH)),
  screen_evaluator_sha256: sha(await readFile(SCREEN_EVALUATOR)),
  local_proxy_route_sha256: sha(await readFile(LOCAL_PROXY_ROUTE)),
};
const prepared = { schema: "pi.context-admission-live-preparation/v1", revision: manifest.revision, manifest_sha256: manifestSha, source, model: manifest.model, served_model: manifest.served_model, declared_context_window: manifest.declared_context_window, normal_prompt_sha256: sha(manifest.normal_prompt), oversize_fixture_sha256: sha("x".repeat(manifest.oversize_bytes)) };
const approvalSha = sha(stable(prepared));
if (options.dry) {
  console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2));
  process.exit(0);
}
if (!options.prepare && !options.validate && !options.run) {
  console.error("context-admission probe requires --dry, --prepare, --validate, or --run --approve-sha <sha256>");
  process.exit(3);
}
if (options.prepare) {
  console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2));
  process.exit(0);
}
if (options.validate) {
  const pi = typeof options.pi === "string" ? options.pi : "pi";
  const work = await mkdtemp(resolve(tmpdir(), "pi-context-admission-validate-"));
  await chmod(work, 0o700);
  try {
    const agent = resolve(work, "agent");
    await mkdir(agent, { mode: 0o700 });
    await chmod(agent, 0o700);
    const modelsPath = resolve(agent, "models.json");
    await writeFile(modelsPath, JSON.stringify(modelsConfig(manifest, DEFAULT_ENDPOINT)), { mode: 0o600 });
    const listed = await run(pi, ["--list-models"], { cwd: ROOT, env: { ...process.env, PI_CODING_AGENT_DIR: agent }, timeout_ms: 15_000 });
    const modelListed = listed.exit_code === 0 && listed.stdout_bytes > 0;
    console.log(JSON.stringify({ schema: "pi.context-admission-launcher-validation/v1", model: manifest.model, listed: modelListed, ...listed, inference: false }, null, 2));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  process.exit(0);
}
if (options["approve-sha"] !== approvalSha || options.model !== manifest.model) {
  console.error("context-admission probe approval, model, fixture, or source binding mismatch");
  process.exit(3);
}

const endpoint = typeof options.endpoint === "string" ? options.endpoint.replace(/\/+$/, "") : DEFAULT_ENDPOINT;
const pi = typeof options.pi === "string" ? options.pi : "pi";
const artifactRoot = typeof options["artifact-root"] === "string" ? options["artifact-root"] : resolve(process.env.HOME ?? tmpdir(), ".pi", "context-admission-evals");
const work = await mkdtemp(resolve(tmpdir(), "pi-context-admission-"));
await chmod(work, 0o700);
const overlay = resolve(work, "agent");
const telemetry = resolve(work, "telemetry.jsonl");
const oversize = resolve(work, "oversize.md");
const proxy = await makeProxy(endpoint);
try {
  await mkdir(overlay, { mode: 0o700 });
  await chmod(overlay, 0o700);
  await writeFile(resolve(overlay, "models.json"), JSON.stringify(modelsConfig(manifest, proxy.endpoint)), { mode: 0o600 });
  await writeFile(oversize, "x".repeat(manifest.oversize_bytes), { mode: 0o600 });
  const env = { ...process.env, PI_CODING_AGENT_DIR: overlay, CONTEXT_ADMISSION: "on", CONTEXT_HANDOFF: "off", TELEMETRY: "on", TELEMETRY_FILE: telemetry, TELEMETRY_SOURCE: "test" };
  const base = ["--no-session", "--no-tools", "--model", manifest.model, "--extension", CONTEXT_ADMISSION, "--extension", TELEMETRY_FLUSH, "-p"];
  const beforeNormal = proxy.requests();
  const normal = await run(pi, [...base, manifest.normal_prompt], { cwd: ROOT, env, timeout_ms: 180000 });
  const normalForwarded = proxy.requests() - beforeNormal;
  const beforeOversize = proxy.requests();
  const blocked = await run(pi, ["--no-session", "--no-tools", "--model", manifest.model, "--extension", CONTEXT_ADMISSION, "--extension", TELEMETRY_FLUSH, "--append-system-prompt", oversize, "-p", manifest.normal_prompt], { cwd: ROOT, env, timeout_ms: 60000 });
  const oversizeForwarded = proxy.requests() - beforeOversize;
  const rows = telemetryRows(await readFile(telemetry, "utf8").catch(() => ""));
  const admitted = classification(rows, "admitted");
  const rejected = classification(rows, "rejected");
  const result = {
    schema: "pi.context-admission-live-result/v1", run_id: randomUUID(), prepared, approval_sha256: approvalSha,
    requested_model: manifest.model, served_model: manifest.served_model, endpoint_fingerprint: endpointHash(endpoint), inference: true,
    normal: { ...normal, forwarded_requests: normalForwarded, telemetry: admitted },
    oversize: { ...blocked, forwarded_requests: oversizeForwarded, telemetry: rejected },
    acceptance: evaluateContextAdmissionScreen(
      { exit_code: normal.exit_code, forwarded_requests: normalForwarded, telemetry: admitted },
      { exit_code: blocked.exit_code, forwarded_requests: oversizeForwarded, telemetry: rejected },
      manifest.required,
    ),
  };
  const artifact = await privateWrite(artifactRoot, `${manifest.revision}-${approvalSha.slice(0, 16)}-${result.run_id}.json`, result);
  console.log(JSON.stringify({ ...result, artifact_written: sha(artifact) }, null, 2));
} finally {
  await proxy.close().catch(() => undefined);
  await rm(work, { recursive: true, force: true });
}
