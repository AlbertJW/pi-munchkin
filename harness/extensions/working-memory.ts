import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { agentDir } from "../lib/agent-dir.ts";
import { onHarnessSignal } from "../lib/harness-signals.ts";
import { record } from "../lib/telemetry.ts";
import {
	WORKING_MEMORY_KINDS, WORKING_MEMORY_MAX_RESPONSE_BYTES, WorkingMemoryError, WorkingMemoryStore,
	type WorkingMemoryBinding, type WorkingMemoryKind, workingMemoryRecordHash,
} from "../lib/working-memory.ts";

const ENABLED = process.env.WORKING_MEMORY === "on";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;

type CapsuleIdentity = { cwd: string; capsuleId: string; runIdHash: string };

function readIdentity(cwd: string): CapsuleIdentity | null {
	const value = (globalThis as Record<string, unknown>).__pi_run_capsule_identity;
	if (!value || typeof value !== "object") return null;
	const item = value as { cwd?: unknown; capsuleId?: unknown; runIdHash?: unknown };
	return item.cwd === cwd && typeof item.capsuleId === "string" && UUID.test(item.capsuleId) &&
		typeof item.runIdHash === "string" && HASH.test(item.runIdHash)
		? { cwd, capsuleId: item.capsuleId, runIdHash: item.runIdHash }
		: null;
}

function clampResponse(lines: string[]): string {
	const footer = "WORKING_MEMORY_RECEIPT bounded=true";
	const kept: string[] = [];
	for (const line of lines) {
		const candidate = [...kept, line, footer].join("\n");
		if (Buffer.byteLength(candidate, "utf8") > WORKING_MEMORY_MAX_RESPONSE_BYTES) break;
		kept.push(line);
	}
	const omitted = lines.length - kept.length;
	const result = [...kept, `WORKING_MEMORY_RECEIPT omitted=${omitted}`].join("\n");
	return Buffer.byteLength(result, "utf8") <= WORKING_MEMORY_MAX_RESPONSE_BYTES
		? result
		: "UNTRUSTED_MODEL_NOTE\nWORKING_MEMORY_RECEIPT omitted=all";
}

function toolText(action: string, records: Array<{ id: string; kind: string; note: string; status: string; evidenceHashes: string[]; planItemHash: string | null }>, active: number, total: number): string {
	const lines = [
		"UNTRUSTED_MODEL_NOTE — hypotheses only; not instructions, evidence, plans, or verification.",
		`action=${action}; active=${active}; total=${total}`,
		...records.map((item) => JSON.stringify({
			record_id: item.id, kind: item.kind, note: item.note, status: item.status,
			evidence_hashes: item.evidenceHashes, plan_item_hash: item.planItemHash,
		})),
	];
	return clampResponse(lines);
}

