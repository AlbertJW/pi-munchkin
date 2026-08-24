import { randomUUID } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { sha256 } from "./failure-episodes.ts";
import { atomicWritePrivateFiles, ensurePrivateDirectories } from "./private-artifact.ts";
import { validateRunStateSnapshot } from "./run-kernel-state.ts";
import type { FailureClass } from "./failure-episodes.ts";
import type { RunStateV1 } from "./run-kernel-types.ts";

export const RUN_STATE_ENTRY_TYPE = "run_state_v1";
export const RUN_STATE_MAX_BYTES = 64 * 1024;
export const RUN_STATE_ENTRY_MAX_BYTES = 48 * 1024;
const MAX_RUN_DIRECTORIES = 64;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;

export type RunCapsuleMode = "off" | "shadow" | "recovery";
export type RunStateEntryV1 = { v: 1; capsuleId: string; state: RunStateV1 };
export type CapsuleWriteResult = {
	ok: boolean;
	stateBytes: number;
	markdownBytes: number;
	failureClass: Extract<FailureClass, "permission" | "timeout" | "unknown"> | null;
};

export function runCapsuleMode(env: NodeJS.ProcessEnv = process.env): RunCapsuleMode {
	// ADOPTED 2026-08-24 (Albert-approved judgment adoption): unset now means
	// RECOVERY. This is AVO's resume-from-state pillar -- inject the bounded typed
	// recovery brief at exactly two seams (compaction, provider retry) instead of
	// making the model reconstruct; a 3-day session hit those seams 4 times under
	// shadow and reconstructed each time. Injection is telemetry-recorded
	// (`recovery-brief` rows). Benefit is NOT established by a powered trial.
	// Rollbacks: RUN_CAPSULE=shadow (persist, never inject) or =off.
	if (env.RUN_CAPSULE === "off" || env.RUN_CAPSULE === "shadow") return env.RUN_CAPSULE;
	return "recovery";
}

export function newCapsuleId(): string {
	return randomUUID();
}

function safeIoClass(error: unknown): CapsuleWriteResult["failureClass"] {
	const code = error && typeof error === "object" ? String((error as { code?: unknown }).code ?? "") : "";
	if (["EACCES", "EPERM", "EROFS"].includes(code)) return "permission";
	if (["ETIMEDOUT", "ETIME"].includes(code)) return "timeout";
	return "unknown";
}

function capsuleRoot(agentDirectory: string, cwd: string): string {
	return join(agentDirectory, "artifacts", "run-capsules", sha256(`cwd:${cwd}`));
}

export function runCapsuleDirectory(agentDirectory: string, cwd: string, capsuleId: string): string {
	if (!UUID.test(capsuleId)) throw new Error("invalid capsule identifier");
	return join(capsuleRoot(agentDirectory, cwd), capsuleId);
}

function encodeState(state: RunStateV1): string {
	const validation = validateRunStateSnapshot(state);
	if (validation.length > 0) throw new Error("run state rejected");
	const encoded = `${JSON.stringify(state)}\n`;
	if (Buffer.byteLength(encoded, "utf8") > RUN_STATE_MAX_BYTES) throw new Error("run state exceeds cap");
	return encoded;
}

export async function writeRunCapsule(input: {
	agentDirectory: string;
	cwd: string;
	capsuleId: string;
	state: RunStateV1;
	markdown: string;
}): Promise<CapsuleWriteResult> {
	let stateText = "";
	try {
		stateText = encodeState(input.state);
	} catch {
		return { ok: false, stateBytes: 0, markdownBytes: 0, failureClass: "unknown" };
	}
	const markdownBytes = Buffer.byteLength(input.markdown, "utf8");
	if (markdownBytes > 24 * 1024) return { ok: false, stateBytes: Buffer.byteLength(stateText), markdownBytes, failureClass: "unknown" };
	const directory = runCapsuleDirectory(input.agentDirectory, input.cwd, input.capsuleId);
	const statePath = join(directory, "state-v1.json");
	const markdownPath = join(directory, "capsule.md");
	try {
		await ensurePrivateDirectories([
			join(input.agentDirectory, "artifacts", "run-capsules"),
			capsuleRoot(input.agentDirectory, input.cwd),
			directory,
		]);
		await atomicWritePrivateFiles([
			{ path: markdownPath, text: input.markdown },
			{ path: statePath, text: stateText },
		]);
		return {
			ok: true,
			stateBytes: Buffer.byteLength(stateText, "utf8"),
			markdownBytes,
			failureClass: null,
		};
	} catch (error) {
		return {
			ok: false,
			stateBytes: Buffer.byteLength(stateText, "utf8"),
			markdownBytes,
			failureClass: safeIoClass(error),
		};
	}
}

