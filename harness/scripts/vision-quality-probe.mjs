#!/usr/bin/env node
/*
 * Explicit, opt-in semantic/geometry probe for a deterministic UI fixture.
 * This is separate from vision-benchmark.mjs: it never runs unless a human
 * supplies --run and the exact prepared manifest digest.
 */
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createSam2TinyAdapter } from "../lib/sam2-tiny.ts";
import { refineWithSam } from "../lib/visual-grounding.ts";

const DEFAULT_ENDPOINT = "http://127.0.0.1:8080/v1";
function parseArgs() { const out = {}; for (let i = 2; i < process.argv.length; i += 1) { const item = process.argv[i]; if (["--prepare", "--dry", "--run"].includes(item)) out[item.slice(2)] = true; else if (item.startsWith("--") && process.argv[i + 1]) out[item.slice(2)] = process.argv[++i]; } return out; }
const options = parseArgs();
const manifestPath = typeof options.manifest === "string" ? options.manifest : fileURLToPath(new URL("../tests/fixtures/vision-quality-qwen36-35b-vision-v1.json", import.meta.url));
function stable(value) { if (value === null || typeof value !== "object") return JSON.stringify(value); if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`; return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`; }
function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function chunk(kind, payload) { const type = Buffer.from(kind, "ascii"); const out = Buffer.alloc(12 + payload.length); out.writeUInt32BE(payload.length, 0); type.copy(out, 4); Buffer.from(payload).copy(out, 8); out.writeUInt32BE(crc32(Buffer.concat([type, Buffer.from(payload)])), 8 + payload.length); return out; }
function crc32(bytes) { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); } return (crc ^ 0xffffffff) >>> 0; }
function uiPng(variant = "buttons") {
  const width = 640; const height = 360; const pixels = Buffer.alloc(width * height * 3, 0);
  const rect = (x, y, w, h, color) => { for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) { const p = (yy * width + xx) * 3; pixels[p] = color[0]; pixels[p + 1] = color[1]; pixels[p + 2] = color[2]; } };
  rect(0, 0, width, height, [245, 247, 250]);
  if (variant === "buttons") {
    rect(0, 0, width, 64, [31, 41, 55]);
    rect(80, 260, 160, 56, [220, 38, 38]); rect(420, 260, 160, 56, [37, 99, 235]);
    rect(100, 278, 120, 20, [255, 255, 255]); rect(440, 278, 120, 20, [255, 255, 255]);
  } else if (variant === "toolbar") {
    rect(0, 0, width, 56, [30, 64, 175]); rect(24, 18, 140, 20, [255, 255, 255]);
    rect(36, 106, 120, 48, [226, 232, 240]); rect(196, 106, 120, 48, [34, 197, 94]); rect(356, 106, 120, 48, [234, 179, 8]);
    rect(56, 120, 80, 20, [255, 255, 255]); rect(216, 120, 80, 20, [255, 255, 255]); rect(376, 120, 80, 20, [255, 255, 255]);
    rect(36, 230, 560, 2, [203, 213, 225]);
  } else if (variant === "dialog") {
    rect(0, 0, width, 48, [71, 85, 105]); rect(0, 48, width, 20, [226, 232, 240]);
    rect(140, 92, 360, 200, [255, 255, 255]); rect(140, 92, 360, 48, [15, 23, 42]);
    rect(176, 220, 120, 44, [148, 163, 184]); rect(344, 220, 120, 44, [22, 163, 74]);
    rect(196, 232, 80, 20, [255, 255, 255]); rect(364, 232, 80, 20, [255, 255, 255]);
  } else throw new Error("unknown synthetic UI variant");
  const raw = Buffer.alloc(height * (width * 3 + 1)); for (let y = 0; y < height; y += 1) { raw[y * (width * 3 + 1)] = 0; pixels.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
function endpointHash(value) { try { const url = new URL(value); const normalized = `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}:${url.port || (url.protocol === "https:" ? "443" : "80")}${url.pathname.replace(/\/+$/, "") || "/"}`; return sha(normalized); } catch { return sha("invalid"); } }
function iou(a, b) { const x0 = Math.max(a.x, b.x); const y0 = Math.max(a.y, b.y); const x1 = Math.min(a.x + a.width, b.x + b.width); const y1 = Math.min(a.y + a.height, b.y + b.height); const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0); const union = a.width * a.height + b.width * b.height - intersection; return union ? intersection / union : 0; }
function validateManifest(manifest, frameDigests) {
  if (!manifest || manifest.schema !== "pi.vision-quality/v1" || typeof manifest.revision !== "string" || !manifest.model_roles || typeof manifest.model_roles.quality !== "string" || !manifest.canvas || manifest.canvas.width !== 640 || manifest.canvas.height !== 360 || !Array.isArray(manifest.cases) || manifest.cases.length < 1 || manifest.cases.length > 8 || !manifest.frames || typeof manifest.frames !== "object") throw new Error("invalid vision quality manifest or frame binding");
  const frameNames = Object.keys(manifest.frames);
  if (frameNames.length < 1 || frameNames.length > 8 || frameNames.some((name) => !frameDigests[name] || manifest.frames[name]?.sha256 !== frameDigests[name])) throw new Error("invalid vision quality manifest or frame binding");
  for (const item of manifest.cases) if (!item || typeof item.id !== "string" || typeof item.frame !== "string" || !frameDigests[item.frame] || typeof item.question !== "string" || typeof item.answer_regex !== "string" || !item.oracle_box || !item.hint || !["point", "box"].includes(item.hint.kind)) throw new Error("invalid vision quality case");
}
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const frameBytes = {}; const frameDigests = {};
for (const [name, entry] of Object.entries(manifest.frames ?? {})) { const bytes = uiPng(entry?.variant ?? (name === "base" ? "buttons" : name)); frameBytes[name] = bytes; frameDigests[name] = sha(bytes); }
validateManifest(manifest, frameDigests);
const manifestSha = sha(stable(manifest));
const frameShaOutput = Object.keys(frameDigests).length === 1 ? Object.values(frameDigests)[0] : frameDigests;
if (options.prepare) { console.log(JSON.stringify({ schema: manifest.schema, revision: manifest.revision, case_count: manifest.cases.length, frame_sha256: frameShaOutput, manifest_sha256: manifestSha, inference: false }, null, 2)); process.exit(0); }
if (options.dry) { console.log(JSON.stringify({ schema: manifest.schema, revision: manifest.revision, case_count: manifest.cases.length, frame_sha256: frameShaOutput, manifest_sha256: manifestSha, quality_model: manifest.model_roles.quality, inference: false, message: "dry run: no image or model execution" }, null, 2)); process.exit(0); }
if (!options.run || options["approve-sha"] !== manifestSha || options.model !== manifest.model_roles.quality) { console.error("vision quality probe requires --run --approve-sha <sha256> --model <registered-quality-model>"); process.exit(3); }
const endpoint = typeof options.endpoint === "string" ? options.endpoint.replace(/\/+$/, "") : DEFAULT_ENDPOINT; const endpointFingerprint = endpointHash(endpoint);
// Pi registrations include a provider prefix; llama-swap's OpenAI route uses
// the configured served alias. Keep both identities explicit in the receipt.
const servedModel = typeof options["served-model"] === "string" ? options["served-model"] : options.model.startsWith("local-llamacpp/") ? options.model.slice("local-llamacpp/".length) : options.model;
const caseResults = [];
for (const item of manifest.cases) {
  const frame = frameBytes[item.frame]; const frameSha = frameDigests[item.frame]; const started = Date.now(); const data = `data:image/png;base64,${frame.toString("base64")}`;
  const body = { model: servedModel, temperature: 0, reasoning_format: "none", max_tokens: 512, messages: [{ role: "user", content: [{ type: "text", text: item.question }, { type: "image_url", image_url: { url: data } }] }] };
  let answerPresent = false; let answerSupported = false; let promptTokens = null; let completionTokens = null; let totalTokens = null; let modelStatus = null;
  try { const response = await fetch(`${endpoint}/chat/completions`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); modelStatus = response.status; const payload = await response.json(); const raw = String(payload?.choices?.[0]?.message?.content ?? ""); const final = raw.includes("</think>") ? raw.slice(raw.lastIndexOf("</think>") + 8) : raw; answerPresent = final.trim().length > 0; answerSupported = new RegExp(item.answer_regex, "i").test(final); promptTokens = payload?.usage?.prompt_tokens ?? null; completionTokens = payload?.usage?.completion_tokens ?? null; totalTokens = payload?.usage?.total_tokens ?? null; } catch { modelStatus = 0; }
  let grounding = { attempted: false, valid: false, iou: null, score: null, box: null, safe_point: null, failure: null };
  if (typeof options["sam-command"] === "string") {
    grounding.attempted = true; const adapter = createSam2TinyAdapter({ command: options["sam-command"], args: options["sam-arg"] ? [options["sam-arg"]] : [], version: "1.1.0-hiera-tiny", timeout_ms: 30_000 });
    try { const result = await refineWithSam(adapter, { observation_id: sha(`${manifest.revision}:${item.frame}:${item.id}`), exact_sha256: frameSha, geometry: manifest.canvas, hint: item.hint, purpose: "verify", expected_label: item.id, image_bytes: frame }); grounding.valid = true; grounding.iou = Math.round(iou(result.box, item.oracle_box) * 10_000) / 10_000; grounding.score = result.model_score; grounding.box = result.box; grounding.safe_point = result.safe_point; } catch (error) { grounding.failure = error?.name === "Sam2TinyError" ? String(error.reason) : "failed"; }
  }
  caseResults.push({ id: item.id, answer_present: answerPresent, answer_supported: answerSupported, required_claim_coverage: answerSupported ? "1/1" : "0/1", model_status: modelStatus, model_latency_ms: Date.now() - started, prompt_tokens: promptTokens, completion_tokens: completionTokens, total_tokens: totalTokens, grounding, client_rss_bytes: process.memoryUsage().rss });
}
console.log(JSON.stringify({ schema: "pi.vision-quality-result/v1", fixture_sha256: manifestSha, frame_sha256: frameShaOutput, requested_model: options.model, served_model: servedModel, endpoint_fingerprint: endpointFingerprint, inference: true, cases: caseResults }, null, 2));
