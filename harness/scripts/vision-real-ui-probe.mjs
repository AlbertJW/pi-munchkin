#!/usr/bin/env node
/*
 * One-case, browser-rendered visual qualification. A model request is possible
 * only after --prepare has bound the fixture, browser renderer, and screenshot
 * digest into an approval SHA. The screenshot is temporary; only safe result
 * classifications and digests are written to a private artifact directory.
 */
import { createHash, randomUUID } from "node:crypto";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { atomicWriteFile } from "../lib/private-artifact.ts";

const exec = promisify(execFile);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_MANIFEST = resolve(ROOT, "tests/fixtures/vision-real-ui-chrome-v1.json");
const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1";

function parseArgs() {
  const out = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const item = process.argv[i];
    if (["--prepare", "--dry", "--run"].includes(item)) out[item.slice(2)] = true;
    else if (item.startsWith("--") && process.argv[i + 1]) out[item.slice(2)] = process.argv[++i];
  }
  return out;
}
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
function pngGeometry(bytes) {
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR") throw new Error("renderer did not create a PNG");
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}
function validateManifest(value) {
  if (!value || value.schema !== "pi.vision-real-ui/v1" || typeof value.revision !== "string" || typeof value.fixture_html !== "string" || !/^[0-9a-f]{64}$/.test(value.fixture_html_sha256 ?? "") || !value.model_roles || typeof value.model_roles.quality !== "string") throw new Error("invalid real-UI vision manifest");
  const { width, height, device_scale } = value.canvas ?? {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || device_scale !== 1) throw new Error("invalid real-UI canvas");
  const item = value.case;
  if (!item || typeof item.id !== "string" || typeof item.question !== "string" || typeof item.answer_regex !== "string" || !item.oracle_box || !item.hint) throw new Error("invalid real-UI case");
  const box = item.oracle_box;
  if (![box.x, box.y, box.width, box.height].every(Number.isSafeInteger) || box.x < 0 || box.y < 0 || box.width < 1 || box.height < 1 || box.x + box.width > width || box.y + box.height > height) throw new Error("real-UI oracle box is outside canvas");
  if (!Number.isSafeInteger(item.hint.x) || !Number.isSafeInteger(item.hint.y) || item.hint.x <= box.x || item.hint.x >= box.x + box.width || item.hint.y <= box.y || item.hint.y >= box.y + box.height) throw new Error("real-UI hint is not inside oracle box");
}
async function render(chrome, htmlPath, canvas) {
  const work = await mkdtemp(resolve(tmpdir(), "pi-real-ui-"));
  await chmod(work, 0o700);
  const png = resolve(work, "frame.png");
  try {
    const version = String((await exec(chrome, ["--version"], { timeout: 10_000, windowsHide: true })).stdout).trim();
    if (!version) throw new Error("browser renderer did not report a version");
    const chromeArgs = ["--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${canvas.width},${canvas.height}`];
    const htmlUrl = pathToFileURL(htmlPath).href;
    const dom = String((await exec(chrome, [...chromeArgs, "--dump-dom", htmlUrl], { timeout: 30_000, windowsHide: true })).stdout);
    const match = dom.match(/data-confirm-box="(\d+),(\d+),(\d+),(\d+)"/);
    if (!match) throw new Error("renderer did not expose a geometry oracle");
    const oracle_box = { x: Number(match[1]), y: Number(match[2]), width: Number(match[3]), height: Number(match[4]) };
    await exec(chrome, [...chromeArgs, `--screenshot=${png}`, htmlUrl], { timeout: 30_000, windowsHide: true });
    const bytes = await readFile(png);
    const geometry = pngGeometry(bytes);
    if (geometry.width !== canvas.width || geometry.height !== canvas.height) throw new Error("renderer screenshot geometry does not match manifest");
    return { bytes, geometry, oracle_box, renderer_sha256: sha(version) };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
async function privateWrite(root, name, value) {
  const directory = resolve(root);
  const path = resolve(directory, name);
  if (!path.startsWith(`${directory}/`)) throw new Error("artifact path escapes root");
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, directoryMode: 0o700 });
  return path;
}

const options = parseArgs();
const manifestPath = resolve(typeof options.manifest === "string" ? options.manifest : DEFAULT_MANIFEST);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);
const htmlPath = resolve(dirname(manifestPath), manifest.fixture_html);
if (!htmlPath.startsWith(`${dirname(manifestPath)}/`)) throw new Error("fixture HTML escapes manifest directory");
const html = await readFile(htmlPath);
if (sha(html) !== manifest.fixture_html_sha256) throw new Error("fixture HTML digest does not match manifest");
const manifestSha = sha(stable(manifest));
const source = { probe_sha256: sha(await readFile(SCRIPT_PATH)) };
if (options.dry) {
  console.log(JSON.stringify({ schema: manifest.schema, revision: manifest.revision, manifest_sha256: manifestSha, source, fixture_html_sha256: manifest.fixture_html_sha256, quality_model: manifest.model_roles.quality, inference: false }, null, 2));
  process.exit(0);
}
if (!options.prepare && !options.run) {
  console.error("real-UI vision probe requires --dry, --prepare, or --run --approve-sha <sha256> --model <registered-quality-model> --chrome <path>");
  process.exit(3);
}
if (typeof options.chrome !== "string") {
  console.error("real-UI vision probe requires --chrome <headless-browser-path>");
  process.exit(3);
}
const rendered = await render(options.chrome, htmlPath, manifest.canvas);
if (JSON.stringify(rendered.oracle_box) !== JSON.stringify(manifest.case.oracle_box)) throw new Error("renderer geometry oracle does not match manifest");
const prepared = { schema: "pi.vision-real-ui-preparation/v1", revision: manifest.revision, manifest_sha256: manifestSha, source, fixture_html_sha256: manifest.fixture_html_sha256, screenshot_sha256: sha(rendered.bytes), geometry: rendered.geometry, renderer_oracle_box: rendered.oracle_box, renderer_sha256: rendered.renderer_sha256, quality_model: manifest.model_roles.quality };
const approvalSha = sha(stable(prepared));
if (options.prepare) {
  console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2));
  process.exit(0);
}
if (options["approve-sha"] !== approvalSha || options.model !== manifest.model_roles.quality) {
  console.error("real-UI vision probe approval, model, fixture, or renderer binding mismatch");
  process.exit(3);
}
const endpoint = typeof options.endpoint === "string" ? options.endpoint.replace(/\/+$/, "") : DEFAULT_ENDPOINT;
const servedModel = typeof options["served-model"] === "string" ? options["served-model"] : options.model.replace(/^local-llamacpp\//, "");
const started = Date.now();
let status = 0; let answerPresent = false; let answerSupported = false; let promptTokens = null; let completionTokens = null; let totalTokens = null;
try {
  const data = `data:image/png;base64,${rendered.bytes.toString("base64")}`;
  const response = await fetch(`${endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: servedModel, temperature: 0, reasoning_format: "none", max_tokens: 128, messages: [{ role: "user", content: [{ type: "text", text: manifest.case.question }, { type: "image_url", image_url: { url: data } }] }] }) });
  status = response.status;
  const payload = await response.json();
  const raw = String(payload?.choices?.[0]?.message?.content ?? "");
  const final = raw.includes("</think>") ? raw.slice(raw.lastIndexOf("</think>") + 8) : raw;
  answerPresent = final.trim().length > 0;
  answerSupported = new RegExp(manifest.case.answer_regex, "i").test(final);
  promptTokens = payload?.usage?.prompt_tokens ?? null;
  completionTokens = payload?.usage?.completion_tokens ?? null;
  totalTokens = payload?.usage?.total_tokens ?? null;
} catch { status = 0; }
const result = { schema: "pi.vision-real-ui-result/v1", run_id: randomUUID(), prepared, approval_sha256: approvalSha, requested_model: options.model, served_model: servedModel, endpoint_fingerprint: endpointHash(endpoint), inference: true, case: { id: manifest.case.id, answer_present: answerPresent, answer_supported: answerSupported, required_claim_coverage: answerSupported ? "1/1" : "0/1", model_status: status, model_latency_ms: Date.now() - started, prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens }, client_rss_bytes: process.memoryUsage().rss };
const root = typeof options["artifact-root"] === "string" ? options["artifact-root"] : resolve(process.env.HOME ?? tmpdir(), ".pi", "vision-evals");
const artifact = await privateWrite(root, `${manifest.revision}-${approvalSha.slice(0, 16)}-${result.run_id}.json`, result);
console.log(JSON.stringify({ ...result, artifact_written: sha(artifact) }, null, 2));
