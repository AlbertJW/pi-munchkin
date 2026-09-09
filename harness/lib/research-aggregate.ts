import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { atomicWriteFile } from "./private-artifact.ts";
import { agentDir } from "./agent-dir.ts";

/**
 * One durable authority for a research run. Graph and evidence-round files are
 * retained as rebuildable compatibility views; this aggregate is the only
 * state that may authorise a new research transition in the new workflow.
 */
export const RESEARCH_AGGREGATE_SCHEMA = "pi.research-aggregate/v1" as const;
export type ResearchAggregatePhase = "active" | "paused" | "awaiting_extension" | "blocked" | "settled";
export type ResearchAggregateBudget = { searches: number; reads: number; validation_reads: number };
export type ResearchAggregateDeadline = { started_at: string; deadline_at: string; discovery_deadline_at: string; paused_ms: number; extension_count: number };
export type ResearchAggregateState = {
	schema: typeof RESEARCH_AGGREGATE_SCHEMA;
	run_id: string;
	revision: number;
	phase: ResearchAggregatePhase;
	graph: Record<string, unknown>;
	evidence_round: Record<string, unknown>;
	budget: ResearchAggregateBudget;
	deadline?: ResearchAggregateDeadline;
	created_at: string;
	updated_at: string;
};

const RUN = /^[A-Za-z0-9._:-]{1,200}$/;
const PHASES = new Set<ResearchAggregatePhase>(["active", "paused", "awaiting_extension", "blocked", "settled"]);
const LOCK_TIMEOUT_MS = 10_000;
const LOCK_RETRY_MS = 20;
const LOCK_STALE_MS = 60_000;
export const RESEARCH_TOTAL_MS = 10 * 60_000;
export const RESEARCH_DISCOVERY_MS = 7 * 60_000;

