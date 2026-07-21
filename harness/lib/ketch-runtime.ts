import { spawn } from "node:child_process";

export const MIN_KETCH_VERSION = "0.12.0";
export const DEFAULT_SEARCH_BACKENDS = ["ddg", "exa", "keenable"] as const;

const OUTPUT_CAPTURE_BYTES = 1024 * 1024;
const KILL_GRACE_MS = 1_000;

export type KetchProcessResult = {
	stdout: string;
	stderr: string;
	code: number;
	timedOut: boolean;
	aborted: boolean;
	killed: boolean;
	truncated: boolean;
	spawnError?: string;
};

export type SearchResult = {
	title: string;
	url: string;
	description: string;
	backends: string[];
};

export type ReadResult = {
	title: string;
	url: string;
	markdown: string;
	error?: string;
};

/** Ketch needs its own config/cache paths and optional proxy settings, but it
 * must not inherit model-provider or unrelated repository credentials. */
export function buildKetchEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
	const allowed = new Set([
		"HOME", "LANG", "LC_ALL", "PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "WINDIR",
		"XDG_CACHE_HOME", "XDG_CONFIG_HOME",
		"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY",
		"http_proxy", "https_proxy", "all_proxy", "no_proxy",
	]);
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(source)) {
		if (value === undefined) continue;
		if (allowed.has(key) || key.startsWith("KETCH_")) env[key] = value;
	}
	return env;
}

function terminateTree(proc: ReturnType<typeof spawn>): void {
	if (proc.pid === undefined) return;
	if (process.platform === "win32") {
		const killer = spawn("taskkill", ["/T", "/F", "/PID", String(proc.pid)], { stdio: "ignore" });
		killer.unref();
		return;
	}
	try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill("SIGTERM"); }
	const force = setTimeout(() => {
		if (proc.exitCode !== null || proc.signalCode !== null || proc.pid === undefined) return;
		try { process.kill(-proc.pid, "SIGKILL"); } catch { proc.kill("SIGKILL"); }
	}, KILL_GRACE_MS);
	force.unref();
}

export function runKetchProcess(
	command: string,
	args: string[],
	options: { timeoutMs: number; signal?: AbortSignal; env?: NodeJS.ProcessEnv } = { timeoutMs: 30_000 },
): Promise<KetchProcessResult> {
	return new Promise((resolve) => {
		let stdout: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let stderr: Buffer<ArrayBufferLike> = Buffer.alloc(0);
		let truncated = false;
		let timedOut = false;
		let aborted = false;
		let settled = false;
		let spawnError: string | undefined;
		const proc = spawn(command, args, {
			detached: process.platform !== "win32",
			env: options.env ?? buildKetchEnv(),
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
		});

		const append = (current: Buffer<ArrayBufferLike>, chunk: Buffer<ArrayBufferLike>): Buffer<ArrayBufferLike> => {
			if (current.length >= OUTPUT_CAPTURE_BYTES) { truncated = true; return current; }
			const room = OUTPUT_CAPTURE_BYTES - current.length;
			if (chunk.length > room) truncated = true;
			return Buffer.concat([current, chunk.subarray(0, room)]);
		};
		proc.stdout?.on("data", (chunk: Buffer) => { stdout = append(stdout, chunk); });
		proc.stderr?.on("data", (chunk: Buffer) => { stderr = append(stderr, chunk); });
		proc.on("error", (error) => { spawnError = error.message; });

		const timeout = setTimeout(() => {
			timedOut = true;
			terminateTree(proc);
		}, options.timeoutMs);
		timeout.unref();
		const abort = () => {
			aborted = true;
			terminateTree(proc);
		};
		if (options.signal?.aborted) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });

		const finish = (code: number | null, signal: NodeJS.Signals | null) => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			options.signal?.removeEventListener("abort", abort);
			resolve({
				stdout: stdout.toString("utf8"),
				stderr: stderr.toString("utf8"),
				code: code ?? (spawnError ? 127 : 1),
				timedOut,
				aborted,
				killed: signal !== null || timedOut || aborted,
				truncated,
				...(spawnError ? { spawnError } : {}),
			});
		};
		proc.on("close", finish);
	});
}

export function parseSemver(text: string): [number, number, number] | null {
	const match = /\bv?(\d+)\.(\d+)\.(\d+)\b/.exec(text);
	return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function versionAtLeast(actual: [number, number, number], minimum = MIN_KETCH_VERSION): boolean {
	const required = parseSemver(minimum);
	if (!required) return false;
	for (let i = 0; i < 3; i++) {
		if (actual[i] !== required[i]) return actual[i] > required[i];
	}
	return true;
}

function clean(value: unknown, cap: number): string {
	return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, cap) : "";
}

