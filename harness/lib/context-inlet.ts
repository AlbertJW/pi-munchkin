import { isAbsolute, resolve } from "node:path";

// These are context-delivery limits, not allocation limits. The measured
// overflow involved two individually-allowed 40–50 KiB reads in one turn; a
// 32 KiB unbounded threshold forces those files onto the existing paged/span
// path before the provider sees their contents.
export const LARGE_FILE_BYTES = 32 * 1024;
export const SUPPORT_FILE_BYTES = 8 * 1024;

export function resolveReadPath(cwd: string, inputPath: string): string {
	return isAbsolute(inputPath) ? inputPath : resolve(cwd, inputPath);
}

export function isPositiveNumber(value: unknown): boolean {
	return typeof value === "number" && Number.isFinite(value) && value > 0;
}

// A big explicit limit on a RISKY file defeats the 8KiB gate (hashline's 50KiB
// byte cap is the only backstop — 6× the intended risky-intake bound). Risky
// reads must page narrowly; CTX_GUARD_RISKY_LINES overrides the page size.
export const RISKY_MAX_LIMIT = (() => {
	const n = Number.parseInt(process.env.CTX_GUARD_RISKY_LINES || "200", 10);
	return Number.isFinite(n) && n > 0 ? n : 200;
})();

export function limitBypassesInletGate(limit: unknown): boolean {
	return typeof limit === "number" && Number.isFinite(limit) && limit > RISKY_MAX_LIMIT;
}

export function limitBypassesRiskyGate(limit: unknown, risky: boolean): boolean {
	return risky && limitBypassesInletGate(limit);
}

const RISKY_EXTENSIONS = new Set([".csv", ".tsv", ".jsonl", ".ndjson", ".log", ".trace", ".parquet"]);
// Low-value bulk content by role. Project-specific markers: CTX_GUARD_RISKY=part1,part2.
const RISKY_MARKERS = ["trace", "session", "dump", "snapshot", "backup", "generated"];
// Source and docs are the work itself: their NAMES never make them risky
// (session-manager.ts, trace-utils.py). Their directory still can (traces/, __snapshots__/).
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go", ".java", ".kt", ".swift", ".c", ".h", ".cc", ".cpp", ".hpp", ".cs", ".rb", ".php", ".scala", ".sh", ".md", ".rst", ".txt", ".toml", ".yaml", ".yml"]);

function markerIn(word: string, markers: readonly string[]): boolean {
	return word.split(/[^a-z0-9]+/).some((token) => markers.some((marker) => token === marker || token === `${marker}s`));
}

/** Large files whose content is usually bulk data: risky extension, a directory named
 * after a marker, or a non-source file whose name contains one. */
export function riskySupportPath(path: string, env: NodeJS.ProcessEnv = process.env): boolean {
	const markers = [...RISKY_MARKERS, ...(env.CTX_GUARD_RISKY || "").split(",").map((part) => part.trim().toLowerCase()).filter(Boolean)];
	const parts = path.toLowerCase().split(/[\\/]+/).filter(Boolean);
	const name = parts.pop() ?? "";
	const ext = name.includes(".") ? name.slice(name.lastIndexOf(".")) : "";
	if (RISKY_EXTENSIONS.has(ext)) return true;
	if (parts.some((dir) => markerIn(dir, markers))) return true;
	return !SOURCE_EXTENSIONS.has(ext) && markerIn(name, markers);
}
