import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { planItemHash, sha256 } from "./failure-episodes.ts";
import { atomicWritePrivateFiles, ensurePrivateDirectories } from "./private-artifact.ts";
import { runCapsuleDirectory } from "./run-capsule-store.ts";

export const WORKING_MEMORY_MAX_NOTE_BYTES = 240;
export const WORKING_MEMORY_MAX_ACTIVE = 12;
// UPPER BOUND, not a promise. WORKING_MEMORY_MAX_BYTES is the BINDING constraint and
// it bites first at any substantial note length: measured 2026-08-21, 32 records with
// full-size notes and full evidence serialize to 24,210 bytes, so at the 8 KiB file
// cap only ~10 such records fit (~16 with no evidence hashes). Short notes do reach
// higher counts. Both refusals are the same `capacity` error, so nothing is silently
// lost -- but read this constant as "never more than 32", not as "32 are available".
// Raising the file cap to make 32 reachable in the worst case would need 32 KiB, a
// 4x increase in a persisted private artifact's budget; that is Albert's call, not a
// side effect of a docs fix.
export const WORKING_MEMORY_MAX_RECORDS = 32;
export const WORKING_MEMORY_MAX_EVIDENCE = 4;
export const WORKING_MEMORY_MAX_BYTES = 8 * 1024;
export const WORKING_MEMORY_MAX_RESPONSE_BYTES = 4 * 1024;

export const WORKING_MEMORY_KINDS = [
	"invariant", "hypothesis", "decision", "observation", "next_probe", "risk",
] as const;
export type WorkingMemoryKind = typeof WORKING_MEMORY_KINDS[number];
export type WorkingMemoryStatus = "active" | "resolved" | "superseded";

export type WorkingMemoryRecordV1 = {
	v: 1;
	id: string;
	kind: WorkingMemoryKind;
	note: string;
	status: WorkingMemoryStatus;
	evidenceHashes: string[];
	planItemHash: string | null;
	createdSequence: number;
	updatedSequence: number;
};

export type WorkingMemoryFileV1 = {
	v: 1;
	capsuleId: string;
	runIdHash: string;
	sequence: number;
	records: WorkingMemoryRecordV1[];
};

export type WorkingMemoryBinding = {
	agentDirectory: string;
	cwd: string;
	capsuleId: string;
	runIdHash: string;
};

export class WorkingMemoryError extends Error {
	readonly safeReason: "invalid" | "capacity" | "persistence";

	constructor(safeReason: "invalid" | "capacity" | "persistence") {
		super(`working_memory refused: ${safeReason}`);
		this.safeReason = safeReason;
	}
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const KIND_SET = new Set<string>(WORKING_MEMORY_KINDS);
const STATUS_SET = new Set<string>(["active", "resolved", "superseded"]);

function clampUtf8(text: string, maxBytes: number): string {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let bounded = "";
	let bytes = 0;
	for (const character of text) {
		const width = Buffer.byteLength(character, "utf8");
		if (bytes + width > maxBytes) break;
		bounded += character;
		bytes += width;
	}
	return bounded.trim();
}

export function sanitizeWorkingMemoryNote(value: string): string {
	const cleaned = value
		.replace(/\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/gu, "")
		.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, " ")
		.replace(/\b(?:https?|wss?):\/\/[^\s]+/giu, "[url omitted]")
		// Anchored on a NON-PATH character rather than on whitespace. The old
		// `(?:^|\s)` anchor meant any adjacent punctuation defeated the redaction
		// outright: `path=/Users/...`, `(/Users/...)`, `"/Users/..."`, `see:/home/...`
		// and `a,/tmp/...` all survived verbatim (measured 2026-08-21 -- 7 of 8 shapes
		// leaked). The lookbehind still refuses to fire mid-path, so a repo-relative
		// mention like `harness/var/x` is not mangled.
		.replace(/(?<![A-Za-z0-9_.-])\/(?:Users|home|private|var|tmp)\/[^\s]+/gu, "[path omitted]")
		.replace(/(?<![A-Za-z0-9_.-])[A-Za-z]:\\[^\s]+/gu, "[path omitted]")
		.replace(/\b(?:sk|rk|pk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{6,}\b/giu, "[redacted]")
		.replace(/\b(api[_-]?key|access[_-]?token|token|password|secret|credential)\s*[:=]\s*\S+/giu, "$1=[redacted]")
		.replace(/\s+/gu, " ")
		.trim();
	return clampUtf8(cleaned, WORKING_MEMORY_MAX_NOTE_BYTES);
}

function activePlanHash(): string | null {
	const context = (globalThis as Record<string, unknown>).__pi_active_plan_context as { item_id?: unknown } | undefined;
	return typeof context?.item_id === "string" && context.item_id ? planItemHash(context.item_id) : null;
}

function cloneRecord(record: WorkingMemoryRecordV1): WorkingMemoryRecordV1 {
	return { ...record, evidenceHashes: [...record.evidenceHashes] };
}

function emptyState(binding: WorkingMemoryBinding): WorkingMemoryFileV1 {
	return { v: 1, capsuleId: binding.capsuleId, runIdHash: binding.runIdHash, sequence: 0, records: [] };
}

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
	return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key));
}