export class ResearchAggregateError extends Error { readonly code: string; constructor(code: string, message: string) { super(message); this.name = "ResearchAggregateError"; this.code = code; } }

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex"); }
function plainObject(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function finiteInt(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
function validBudget(value: unknown): value is ResearchAggregateBudget {
	return plainObject(value) && finiteInt(value.searches) && finiteInt(value.reads) && finiteInt(value.validation_reads);
}

export function validateResearchAggregate(value: unknown): value is ResearchAggregateState {
	if (!plainObject(value) || Object.keys(value).some((key) => !["schema", "run_id", "revision", "phase", "graph", "evidence_round", "budget", "deadline", "created_at", "updated_at"].includes(key))) return false;
	const deadline = value.deadline;
	const validDeadline = deadline === undefined || (plainObject(deadline) && typeof deadline.started_at === "string" && typeof deadline.deadline_at === "string" && typeof deadline.discovery_deadline_at === "string" && finiteInt(deadline.paused_ms) && finiteInt(deadline.extension_count));
	return value.schema === RESEARCH_AGGREGATE_SCHEMA && typeof value.run_id === "string" && RUN.test(value.run_id) && finiteInt(value.revision) && PHASES.has(value.phase as ResearchAggregatePhase) && plainObject(value.graph) && plainObject(value.evidence_round) && validBudget(value.budget) && validDeadline && typeof value.created_at === "string" && typeof value.updated_at === "string";
}

export function aggregateDigest(state: ResearchAggregateState): string { return digest(state); }

export function deadlineFor(now = Date.now()): ResearchAggregateDeadline {
	const started = new Date(now);
	return { started_at: started.toISOString(), deadline_at: new Date(now + RESEARCH_TOTAL_MS).toISOString(), discovery_deadline_at: new Date(now + RESEARCH_DISCOVERY_MS).toISOString(), paused_ms: 0, extension_count: 0 };
}

export function deadlinePhase(state: ResearchAggregateState, now = Date.now()): "discovery" | "validation" | "expired" {
	if (!state.deadline) return "discovery";
	if (now >= Date.parse(state.deadline.deadline_at)) return "expired";
	return now >= Date.parse(state.deadline.discovery_deadline_at) ? "validation" : "discovery";
}

export function extendDeadline(state: ResearchAggregateState, now = Date.now()): ResearchAggregateState {
	if (!(["paused", "awaiting_extension"] as ResearchAggregatePhase[]).includes(state.phase)) {
		throw new ResearchAggregateError("extension-not-available", "research can only be extended while paused or awaiting extension");
	}
	const prior = state.deadline ?? deadlineFor(now);
	const base = Math.max(now, Date.parse(prior.deadline_at));
	return transitionAggregate(state, { phase: "active", deadline: { ...prior, deadline_at: new Date(base + RESEARCH_TOTAL_MS).toISOString(), discovery_deadline_at: new Date(base + RESEARCH_TOTAL_MS - 3 * 60_000).toISOString(), extension_count: prior.extension_count + 1 } });
}

export function aggregatePath(root: string, runId: string): string {
	if (!RUN.test(runId) || runId === "." || runId === "..") throw new ResearchAggregateError("invalid-run", "research aggregate run identity is invalid");
	return join(root, "research-aggregates", `${runId}.json`);
}

/** Private run-scoped location parallel to the legacy research-round ledger. */
export function researchAggregatePath(cwd: string, runId: string, env: NodeJS.ProcessEnv = process.env): string {
	const root = env.PI_CODING_AGENT_DIR ? join(agentDir(env), "artifacts") : join(cwd, ".pi", "artifacts");
	const cwdDigest = createHash("sha256").update(cwd, "utf8").digest("hex").slice(0, 32);
	if (!RUN.test(runId) || runId === "." || runId === "..") throw new ResearchAggregateError("invalid-run", "research aggregate run identity is invalid");
	return join(root, "research-aggregates", `${cwdDigest}-${runId}.json`);
}

export function createResearchAggregate(input: Omit<ResearchAggregateState, "schema" | "revision" | "created_at" | "updated_at"> & { now?: string }): ResearchAggregateState {
	const now = input.now ?? new Date().toISOString();
	const state: ResearchAggregateState = { schema: RESEARCH_AGGREGATE_SCHEMA, run_id: input.run_id, revision: 0, phase: input.phase, graph: structuredClone(input.graph), evidence_round: structuredClone(input.evidence_round), budget: { ...input.budget }, ...(input.deadline ? { deadline: { ...input.deadline } } : {}), created_at: now, updated_at: now };
	if (!validateResearchAggregate(state)) throw new ResearchAggregateError("invalid-state", "refusing to create an invalid research aggregate");
	return state;
}

export function migrateResearchPair(graph: unknown, evidenceRound: unknown, now = new Date().toISOString()): ResearchAggregateState {
	if (!plainObject(graph) || typeof graph.run_id !== "string" || !RUN.test(graph.run_id)) throw new ResearchAggregateError("invalid-graph", "graph is missing a valid run identity");
	if (!plainObject(evidenceRound) || typeof evidenceRound.run_id !== "string" || !RUN.test(evidenceRound.run_id)) throw new ResearchAggregateError("invalid-evidence", "evidence round is missing a valid run identity");
	if (graph.run_id !== evidenceRound.run_id) throw new ResearchAggregateError("identity-mismatch", "graph and evidence round belong to different research runs");
	const budgetValue = plainObject(evidenceRound.budget) && plainObject(evidenceRound.budget.consumed) ? evidenceRound.budget.consumed : evidenceRound.budget;
	const budget = validBudget(budgetValue)
		? { ...budgetValue }
		: { searches: 0, reads: 0, validation_reads: 0 };
	const rawStatus = typeof evidenceRound.status === "string" ? evidenceRound.status : "active";
	const phase: ResearchAggregatePhase = rawStatus === "settled" ? "settled" : rawStatus === "blocked" ? "blocked" : rawStatus === "deferred" ? "awaiting_extension" : "active";
	return createResearchAggregate({ run_id: graph.run_id, phase, graph, evidence_round: evidenceRound, budget, now });
}

type Lock = { path: string; id: string };
async function acquire(path: string): Promise<Lock> {
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await chmod(dirname(path), 0o700);
	const lockPath = `${path}.lock`, deadline = Date.now() + LOCK_TIMEOUT_MS;
	while (Date.now() <= deadline) {
		const id = `${process.pid}:${Date.now()}:${Math.random()}`;
		try {
			const handle = await open(lockPath, "wx", 0o600);
			try { await handle.writeFile(`${JSON.stringify({ pid: process.pid, id, created_at: new Date().toISOString() })}\n`); await handle.sync(); } finally { await handle.close(); }
			return { path: lockPath, id };
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			let stale = false;
			try {
				const owner = JSON.parse(await readFile(lockPath, "utf8")) as { pid?: unknown; created_at?: unknown };
				if (typeof owner.pid === "number") { try { process.kill(owner.pid, 0); } catch (probe) { stale = (probe as NodeJS.ErrnoException).code !== "EPERM"; } }
				if (!stale && typeof owner.created_at === "string") stale = Date.now() - Date.parse(owner.created_at) > LOCK_STALE_MS;
			} catch { /* age below decides whether malformed lock is recoverable */ }
			if (stale) { await unlink(lockPath).catch(() => undefined); continue; }
			await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}
	throw new ResearchAggregateError("busy", "research aggregate is busy in another process");
}
async function release(lock: Lock): Promise<void> { try { const value = JSON.parse(await readFile(lock.path, "utf8")); if (value.id === lock.id) await unlink(lock.path); } catch { /* another owner recovered it */ } }

export async function readResearchAggregate(path: string): Promise<ResearchAggregateState | null> {
	try { const state: unknown = JSON.parse(await readFile(path, "utf8")); return validateResearchAggregate(state) ? structuredClone(state) : null; }
	catch { return null; }
}
export async function writeResearchAggregate(path: string, state: ResearchAggregateState): Promise<void> {
	if (!validateResearchAggregate(state)) throw new ResearchAggregateError("invalid-state", "refusing to write an invalid research aggregate");
	await atomicWriteFile(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, directoryMode: 0o700 });
}
export async function mutateResearchAggregate<T>(path: string, fn: (state: ResearchAggregateState) => { state: ResearchAggregateState; result: T } | Promise<{ state: ResearchAggregateState; result: T }>): Promise<T> {
	const lock = await acquire(path);
	try {
		const current = await readResearchAggregate(path);
		if (!current) throw new ResearchAggregateError("missing", "research aggregate is missing or malformed");
		const out = await fn(structuredClone(current));
		if (!validateResearchAggregate(out.state) || out.state.run_id !== current.run_id || out.state.revision !== current.revision + 1) throw new ResearchAggregateError("invalid-transition", "aggregate transition must increment revision exactly once and preserve run identity");
		out.state.updated_at = new Date().toISOString();
		await writeResearchAggregate(path, out.state);
		return out.result;
	} finally { await release(lock); }
}

export function transitionAggregate(state: ResearchAggregateState, patch: Partial<Pick<ResearchAggregateState, "phase" | "graph" | "evidence_round" | "budget" | "deadline">>, now = new Date().toISOString()): ResearchAggregateState {
	const next: ResearchAggregateState = { ...state, revision: state.revision + 1, updated_at: now, ...(patch.phase === undefined ? {} : { phase: patch.phase }), ...(patch.graph === undefined ? {} : { graph: structuredClone(patch.graph) }), ...(patch.evidence_round === undefined ? {} : { evidence_round: structuredClone(patch.evidence_round) }), ...(patch.budget === undefined ? {} : { budget: { ...patch.budget } }), ...(patch.deadline === undefined ? {} : { deadline: { ...patch.deadline } }) };
	if (!validateResearchAggregate(next)) throw new ResearchAggregateError("invalid-transition", "aggregate transition is invalid");
	return next;
}

export function isExecutableResearchAggregate(state: ResearchAggregateState | null): state is ResearchAggregateState { return Boolean(state && state.phase === "active"); }
