// Harness self-telemetry: every steer/block/abort/compaction the mechanisms
// fire gets one JSONL row, so false-fire rates and compliance are MEASURED
// instead of discovered by review. Consumers: scripts/telemetry-report.sh and
// (later) the munchkin fitness signal.
//
// Design rules: FAIL-OPEN (a telemetry bug must never break a run — every path
// swallows), tiny (appendFileSync of one short line), and off-switchable
// (TELEMETRY=off). TELEMETRY_FILE overrides the path (tests); rotation keeps
// one .old generation at TELEMETRY_MAX_BYTES (default 5MB).

import { createHash, createHmac, randomUUID } from "node:crypto";
import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { validateCatalogDetail } from "./telemetry-catalog.ts";
import { agentDir } from "./agent-dir.ts";
import {
	acknowledgeDroppedTelemetryRows, enqueueTelemetryLine, flushTelemetryWriters,
	pendingDroppedTelemetryRows,
} from "./telemetry-writer.ts";


function targetFile(): string | number {
	const fd = process.env.TELEMETRY_FD;
	if (fd && /^\d+$/.test(fd)) return Number(fd);
	return process.env.TELEMETRY_FILE || join(agentDir(), "telemetry", "events.jsonl");
}

// Exact session attribution: the workdir basename is unique per gate rep
// ($GEN-$MODEL-$pat-$task-$rep), so events JOIN to result rows by key instead
// of by timestamp window — time-joins were contaminated twice by concurrent
// runs (m2s retro-analysis; dual-router sweeps). Captured once at load.
const SESSION_KEY = (() => {
	try {
		return process.cwd().split("/").filter(Boolean).pop() || "unknown";
	} catch {
		return "unknown";
	}
})();

// Authoritative gates pass a random key through a pre-opened descriptor. Pi's
// tool subprocesses do not inherit extra descriptors, and the key never appears
// in argv/environment. Interactive telemetry remains unsigned and diagnostic.
//
// pi's extension loader gives each extension its OWN jiti instance with module
// caching disabled (dist/core/extensions/loader.js: `createJiti(..., {
// moduleCache: false })`, called fresh per extension) — so THIS module's
// top-level code runs once PER EXTENSION, not once per process. Reading the key
// fd directly here would drain it on whichever extension imports this file
// first, leaving every other extension's copy silently unsigned for the rest of
// the run (reproduced live: a context-watcher.ts event went out unsigned while
// later signed events from other extensions succeeded in the same session).
// Resolve the key once and cache it on globalThis — the one thing genuinely
// shared across independently-loaded module instances in the same process —
// the same __pi_* flag-bus idiom already used elsewhere for cross-extension state.
const MAC_KEY_CACHE_FLAG = "__pi_telemetry_mac_key";
function resolveMacKey(): Buffer | undefined {
	const g = globalThis as Record<string, unknown>;
	if (MAC_KEY_CACHE_FLAG in g) {
		const cached = g[MAC_KEY_CACHE_FLAG];
		return cached instanceof Buffer ? cached : undefined;
	}
	const raw = process.env.TELEMETRY_HMAC_FD;
	if (!raw || !/^\d+$/.test(raw)) { g[MAC_KEY_CACHE_FLAG] = null; return undefined; }
	try {
		const key = Buffer.from(readFileSync(Number(raw), "utf8").trim(), "utf8");
		if (key.length >= 32) { g[MAC_KEY_CACHE_FLAG] = key; return key; }
		g[MAC_KEY_CACHE_FLAG] = null;
		return undefined;
	} catch {
		g[MAC_KEY_CACHE_FLAG] = null;
		return undefined;
	}
}
const MAC_KEY = resolveMacKey();

const SEQUENCE_CACHE_FLAG = "__pi_telemetry_sequence_v2";
function nextSequence(): number {
	const shared = globalThis as Record<string, unknown>;
	const previous = typeof shared[SEQUENCE_CACHE_FLAG] === "number" ? shared[SEQUENCE_CACHE_FLAG] as number : 0;
	const next = previous + 1;
	shared[SEQUENCE_CACHE_FLAG] = next;
	return next;
}

// Session identity. `run_id` falls back to the cwd key, so many distinct
// sessions in one directory share it — the collapse that made shadow_report's
// counts incoherent. The first replacement keyed on the PROCESS, which is also
// wrong in both directions: one pi process hosts several sessions (/new, /fork,
// resume) and would collapse them, while a subagent runs in its own process and
// inherits the parent's telemetry destination — splitting one logical session
// into several. So the id is minted at every session_start (beginSession), and
// a subagent records its parent so a consumer can roll children up.
//
//   si  — this session. Changes on every session_start.
//   sp  — parent session id for a subagent, else null. Set from the environment
//         the parent exports, so lineage survives the process boundary.
const SESSION_INSTANCE_FLAG = "__pi_telemetry_session_instance_v2";
export const PARENT_SESSION_ENV = "PI_MUNCHKIN_PARENT_SESSION";

