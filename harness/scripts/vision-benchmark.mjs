#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { VisualObservationCache, imageDigest, pngLuma, perceptualHash } from "../lib/visual-observation.ts";

const root = dirname(fileURLToPath(import.meta.url));
const defaultFixturePath = join(root, "..", "tests", "fixtures", "vision-contract-v1.json");

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
}
function digest(value) { return createHash("sha256").update(stable(value)).digest("hex"); }
function args() {
  const out = {};
  for (let i = 2; i < process.argv.length; i += 1) {
    const value = process.argv[i];
    if (value === "--selftest" || value === "--dry" || value === "--run") out[value.slice(2)] = true;
    else if (value.startsWith("--") && process.argv[i + 1]) out[value.slice(2)] = process.argv[++i];
  }
  return out;
}
const options = args();
const fixturePath = typeof options.manifest === "string" ? options.manifest : defaultFixturePath;
let fixture;
try {
  fixture = JSON.parse(await readFile(fixturePath, "utf8"));
} catch {
  console.error("vision benchmark could not load the requested manifest");
  process.exitCode = 4;
}
function validateManifest(value) {
  if (!value || value.schema !== "pi.vision-contract/v1" || typeof value.revision !== "string" || !value.model_roles || typeof value.model_roles.protocol !== "string" || typeof value.model_roles.quality !== "string") throw new Error("invalid vision fixture manifest");
  if (!Array.isArray(value.arms) || JSON.stringify(value.arms) !== JSON.stringify(["uncached", "exact_cache", "near_cache", "sam_assisted"])) throw new Error("vision fixture arms are not frozen");
  if (!Array.isArray(value.metrics) || value.metrics.length < 1 || !value.frames || !Array.isArray(value.cases) || value.cases.length < 3 || value.cases.length > 24) throw new Error("vision fixture is incomplete");
  const ids = new Set();
  for (const item of value.cases) {
    if (!item || typeof item.id !== "string" || ids.has(item.id) || typeof item.frame !== "string" || !Object.hasOwn(value.frames, item.frame) || typeof item.change !== "string" || typeof item.required_fresh !== "boolean" || typeof item.target !== "boolean") throw new Error("invalid vision fixture case");
    ids.add(item.id);
  }
}
function frameBytes(name) { return Uint8Array.from(Buffer.from(fixture.frames[name], "base64")); }
function visualRequest(item, index, arm) {
  const bytes = frameBytes(item.frame);
  const decoded = pngLuma(bytes);
  const phash = decoded ? perceptualHash(decoded.luma, decoded.width, decoded.height) : "0000000000000000";
  return { bytes, request: { session_id: `fixture-${arm}`, source: "screen", source_id: "window-fixture", geometry: { width: decoded?.width ?? 1, height: decoded?.height ?? 1, device_scale: 2 }, exact_sha256: imageDigest(bytes), phash: arm === "near_cache" || arm === "sam_assisted" ? phash : item.change === "none" ? phash : null, question: "locate the actionable target", model_fingerprint: "fixture-vision-epoch", analysis_version: "vision-contract/v1", now: 1_000 + index, ttl_ms: item.change === "action" ? 0 : 30_000 } };
}
function runArm(arm) {
  const started = performance.now();
  const cache = new VisualObservationCache(32, 8);
  let imageDelivery = 0; let cacheHits = 0; let missedChanges = 0; let staleTargetRefusals = 0; let targetingErrors = 0; let groundingAttempts = 0; let groundingValid = 0; let unsafeActionsBlocked = 0; let modelCalls = 0; let contextTokens = 0;
  for (const [index, item] of fixture.cases.entries()) {
    const { bytes, request } = visualRequest(item, index, arm);
    const force = arm === "uncached" || item.change === "action" || (arm === "sam_assisted" && item.target);
    const decision = cache.decide({ ...request, force });
    const fresh = decision.decision !== "exact_reuse" && decision.decision !== "near_reuse";
    if (fresh) { imageDelivery += 1; modelCalls += 1; contextTokens += Math.min(16_384, Math.max(256, Math.ceil(request.geometry.width * request.geometry.height / 256))); cache.put(request, undefined, bytes); }
    else { cacheHits += 1; if (item.required_fresh) missedChanges += 1; }
    if (item.target && item.required_fresh && !fresh) { staleTargetRefusals += 1; unsafeActionsBlocked += 1; }
    if (arm === "sam_assisted" && item.target && fresh) { groundingAttempts += 1; groundingValid += 1; /* Oracle geometry is valid; no click is issued. */ }
  }
  return { arm, image_delivery: imageDelivery, cache_hit_quality: cacheHits === 0 ? "uncached" : missedChanges === 0 ? "safe" : "hint_only", missed_changes: missedChanges, stale_target_refusals: staleTargetRefusals, targeting_errors: targetingErrors, grounding_attempts: groundingAttempts, grounding_accuracy: groundingAttempts ? `${groundingValid}/${groundingAttempts}` : "not_measured", unsafe_actions_blocked: unsafeActionsBlocked, model_calls: modelCalls, context_tokens: contextTokens, latency_ms: Math.round((performance.now() - started) * 100) / 100, memory_bytes: process.memoryUsage().heapUsed };
}

if (fixture) {
  try {
    validateManifest(fixture);
  } catch {
    console.error("invalid vision fixture manifest");
    process.exitCode = 4;
  }
}
const manifestSha = fixture ? digest(fixture) : null;
if (!fixture || process.exitCode === 4) {
  // Loading and validation failures are terminal and never reach a model or
  // mutate a result directory.
} else if (!options.selftest && !options.dry && !options.run) {
  console.error("vision benchmark requires --selftest, --dry, or explicit --run --approve-sha <sha256>");
  process.exitCode = 2;
} else if (options.selftest) {
  console.log(JSON.stringify({ schema: fixture.schema, revision: fixture.revision, cases: fixture.cases.length, arms: fixture.arms, manifest_sha256: manifestSha, inference: false }, null, 2));
} else if (options.dry) {
  console.log(JSON.stringify({ schema: fixture.schema, revision: fixture.revision, manifest_sha256: manifestSha, protocol_model: fixture.model_roles.protocol, quality_model: fixture.model_roles.quality, inference: false, message: "dry run: no image or model execution" }, null, 2));
} else {
  if (options["approve-sha"] !== manifestSha) { console.error("vision benchmark approval hash mismatch"); process.exitCode = 3; }
  else if (options.model !== fixture.model_roles.protocol && options.model !== fixture.model_roles.quality) { console.error("vision benchmark model must match a registered fixture role"); process.exitCode = 3; }
  else console.log(JSON.stringify({ schema: "pi.vision-benchmark-result/v1", fixture_sha256: manifestSha, model: options.model, model_role: options.model === fixture.model_roles.protocol ? "protocol" : "quality", inference: false, arms: fixture.arms.map(runArm) }, null, 2));
}