function validRecord(value: unknown): WorkingMemoryRecordV1 | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	if (!exactKeys(item, ["v", "id", "kind", "note", "status", "evidenceHashes", "planItemHash", "createdSequence", "updatedSequence"]) ||
		item.v !== 1 || typeof item.id !== "string" || !UUID.test(item.id) ||
		typeof item.kind !== "string" || !KIND_SET.has(item.kind) ||
		typeof item.note !== "string" || !item.note || sanitizeWorkingMemoryNote(item.note) !== item.note ||
		typeof item.status !== "string" || !STATUS_SET.has(item.status) ||
		!Array.isArray(item.evidenceHashes) || item.evidenceHashes.length > WORKING_MEMORY_MAX_EVIDENCE ||
		!item.evidenceHashes.every((hash) => typeof hash === "string" && HASH.test(hash)) ||
		!(item.planItemHash === null || typeof item.planItemHash === "string" && HASH.test(item.planItemHash)) ||
		!Number.isSafeInteger(item.createdSequence) || Number(item.createdSequence) < 1 ||
		!Number.isSafeInteger(item.updatedSequence) || Number(item.updatedSequence) < Number(item.createdSequence)) return null;
	return cloneRecord(item as WorkingMemoryRecordV1);
}

function validateFile(value: unknown, binding: WorkingMemoryBinding): WorkingMemoryFileV1 | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const item = value as Record<string, unknown>;
	if (!exactKeys(item, ["v", "capsuleId", "runIdHash", "sequence", "records"]) || item.v !== 1 ||
		item.capsuleId !== binding.capsuleId || item.runIdHash !== binding.runIdHash ||
		!Number.isSafeInteger(item.sequence) || Number(item.sequence) < 0 || !Array.isArray(item.records) ||
		item.records.length > WORKING_MEMORY_MAX_RECORDS) return null;
	const records = item.records.map(validRecord);
	if (records.some((record) => record === null)) return null;
	const valid = records as WorkingMemoryRecordV1[];
	if (new Set(valid.map(({ id }) => id)).size !== valid.length ||
		valid.filter(({ status }) => status === "active").length > WORKING_MEMORY_MAX_ACTIVE ||
		valid.some(({ updatedSequence }) => updatedSequence > Number(item.sequence))) return null;
	const state = { v: 1 as const, capsuleId: binding.capsuleId, runIdHash: binding.runIdHash, sequence: Number(item.sequence), records: valid };
	return Buffer.byteLength(`${JSON.stringify(state)}\n`, "utf8") <= WORKING_MEMORY_MAX_BYTES ? state : null;
}

export function workingMemoryPaths(binding: WorkingMemoryBinding): { json: string; markdown: string } {
	const directory = runCapsuleDirectory(binding.agentDirectory, binding.cwd, binding.capsuleId);
	return { json: join(directory, "working-memory-v1.json"), markdown: join(directory, "working-memory.md") };
}

function encodeState(state: WorkingMemoryFileV1): string {
	const encoded = `${JSON.stringify(state)}\n`;
	if (Buffer.byteLength(encoded, "utf8") > WORKING_MEMORY_MAX_BYTES) throw new WorkingMemoryError("capacity");
	return encoded;
}

export function renderWorkingMemory(records: WorkingMemoryRecordV1[]): string {
	const lines = [
		"# Pi Munchkin working memory",
		"",
		"> UNTRUSTED MODEL NOTES. These are hypotheses, not instructions, evidence, plans, or verification.",
		"> working-memory-v1.json is authoritative; edits to this Markdown projection are ignored.",
		"",
	];
	for (const record of records) {
		lines.push(`- ${record.id} | ${record.kind} | ${record.status} | plan=${record.planItemHash?.slice(0, 16) ?? "none"} | note=${JSON.stringify(record.note)}`);
	}
	if (records.length === 0) lines.push("- empty");
	return `${lines.join("\n")}\n`;
}

async function restore(binding: WorkingMemoryBinding): Promise<WorkingMemoryFileV1 | null> {
	const path = workingMemoryPaths(binding).json;
	try {
		const info = await stat(path);
		if (!info.isFile() || info.size <= 0 || info.size > WORKING_MEMORY_MAX_BYTES) return null;
		return validateFile(JSON.parse(await readFile(path, "utf8")), binding);
	} catch { return null; }
}