/** Mint a new session identity. Called from session_start; returns the new id. */
export function beginSession(): string {
	const shared = globalThis as Record<string, unknown>;
	const id = randomUUID();
	shared[SESSION_INSTANCE_FLAG] = id;
	return id;
}

/** The current session id, for lineage handoff to a child process. */
export function currentSessionId(): string {
	return sessionInstance();
}

function sessionInstance(): string {
	const shared = globalThis as Record<string, unknown>;
	// A row emitted before any session_start (module load, an early hook) still
	// needs an id; it belongs to whatever session begins next in this process.
	if (typeof shared[SESSION_INSTANCE_FLAG] !== "string") shared[SESSION_INSTANCE_FLAG] = randomUUID();
	return shared[SESSION_INSTANCE_FLAG] as string;
}

function parentSession(): string | null {
	const value = process.env[PARENT_SESSION_ENV];
	return typeof value === "string" && /^[0-9a-f-]{36}$/.test(value) ? value : null;
}

export type TelemetrySource = "test" | "gate" | "interactive" | "unknown";
const KNOWN_SOURCES = new Set<TelemetrySource>(["test", "gate", "interactive"]);

export function telemetrySource(env = process.env): TelemetrySource {
	const source = (env.TELEMETRY_SOURCE || "interactive") as TelemetrySource;
	return KNOWN_SOURCES.has(source) ? source : "unknown";
}

function sha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function classifyError(value: string): string {
	if (/auth|credential|api.?key|unauthor/i.test(value)) return "auth";
	if (/timeout|timed.?out/i.test(value)) return "timeout";
	if (/abort|cancel/i.test(value)) return "aborted";
	if (/permission|denied|eacces/i.test(value)) return "permission";
	if (/not found|enoent/i.test(value)) return "not_found";
	if (/spawn|child process/i.test(value)) return "spawn";
	return "unknown";
}

const FORBIDDEN_DETAIL_FIELD = /(prompt|tool.?output|file.?content|\bcontent\b|url|header|credential|secret|api.?key|exception)/i;
const RESERVED_FIELDS = new Set(["run_id", "provider", "model"]);

/** Exported for the catalog tripwire: a catalog entry whose field name this
 * predicate rejects is a contradiction — every row it describes would be
 * schema-rejected at runtime (measured: provider-patience's `headers_timeout_ms`
 * became a reject stub in the 2026-08-24 live smoke). Same carve-outs as
 * normalizeDetail. */
export function isForbiddenDetailField(key: string): boolean {
	if (key === "system_prompt_sha256" || key === "system_prompt_bytes" || key === "system_prompt_changed") return false;
	if (key === "request_to_headers_ms") return false;
	return FORBIDDEN_DETAIL_FIELD.test(key);
}

function normalizeDetail(detail: Record<string, unknown>): { detail: Record<string, unknown>; errors: string[] } {
	const normalized: Record<string, unknown> = {};
	const errors: string[] = [];
	for (const [key, value] of Object.entries(detail)) {
		if (RESERVED_FIELDS.has(key)) continue;
		const safePromptAggregate = key === "system_prompt_sha256" || key === "system_prompt_bytes" || key === "system_prompt_changed";
		const safeHeaderAggregate = key === "request_to_headers_ms" && (typeof value === "number" || value === null);
		if (!safePromptAggregate && !safeHeaderAggregate && FORBIDDEN_DETAIL_FIELD.test(key)) {
			errors.push(`forbidden field ${key}`);
			continue;
		}
		if (key === "error") {
			const raw = typeof value === "string" ? value : String(value);
			normalized.error_class = classifyError(raw);
			normalized.error_length = Buffer.byteLength(raw, "utf8");
			normalized.error_sha256 = sha256(raw);
			continue;
		}
		normalized[key] = value;
	}
	return { detail: normalized, errors };
}

export function encodeTelemetryRow(row: Record<string, unknown>, key?: string | Buffer): string {
	const payload = JSON.stringify(row);
	if (!key) return payload;
	const mac = createHmac("sha256", key).update(payload).digest("hex");
	return `${payload.slice(0, -1)},"mac":"${mac}"}`;
}

export function isAuthoritativeTelemetryRow(row: Record<string, unknown>): boolean {
	void row;
	// A MAC-shaped raw row is not verifiable after the launcher's ephemeral key
	// disappears. Authority belongs to the gate result pipeline that verifies the
	// HMAC while the key is live, never to this secondary JSONL reader.
	return false;
}