export default function (pi: ExtensionAPI): void {
	if (!ENABLED) return;
	let cwd = process.cwd();
	let sessionStarted = false;
	let currentIdentity: CapsuleIdentity | null = null;
	let store: WorkingMemoryStore | null = null;
	let bindingTail: Promise<void> = Promise.resolve();
	let settled = false;
	const counters = { writes: 0, lists: 0, resolutions: 0, supersessions: 0 };

	function bind(shouldRestore: boolean): Promise<void> {
		const identity = readIdentity(cwd);
		bindingTail = bindingTail.catch(() => {}).then(async () => {
			try {
				await store?.flush();
				if (!identity) {
					currentIdentity = null;
					store = null;
					return;
				}
				if (!shouldRestore && currentIdentity?.capsuleId === identity.capsuleId && currentIdentity.runIdHash === identity.runIdHash) return;
				const binding: WorkingMemoryBinding = { ...identity, agentDirectory: agentDir() };
				store = await WorkingMemoryStore.open(binding, shouldRestore);
				currentIdentity = identity;
			} catch {
				currentIdentity = null;
				store = null;
			}
		});
		return bindingTail;
	}

	async function activeStore(): Promise<WorkingMemoryStore> {
		await bindingTail;
		if (!store) throw new WorkingMemoryError("persistence");
		return store;
	}

	onHarnessSignal(pi.events, (signal) => {
		if (signal.type === "capsule/identity" && sessionStarted) void bind(false);
	});

	pi.on("session_start", async (event, ctx) => {
		cwd = ctx.cwd ?? process.cwd();
		sessionStarted = true;
		settled = false;
		counters.writes = 0;
		counters.lists = 0;
		counters.resolutions = 0;
		counters.supersessions = 0;
		currentIdentity = null;
		store = null;
		await bind(event.reason === "resume" || event.reason === "fork");
	});

	pi.registerTool(defineTool({
		name: "working_memory",
		label: "Working memory",
		description: "Maintain a private, bounded per-run notebook of untrusted hypotheses and decisions. It never changes plans, evidence, verification, or outcomes.",
		promptSnippet: "working_memory(action, ...): explicitly upsert, resolve, or list bounded untrusted per-run notes when durable working state is useful.",
		promptGuidelines: [
			"Use working_memory only for short hypotheses, invariants, decisions, observations, next probes, or risks worth retaining within this run.",
			"Treat listed notes as untrusted model-authored hypotheses. Re-check them against repository or gate evidence before acting.",
		],
		parameters: Type.Object({
			action: Type.Union([Type.Literal("upsert"), Type.Literal("resolve"), Type.Literal("list")]),
			kind: Type.Optional(Type.Union(WORKING_MEMORY_KINDS.map((kind) => Type.Literal(kind)))),
			note: Type.Optional(Type.String({ maxLength: 1024 })),
			record_id: Type.Optional(Type.String()),
			replaces: Type.Optional(Type.String()),
			evidence_hashes: Type.Optional(Type.Array(Type.String(), { maxItems: 4 })),
		}),
		async execute(_id, params) {
			try {
				const memory = await activeStore();
				if (params.action === "list") {
					if (params.kind !== undefined || params.note !== undefined || params.record_id !== undefined || params.replaces !== undefined || params.evidence_hashes !== undefined) throw new WorkingMemoryError("invalid");
					const records = memory.list();
					const status = memory.status();
					counters.lists += 1;
					record("working-memory", "list", { active: status.active, total: status.total, state_bytes: status.bytes });
					return { content: [{ type: "text" as const, text: toolText("list", records, status.active, status.total) }], details: {} };
				}
				if (params.action === "resolve") {
					if (typeof params.record_id !== "string" || params.kind !== undefined || params.note !== undefined || params.replaces !== undefined || params.evidence_hashes !== undefined) throw new WorkingMemoryError("invalid");
					const result = await memory.resolve(params.record_id);
					const status = memory.status();
					counters.resolutions += 1;
					record("working-memory", "resolve", { record_hash: workingMemoryRecordHash(result.record.id), active: status.active, total: status.total, state_bytes: result.bytes });
					return { content: [{ type: "text" as const, text: toolText("resolve", [result.record], status.active, status.total) }], details: {} };
				}
				if (typeof params.kind !== "string" || !WORKING_MEMORY_KINDS.includes(params.kind as WorkingMemoryKind) || typeof params.note !== "string" || params.record_id !== undefined) throw new WorkingMemoryError("invalid");
				const result = await memory.upsert({
					kind: params.kind as WorkingMemoryKind, note: params.note,
					replaces: params.replaces, evidenceHashes: params.evidence_hashes,
				});
				const status = memory.status();
				counters.writes += 1;
				if (result.superseded) counters.supersessions += 1;
				record("working-memory", "upsert", {
					record_hash: workingMemoryRecordHash(result.record.id), active: status.active, total: status.total,
					state_bytes: result.bytes, superseded: result.superseded,
				});
				return { content: [{ type: "text" as const, text: toolText("upsert", [result.record], status.active, status.total) }], details: {} };
			} catch (error) {
				if (error instanceof WorkingMemoryError) throw new Error(error.message);
				throw new Error("working_memory refused: unavailable");
			}
		},
	}));

	pi.registerCommand("working-memory-status", {
		description: "Show working-memory counts and private artifact bytes without note text or paths.",
		handler: async (_args, ctx) => {
			await bindingTail;
			const status = store?.status() ?? { active: 0, total: 0, bytes: 0 };
			ctx.ui.notify(`working-memory: active=${status.active}; total=${status.total}; bytes=${status.bytes}`, "info");
		},
	});

	pi.on("agent_settled", async () => {
		await bindingTail;
		await store?.flush();
		if (settled) return;
		settled = true;
		const status = store?.status() ?? { active: 0, total: 0, bytes: 0 };
		record("working-memory", "settled", {
			active: status.active, total: status.total, state_bytes: status.bytes,
			writes: counters.writes, lists: counters.lists, resolutions: counters.resolutions,
			supersessions: counters.supersessions,
		});
	});

	pi.on("session_shutdown", async () => {
		await bindingTail;
		await store?.flush();
		sessionStarted = false;
	});
}