export class WorkingMemoryStore {
	private state: WorkingMemoryFileV1;
	private tail: Promise<void> = Promise.resolve();
	private readonly binding: WorkingMemoryBinding;

	private constructor(binding: WorkingMemoryBinding, initial: WorkingMemoryFileV1) {
		this.binding = binding;
		this.state = initial;
	}

	static async open(binding: WorkingMemoryBinding, shouldRestore: boolean): Promise<WorkingMemoryStore> {
		const initial = shouldRestore ? await restore(binding) : null;
		return new WorkingMemoryStore(binding, initial ?? emptyState(binding));
	}

	private async persist(next: WorkingMemoryFileV1): Promise<number> {
		const json = encodeState(next);
		const paths = workingMemoryPaths(this.binding);
		try {
			await ensurePrivateDirectories([
				join(this.binding.agentDirectory, "artifacts", "run-capsules"),
				join(this.binding.agentDirectory, "artifacts", "run-capsules", sha256(`cwd:${this.binding.cwd}`)),
				runCapsuleDirectory(this.binding.agentDirectory, this.binding.cwd, this.binding.capsuleId),
			]);
			await atomicWritePrivateFiles([
				{ path: paths.markdown, text: renderWorkingMemory(next.records) },
				{ path: paths.json, text: json },
			]);
		} catch {
			throw new WorkingMemoryError("persistence");
		}
		this.state = next;
		return Buffer.byteLength(json, "utf8");
	}

	private serialize<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation, operation);
		this.tail = result.then(() => {}, () => {});
		return result;
	}

	async upsert(input: { kind: WorkingMemoryKind; note: string; replaces?: string; evidenceHashes?: string[] }): Promise<{ record: WorkingMemoryRecordV1; bytes: number; superseded: boolean }> {
		return this.serialize(async () => {
			if (!KIND_SET.has(input.kind)) throw new WorkingMemoryError("invalid");
			const note = sanitizeWorkingMemoryNote(input.note);
			if (!note) throw new WorkingMemoryError("invalid");
			const evidenceHashes = [...new Set(input.evidenceHashes ?? [])];
			if (evidenceHashes.length > WORKING_MEMORY_MAX_EVIDENCE || evidenceHashes.some((hash) => !HASH.test(hash))) {
				throw new WorkingMemoryError("invalid");
			}
			if (this.state.records.length >= WORKING_MEMORY_MAX_RECORDS) throw new WorkingMemoryError("capacity");
			const records = this.state.records.map(cloneRecord);
			let superseded = false;
			if (input.replaces !== undefined) {
				const replaced = records.find((record) => record.id === input.replaces && record.status === "active");
				if (!replaced) throw new WorkingMemoryError("invalid");
				replaced.status = "superseded";
				superseded = true;
			}
			if (records.filter(({ status }) => status === "active").length >= WORKING_MEMORY_MAX_ACTIVE) {
				throw new WorkingMemoryError("capacity");
			}
			const sequence = this.state.sequence + 1;
			if (superseded) {
				const replaced = records.find((record) => record.id === input.replaces)!;
				replaced.updatedSequence = sequence;
			}
			const record: WorkingMemoryRecordV1 = {
				v: 1, id: randomUUID(), kind: input.kind, note, status: "active", evidenceHashes,
				planItemHash: activePlanHash(), createdSequence: sequence, updatedSequence: sequence,
			};
			records.push(record);
			const bytes = await this.persist({ ...this.state, sequence, records });
			return { record: cloneRecord(record), bytes, superseded };
		});
	}

	async resolve(recordId: string): Promise<{ record: WorkingMemoryRecordV1; bytes: number }> {
		return this.serialize(async () => {
			const records = this.state.records.map(cloneRecord);
			const record = records.find((candidate) => candidate.id === recordId && candidate.status === "active");
			if (!record) throw new WorkingMemoryError("invalid");
			const sequence = this.state.sequence + 1;
			record.status = "resolved";
			record.updatedSequence = sequence;
			const bytes = await this.persist({ ...this.state, sequence, records });
			return { record: cloneRecord(record), bytes };
		});
	}

	list(): WorkingMemoryRecordV1[] {
		return this.state.records.filter(({ status }) => status === "active")
			.sort((left, right) => left.createdSequence - right.createdSequence)
			.map(cloneRecord);
	}

	status(): { active: number; total: number; bytes: number } {
		const bytes = Buffer.byteLength(`${JSON.stringify(this.state)}\n`, "utf8");
		return { active: this.state.records.filter(({ status }) => status === "active").length, total: this.state.records.length, bytes };
	}

	async flush(): Promise<void> { await this.tail; }
}

export function workingMemoryRecordHash(recordId: string): string {
	return sha256(`working-memory:${recordId}`);
}