function maxBytes(): number {
	const n = Number.parseInt(process.env.TELEMETRY_MAX_BYTES || "", 10);
	return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

function appendRow(row: Record<string, unknown>): void {
	const file = targetFile();
	const encoded = `${encodeTelemetryRow(row, MAC_KEY)}\n`;
	if (typeof file === "string" && telemetryWriterMode() === "async") {
		enqueueTelemetryLine(file, encoded);
		return;
	}
	if (typeof file === "string") {
		const directory = dirname(file);
		const directoryExisted = existsSync(directory);
		mkdirSync(directory, { recursive: true, mode: 0o700 });
		// Do not tighten a caller-owned pre-existing parent, but every directory
		// created by this writer is private regardless of the process umask.
		if (!directoryExisted) chmodSync(directory, 0o700);
		try {
			if (statSync(file).size > maxBytes()) {
				renameSync(file, `${file}.old`);
				chmodSync(`${file}.old`, 0o600);
			}
		} catch {} // no file yet — fine
	}
	appendFileSync(file, encoded, typeof file === "string" ? { encoding: "utf8", mode: 0o600 } : undefined);
	if (typeof file === "string") chmodSync(file, 0o600);
}

export function telemetryWriterMode(env: NodeJS.ProcessEnv = process.env): "sync" | "async" {
	if (env.TELEMETRY_FD || env.TELEMETRY_SOURCE === "gate") return "sync";
	return env.TELEMETRY_WRITER === "async" ? "async" : "sync";
}

function enqueueOverflowReceipt(file: string): void {
	const dropped = pendingDroppedTelemetryRows(file);
	if (dropped <= 0) return;
	const overflow = {
		...envelope("telemetry", "writer-overflow", {}),
		dropped_rows: dropped,
	};
	// A failed receipt enqueue is not itself an observational row loss;
	// retain the existing count until capacity recovers.
	if (enqueueTelemetryLine(file, `${encodeTelemetryRow(overflow, MAC_KEY)}\n`, false)) {
		acknowledgeDroppedTelemetryRows(file, dropped);
	}
}

export async function flushTelemetry(): Promise<void> {
	await flushTelemetryWriters();
	const file = targetFile();
	if (typeof file === "string" && telemetryWriterMode() === "async") {
		enqueueOverflowReceipt(file);
		await flushTelemetryWriters();
	}
}

function envelope(ext: string, kind: string, detail: Record<string, unknown>): Record<string, unknown> {
	return {
		schema: "pi.harness-event/v2",
		ts: new Date().toISOString(),
		seq: nextSequence(),
		source: telemetrySource(),
		sk: SESSION_KEY,
		si: sessionInstance(),
		sp: parentSession(),
		run_id: typeof detail.run_id === "string" ? detail.run_id : (process.env.PI_RUN_ID || SESSION_KEY),
		provider: typeof detail.provider === "string" ? detail.provider : (process.env.PI_MODEL_PROVIDER || null),
		model: typeof detail.model === "string" ? detail.model : (process.env.PI_MODEL_ID || null),
		harness_surface_sha256: process.env.HARNESS_SURFACE_SHA256 || null,
		config_sha256: process.env.HARNESS_CONFIG_SHA256 || null,
		ext,
		kind,
	};
}

export function record(ext: string, kind: string, detail: Record<string, unknown> = {}): void {
	recordRow(ext, kind, detail);
}

function recordRow(ext: string, kind: string, detail: Record<string, unknown>): void {
	if (process.env.TELEMETRY === "off") return; // read per-call (testable, toggleable live)
	const normalized = normalizeDetail(detail);
	const validationErrors = [...normalized.errors, ...validateCatalogDetail(ext, kind, normalized.detail)];
	if (process.env.TELEMETRY_STRICT === "1" && validationErrors.length > 0) {
		throw new Error(`telemetry schema rejected ${ext}/${kind}: ${validationErrors.join("; ")}`);
	}
	try {
		const target = targetFile();
		if (typeof target === "string" && telemetryWriterMode() === "async") {
			enqueueOverflowReceipt(target);
		}
		if (validationErrors.length > 0) {
			appendRow({
				...envelope("telemetry", "schema-reject", {}),
				rejected_count: 1,
				reason_class: validationErrors.some((error) => error.startsWith("unknown event")) ? "unknown_event" : "invalid_detail",
			});
			return;
		}
		appendRow({ ...envelope(ext, kind, detail), ...normalized.detail });
	} catch {
		// fail open: telemetry must never break the harness
	}
}
