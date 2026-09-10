#!/usr/bin/env node
/*
 * Bounded public-source extraction comparison. Raw page text is held only in
 * memory to calculate safe length, digest, identity, term-coverage, and timing
 * facts; the durable result never contains source text or request bodies.
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWriteFile } from "../lib/private-artifact.ts";
import { buildKetchEnv, formatJinaReaderUrl, parseReadResults, runKetchProcess, unwrapJinaReaderUrl } from "../lib/ketch-runtime.ts";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_MANIFEST = resolve(ROOT, "tests/fixtures/jina-reader-v1.json");
const KETCH_RUNTIME = resolve(ROOT, "lib/ketch-runtime.ts");
const KETCH_EXTENSION = resolve(ROOT, "extensions/ketch.ts");

function sha(value) { return createHash("sha256").update(value).digest("hex"); }
function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
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
  if (!value || value.schema !== "pi.jina-reader-live-screen/v1" || typeof value.revision !== "string" || typeof value.ketch_bin !== "string") throw new Error("invalid Jina Reader screen manifest");
  if (!Number.isSafeInteger(value.timeout_ms) || value.timeout_ms < 1_000 || value.timeout_ms > 120_000 || !Number.isSafeInteger(value.max_chars) || value.max_chars < 1_000 || value.max_chars > 16_000 || !Array.isArray(value.sources) || value.sources.length < 1 || value.sources.length > 4) throw new Error("invalid Jina Reader limits");
  for (const item of value.sources) {
    if (!item || typeof item.id !== "string" || typeof item.url !== "string" || !Array.isArray(item.required_terms) || item.required_terms.length < 1 || item.required_terms.length > 4 || item.required_terms.some((term) => typeof term !== "string" || !term)) throw new Error("invalid Jina Reader source");
    const parsed = new URL(item.url); if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) throw new Error("invalid Jina Reader source URL");
  }
}
async function privateWrite(root, name, value) {
  const directory = resolve(root); const path = resolve(directory, name);
  if (!path.startsWith(`${directory}/`)) throw new Error("artifact path escapes root");
  await atomicWriteFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, directoryMode: 0o700 });
  return path;
}
function normalizedUrl(raw) { const url = new URL(raw); url.hash = ""; return url.toString(); }
function coverage(markdown, terms) { return terms.filter((term) => markdown.toLocaleLowerCase("en-US").includes(term.toLocaleLowerCase("en-US"))).length; }
async function readOne(source, reader, manifest) {
  const target = reader === "jina" ? formatJinaReaderUrl(source.url) : source.url;
  const started = Date.now();
  const result = await runKetchProcess(manifest.ketch_bin, ["scrape", target, "--max-chars", String(manifest.max_chars), "--trim", "--json"], { timeoutMs: manifest.timeout_ms, env: buildKetchEnv() });
  let row = null;
  try { row = parseReadResults(result.stdout)[0] ?? null; } catch { row = null; }
  const content = row?.markdown ?? "";
  const expected = normalizedUrl(source.url);
  const returned = row?.url ? normalizedUrl(reader === "jina" ? (unwrapJinaReaderUrl(row.url) ?? "invalid://missing") : row.url) : null;
  return {
    source_id: source.id,
    reader,
    source_url_sha256: sha(expected),
    returned_source_matches: returned === expected,
    code: result.code,
    timed_out: result.timedOut,
    aborted: result.aborted,
    process_truncated: result.truncated,
    row_present: row !== null,
    row_error: Boolean(row?.error),
    content_sha256: content ? sha(content) : null,
    content_chars: content.length,
    required_terms_found: coverage(content, source.required_terms),
    required_terms_total: source.required_terms.length,
    elapsed_ms: Date.now() - started,
  };
}

const options = parseArgs();
const manifestPath = resolve(typeof options.manifest === "string" ? options.manifest : DEFAULT_MANIFEST);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
validateManifest(manifest);
const manifestSha = sha(stable(manifest));
const source = { probe_sha256: sha(await readFile(SCRIPT_PATH)), ketch_runtime_sha256: sha(await readFile(KETCH_RUNTIME)), ketch_extension_sha256: sha(await readFile(KETCH_EXTENSION)) };
const prepared = { schema: "pi.jina-reader-live-preparation/v1", revision: manifest.revision, manifest_sha256: manifestSha, source, source_ids: manifest.sources.map((item) => item.id), source_url_sha256: manifest.sources.map((item) => sha(normalizedUrl(item.url))), ketch_bin: manifest.ketch_bin, timeout_ms: manifest.timeout_ms, max_chars: manifest.max_chars };
const approvalSha = sha(stable(prepared));
if (options.dry || options.prepare) { console.log(JSON.stringify({ ...prepared, approval_sha256: approvalSha, inference: false }, null, 2)); process.exit(0); }
if (!options.run || options["approve-sha"] !== approvalSha) { console.error("Jina Reader probe approval, manifest, or source binding mismatch"); process.exit(3); }

const artifactRoot = typeof options["artifact-root"] === "string" ? options["artifact-root"] : resolve(process.env.HOME ?? tmpdir(), ".pi", "jina-reader-evals");
const rows = [];
for (const reader of ["ketch", "jina"]) for (const item of manifest.sources) rows.push(await readOne(item, reader, manifest));
const direct = rows.filter((row) => row.reader === "ketch"); const jina = rows.filter((row) => row.reader === "jina");
const directCoverage = direct.reduce((sum, row) => sum + row.required_terms_found, 0); const jinaCoverage = jina.reduce((sum, row) => sum + row.required_terms_found, 0);
const result = { schema: "pi.jina-reader-live-result/v1", run_id: randomUUID(), prepared, approval_sha256: approvalSha, inference: true, rows, comparison: { direct_required_terms_found: directCoverage, jina_required_terms_found: jinaCoverage, direct_elapsed_ms: direct.reduce((sum, row) => sum + row.elapsed_ms, 0), jina_elapsed_ms: jina.reduce((sum, row) => sum + row.elapsed_ms, 0), all_source_identities_match: rows.every((row) => row.returned_source_matches), all_rows_successful: rows.every((row) => row.code === 0 && !row.timed_out && !row.aborted && row.row_present && !row.row_error && row.content_chars > 0), jina_noninferior_term_coverage: jinaCoverage >= directCoverage } };
const artifact = await privateWrite(artifactRoot, `${manifest.revision}-${approvalSha.slice(0, 16)}-${result.run_id}.json`, result);
console.log(JSON.stringify({ ...result, artifact_written: sha(artifact) }, null, 2));
