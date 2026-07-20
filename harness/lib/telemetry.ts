// Harness self-telemetry: every steer/block/abort/compaction the mechanisms
// fire gets one JSONL row, so false-fire rates and compliance are MEASURED
// instead of discovered by review. Consumers: scripts/telemetry-report.sh and
// (later) the munchkin fitness signal.
//
// Design rules: FAIL-OPEN (a telemetry bug must never break a run — every path
// swallows), tiny (appendFileSync of one short line), and off-switchable
// (TELEMETRY=off). TELEMETRY_FILE overrides the path (tests); rotation keeps
// one .old generation at TELEMETRY_MAX_BYTES (default 5MB).

import { createHmac } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";


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
const MAC_KEY = (() => {
	const raw = process.env.TELEMETRY_HMAC_FD;
	if (!raw || !/^\d+$/.test(raw)) return undefined;
	try {
		const key = Buffer.from(readFileSync(Number(raw), "utf8").trim(), "utf8");
		return key.length >= 32 ? key : undefined;
	} catch {
		return undefined;
	}
})();

export function encodeTelemetryRow(row: Record<string, unknown>, key?: string | Buffer): string {
	const payload = JSON.stringify(row);
	if (!key) return payload;
	const mac = createHmac("sha256", key).update(payload).digest("hex");
	return `${payload.slice(0, -1)},"mac":"${mac}"}`;
}

function maxBytes(): number {
	const n = Number.parseInt(process.env.TELEMETRY_MAX_BYTES || "", 10);
	return Number.isFinite(n) && n > 0 ? n : 5 * 1024 * 1024;
}

export function record(ext: string, kind: string, detail: Record<string, unknown> = {}): void {
	if (process.env.TELEMETRY === "off") return; // read per-call (testable, toggleable live)
	try {
		const file = targetFile();
		if (typeof file === "string") {
			mkdirSync(dirname(file), { recursive: true });
			try {
				if (statSync(file).size > maxBytes()) renameSync(file, `${file}.old`);
			} catch {} // no file yet — fine
		}
		appendFileSync(file, `${encodeTelemetryRow({ ts: new Date().toISOString(), sk: SESSION_KEY, ext, kind, ...detail }, MAC_KEY)}\n`);
	} catch {
		// fail open: telemetry must never break the harness
	}
}
