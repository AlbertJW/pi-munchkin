// Harness self-telemetry: every steer/block/abort/compaction the mechanisms
// fire gets one JSONL row, so false-fire rates and compliance are MEASURED
// instead of discovered by review. Consumers: scripts/telemetry-report.sh and
// (later) the munchkin fitness signal.
//
// Design rules: FAIL-OPEN (a telemetry bug must never break a run — every path
// swallows), tiny (appendFileSync of one short line), and off-switchable
// (TELEMETRY=off). TELEMETRY_FILE overrides the path (tests); rotation keeps
// one .old generation at TELEMETRY_MAX_BYTES (default 5MB).

import { createHash, createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { validateCatalogDetail } from "./telemetry-catalog.ts";


function targetFile(): string | number {
	const fd = process.env.TELEMETRY_FD;
	if (fd && /^\d+$/.test(fd)) return Number(fd);
	return process.env.TELEMETRY_FILE || join(homedir(), ".pi", "agent", "telemetry", "events.jsonl");
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

function normalizeDetail(detail: Record<string, unknown>): { detail: Record<string, unknown>; errors: string[] } {
	const normalized: Record<string, unknown> = {};
	const errors: string[] = [];
	for (const [key, value] of Object.entries(detail)) {
		if (RESERVED_FIELDS.has(key)) continue;
		const safePromptAggregate = key === "system_prompt_sha256" || key === "system_prompt_bytes" || key === "system_prompt_changed";
		if (!safePromptAggregate && FORBIDDEN_DETAIL_FIELD.test(key)) {
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
	if (row.schema === "pi.harness-event/v2") return row.source === "gate" && typeof row.mac === "string";
	return typeof row.mac === "string"; // legacy authenticated rows remain readable
}

function maxBytes(): number {
	const n = Number.parseInt(process.env.TELEMETRY_MAX_BYTES || "", 10);
	return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

function appendRow(row: Record<string, unknown>): void {
	const file = targetFile();
	if (typeof file === "string") {
		mkdirSync(dirname(file), { recursive: true });
		try {
			if (statSync(file).size > maxBytes()) renameSync(file, `${file}.old`);
		} catch {} // no file yet — fine
	}
	appendFileSync(file, `${encodeTelemetryRow(row, MAC_KEY)}\n`);
}

function envelope(ext: string, kind: string, detail: Record<string, unknown>): Record<string, unknown> {
	return {
		schema: "pi.harness-event/v2",
		ts: new Date().toISOString(),
		seq: nextSequence(),
		source: telemetrySource(),
		sk: SESSION_KEY,
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
	if (process.env.TELEMETRY === "off") return; // read per-call (testable, toggleable live)
	const normalized = normalizeDetail(detail);
	const validationErrors = [...normalized.errors, ...validateCatalogDetail(ext, kind, normalized.detail)];
	if (process.env.TELEMETRY_STRICT === "1" && validationErrors.length > 0) {
		throw new Error(`telemetry schema rejected ${ext}/${kind}: ${validationErrors.join("; ")}`);
	}
	try {
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
