import { mkdir, open, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";

type WriterState = {
	file: string;
	queue: string[];
	queuedBytes: number;
	dropped: number;
	scheduled: boolean;
	tail: Promise<void>;
};

const WRITERS_KEY = "__pi_telemetry_async_writers_v1";

function writers(): Map<string, WriterState> {
	const global = globalThis as Record<string, unknown>;
	if (!(global[WRITERS_KEY] instanceof Map)) global[WRITERS_KEY] = new Map<string, WriterState>();
	return global[WRITERS_KEY] as Map<string, WriterState>;
}

function envInt(name: string, fallback: number, min: number, max: number): number {
	const parsed = Number.parseInt(process.env[name] ?? "", 10);
	return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function stateFor(file: string): WriterState {
	const all = writers();
	let state = all.get(file);
	if (!state) {
		state = { file, queue: [], queuedBytes: 0, dropped: 0, scheduled: false, tail: Promise.resolve() };
		all.set(file, state);
	}
	return state;
}

async function appendPrivate(file: string, text: string, maxFileBytes: number): Promise<void> {
	const directory = dirname(file);
	await mkdir(directory, { recursive: true, mode: 0o700 });
	try {
		if ((await stat(file)).size + Buffer.byteLength(text, "utf8") > maxFileBytes) {
			try { await rename(file, `${file}.old`); } catch { /* best-effort single generation */ }
		}
	} catch { /* file absent */ }
	const handle = await open(file, "a", 0o600);
	try {
		await handle.writeFile(text, "utf8");
		await handle.chmod(0o600);
	} finally {
		await handle.close();
	}
}

async function drain(state: WriterState): Promise<void> {
	state.scheduled = false;
	const maxRows = envInt("TELEMETRY_ASYNC_BATCH_ROWS", 64, 1, 512);
	const maxFileBytes = envInt("TELEMETRY_MAX_BYTES", 5 * 1024 * 1024, 1024, 1024 * 1024 * 1024);
	const maxBatchBytes = Math.min(maxFileBytes, envInt("TELEMETRY_ASYNC_BATCH_BYTES", 64 * 1024, 1024, 1024 * 1024));
	const batch: string[] = [];
	let bytes = 0;
	while (state.queue.length > 0 && batch.length < maxRows) {
		const next = state.queue[0];
		const nextBytes = Buffer.byteLength(next, "utf8");
		if (batch.length > 0 && bytes + nextBytes > maxBatchBytes) break;
		state.queue.shift();
		state.queuedBytes -= nextBytes;
		batch.push(next);
		bytes += nextBytes;
	}
	if (batch.length > 0) {
		try {
			await appendPrivate(state.file, batch.join(""), maxFileBytes);
		} catch {
			state.dropped += batch.length;
		}
	}
	if (state.queue.length > 0) schedule(state);
}

function schedule(state: WriterState): void {
	if (state.scheduled) return;
	state.scheduled = true;
	queueMicrotask(() => {
		state.tail = state.tail.then(() => drain(state), () => drain(state));
	});
}

export function enqueueTelemetryLine(file: string, line: string, countDrop = true): boolean {
	const state = stateFor(file);
	const bytes = Buffer.byteLength(line, "utf8");
	const maxRows = envInt("TELEMETRY_ASYNC_MAX_ROWS", 1024, 8, 65_536);
	const maxBytes = envInt("TELEMETRY_ASYNC_MAX_BYTES", 1024 * 1024, 4096, 64 * 1024 * 1024);
	if (bytes > maxBytes || state.queue.length >= maxRows || state.queuedBytes + bytes > maxBytes) {
		if (countDrop) state.dropped += 1;
		return false;
	}
	state.queue.push(line);
	state.queuedBytes += bytes;
	schedule(state);
	return true;
}

export function pendingDroppedTelemetryRows(file: string): number {
	return stateFor(file).dropped;
}

export function acknowledgeDroppedTelemetryRows(file: string, count: number): void {
	const state = stateFor(file);
	state.dropped = Math.max(0, state.dropped - Math.max(0, Math.trunc(count)));
}

export async function flushTelemetryWriters(): Promise<void> {
	const all = writers();
	for (const [file, state] of all) {
		while (state.scheduled || state.queue.length > 0) {
			await Promise.resolve();
			await state.tail;
		}
		await state.tail;
		if (state.queue.length === 0 && !state.scheduled && state.dropped === 0) all.delete(file);
	}
}