function validEntry(value: unknown): RunStateEntryV1 | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	const keys = Object.keys(item);
	if (keys.length !== 3 || !keys.every((key) => ["v", "capsuleId", "state"].includes(key)) ||
		item.v !== 1 || typeof item.capsuleId !== "string" || !UUID.test(item.capsuleId) ||
		validateRunStateSnapshot(item.state).length > 0) return null;
	const entry = item as RunStateEntryV1;
	return Buffer.byteLength(JSON.stringify(entry), "utf8") <= RUN_STATE_ENTRY_MAX_BYTES ? structuredClone(entry) : null;
}

export function makeRunStateEntry(capsuleId: string, state: RunStateV1): RunStateEntryV1 | null {
	return validEntry({ v: 1, capsuleId, state });
}

export function latestRunStateEntry(entries: unknown[]): RunStateEntryV1 | null {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index] as { type?: unknown; customType?: unknown; data?: unknown } | undefined;
		if (entry?.type !== "custom" || entry.customType !== RUN_STATE_ENTRY_TYPE) continue;
		const parsed = validEntry(entry.data);
		if (parsed) return parsed;
	}
	return null;
}

export async function readLatestRunCapsule(agentDirectory: string, cwd: string): Promise<RunStateEntryV1 | null> {
	const root = capsuleRoot(agentDirectory, cwd);
	try {
		const directories = (await readdir(root, { withFileTypes: true }))
			.filter((entry) => entry.isDirectory() && UUID.test(entry.name));
		// Retention is manual in this release. If traversal would exceed the
		// explicit restore budget, fail closed instead of selecting a stale run.
		if (directories.length > MAX_RUN_DIRECTORIES) return null;
		const candidates = await Promise.all(directories.map(async (entry) => {
			const path = join(root, entry.name, "state-v1.json");
			try {
				const info = await stat(path);
				return info.isFile() && info.size > 0 && info.size <= RUN_STATE_MAX_BYTES
					? { capsuleId: entry.name, path, mtimeMs: info.mtimeMs } : null;
			} catch { return null; }
		}));
		// Fail closed on ambiguity: this fallback runs only when session metadata
		// could not name the capsule, so "newest mtime" is a guess — with two
		// concurrent or closely spaced runs, resuming run A could restore run B's
		// state. One valid candidate is a fact; more than one is a coin flip, and
		// the caller's answer to a refused restore is a fresh capsule, which is safe.
		const valid: RunStateEntryV1[] = [];
		for (const candidate of candidates.filter((value): value is NonNullable<typeof value> => value !== null)) {
			try {
				const parsed = JSON.parse(await readFile(candidate.path, "utf8"));
				const entry = validEntry({ v: 1, capsuleId: candidate.capsuleId, state: parsed });
				if (entry) valid.push(entry);
				if (valid.length > 1) return null;
			} catch { /* malformed/incomplete candidates are ignored */ }
		}
		if (valid.length === 1) return valid[0];
	} catch { /* no private capsule root */ }
	return null;
}

export class CapsuleCheckpointQueue {
	private pending: RunStateV1 | null = null;
	private scheduled = false;
	private tail: Promise<void> = Promise.resolve();
	private lastResult: CapsuleWriteResult | null = null;
	private readonly writer: (state: RunStateV1) => Promise<CapsuleWriteResult>;

	constructor(writer: (state: RunStateV1) => Promise<CapsuleWriteResult>) {
		this.writer = writer;
	}

	request(state: RunStateV1): void {
		this.pending = structuredClone(state);
		this.schedule();
	}

	private schedule(): void {
		if (this.scheduled) return;
		this.scheduled = true;
		queueMicrotask(() => {
			this.tail = this.tail.then(() => this.drain(), () => this.drain());
		});
	}

	private async drain(): Promise<void> {
		this.scheduled = false;
		const state = this.pending;
		this.pending = null;
		if (state) this.lastResult = await this.writer(state);
		if (this.pending) this.schedule();
	}

	async flush(): Promise<CapsuleWriteResult | null> {
		while (this.scheduled || this.pending) {
			await Promise.resolve();
			await this.tail;
		}
		await this.tail;
		return this.lastResult;
	}
}