function parseJson(stdout: string): unknown {
	try { return JSON.parse(stdout); }
	catch { throw new Error("ketch returned malformed JSON"); }
}

function publicHttpUrl(value: unknown): string {
	if (typeof value !== "string" || /[\u0000-\u001f\u007f]/.test(value)) return "";
	try {
		const url = new URL(value.trim());
		if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) return "";
		return url.toString().slice(0, 1_000);
	} catch { return ""; }
}

export function parseSearchResults(stdout: string): SearchResult[] {
	const parsed = parseJson(stdout);
	if (!Array.isArray(parsed)) throw new Error("ketch search returned a non-array payload");
	return parsed.slice(0, 50).flatMap((row): SearchResult[] => {
		if (!row || typeof row !== "object") return [];
		const item = row as Record<string, unknown>;
		const title = clean(item.title, 200);
		const url = publicHttpUrl(item.url);
		const description = clean(item.description || item.content, 600);
		const backends = Array.isArray(item.backends)
			? item.backends.filter((value): value is string => typeof value === "string").map((value) => clean(value, 40)).slice(0, 6)
			: [];
		return title && url ? [{ title, url, description, backends }] : [];
	});
}

export function parseReadResults(stdout: string): ReadResult[] {
	const parsed = parseJson(stdout);
	const rows = Array.isArray(parsed) ? parsed : [parsed];
	return rows.slice(0, 10).flatMap((row): ReadResult[] => {
		if (!row || typeof row !== "object") return [];
		const item = row as Record<string, unknown>;
		const url = publicHttpUrl(item.url);
		if (!url) return [];
		const error = clean(item.error, 300);
		return [{
			title: clean(item.title, 200),
			url,
			markdown: typeof item.markdown === "string" ? item.markdown.trim() : "",
			...(error ? { error } : {}),
		}];
	});
}

export function formatSearchResults(results: SearchResult[], maxChars = 8_000): { text: string; truncated: boolean } {
	const blocks = results.map((result, index) => [
		`${index + 1}. ${result.title}`,
		`URL: ${result.url}`,
		...(result.description ? [`Snippet: ${result.description}`] : []),
		...(result.backends.length ? [`Backends: ${result.backends.join(", ")}`] : []),
	].join("\n"));
	const full = blocks.join("\n\n") || "No web results found.";
	return full.length > maxChars
		? { text: `${full.slice(0, maxChars)}\n…[truncated]`, truncated: true }
		: { text: full, truncated: false };
}

export function formatReadResults(results: ReadResult[], maxChars = 18_000): { text: string; truncated: boolean } {
	if (!results.length) return { text: "No pages were returned.", truncated: false };
	// Headers (which carry the citable URL) are ALWAYS emitted in full — the
	// point of reading is to be able to cite. Only bodies are truncated, and the
	// leftover budget is split evenly across them so a long early page cannot
	// crowd out a later source. There is no blind final slice: a previous version
	// sliced the joined text and silently dropped whole later sources' URLs. In
	// the pathological case where the headers alone exceed maxChars, the output
	// overflows rather than lose a citation — the deliberate tradeoff.
	const SEPARATOR = "\n\n";
	const headers = results.map((result, index) => [
		`SOURCE ${index + 1}`,
		`URL: ${result.url}`,
		...(result.title ? [`Title: ${result.title}`] : []),
	].join("\n"));
	const bodies = results.map((result) => result.error ? `Error: ${result.error}` : `Text:\n${result.markdown || "[empty page]"}`);
	const fixedBytes = headers.reduce((sum, header) => sum + header.length + 1, 0) // +1 for the "\n" before each body
		+ Math.max(0, results.length - 1) * SEPARATOR.length;
	const perBody = Math.floor(Math.max(0, maxChars - fixedBytes) / results.length);
	let truncated = false;
	const blocks = headers.map((header, index) => {
		let body = bodies[index];
		if (body.length > perBody) {
			body = `${body.slice(0, Math.max(0, perBody - 1))}…`;
			truncated = true;
		}
		return `${header}\n${body}`;
	});
	return { text: blocks.join(SEPARATOR), truncated };
}

export function ketchFailureClass(result: KetchProcessResult): string {
	if (result.timedOut) return "timeout";
	if (result.aborted) return "cancelled";
	if (result.spawnError) return /enoent|not found/i.test(result.spawnError) ? "not_found" : "spawn";
	return ({ 2: "validation", 3: "not_found", 4: "upstream", 5: "precondition", 6: "cancelled" } as Record<number, string>)[result.code] ?? "unknown";
}
