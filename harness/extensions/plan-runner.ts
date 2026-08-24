import { chmod, mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { ACTIVE_TOOL_PROMPTS } from "../lib/active-tool-prompts.ts";
import { classifyBashCommand } from "../lib/command-policy.ts";
import { emitHarnessSignal, onHarnessSignal, signalRunId } from "../lib/harness-signals.ts";
import { applyPlanDeltas, type PlanDelta } from "../lib/plan-delta.ts";
import { planStorageMode, privatePlanProjectionPath, privatePlanStatePath, privatePlanTracePath } from "../lib/plan-state-storage.ts";
import { processWriterMarker } from "../lib/process-writer.ts";
import { record } from "../lib/telemetry.ts";

// One bounded ordered checklist. plan_write owns structure; plan_update owns
// status. Project verification is deliberately outside this module.

const MAX_ITEMS = 24;
const MAX_TITLE_BYTES = 120;
const MAX_NOTE_BYTES = 300;
const MAX_PLAN_BYTES = 12 * 1024;
const MAX_DELTAS = 16;
export const FORCE_PLAN_WRITE_DEFAULT: "on" | "off" = "off";
const FORCE_PLAN_WRITE = (process.env.FORCE_PLAN_WRITE ?? FORCE_PLAN_WRITE_DEFAULT) !== "off";
const PLAN_TOOL_GO = process.env.PLAN_TOOL_GO === "on";
const TRACE_TAIL_MAX_BYTES = 64 * 1024;
const PROC_MARK = processWriterMarker();

type ItemStatus = "pending" | "in_progress" | "done" | "blocked";
type Phase = "planned" | "executing";
type Autonomy = "lean" | "yolo";

type PlanItem = {
	id: string;
	title: string;
	note?: string;
	status: ItemStatus;
};

type PlanState = {
	schema_version: 4;
	run_id: string;
	request: string;
	summary: string;
	autonomy: Autonomy;
	phase: Phase;
	created_at: string;
	updated_at: string;
	items: PlanItem[];
	writer?: string;
};

type ModelIdentity = { provider: string; id: string };
let activeModel: ModelIdentity = { provider: "unknown", id: "unknown" };
let api: ExtensionAPI | undefined;
let lastSessionCwd: string | null = null;
let pendingRebind: Promise<void> | null = null;
let awaitingReview = false;
let planningSurfaceBefore: string[] | null = null;
let planningSurfaceApplied: string[] | null = null;

const PLAN_FLAG = "__pi_plan_phase_active";
const EXPLICIT_FLAG = "__pi_tool_selection_explicit";
const SAFE_PLAN_TOOLS = new Set([
	"read", "grep", "find", "ls", "search_spans", "read_span", "recall", "plan_write", "capability",
]);
const MUTATION_TOOLS = new Set(["edit", "write", "multiedit"]);

function rememberModel(ctx: { model?: { provider?: string; id?: string } }): void {
	if (ctx.model?.provider && ctx.model?.id) activeModel = { provider: ctx.model.provider, id: ctx.model.id };
}

function isoNow(): string { return new Date().toISOString(); }
function timestamp(): string { return isoNow().replace(/[:.]/g, "-"); }
function actionId(): string { return randomUUID().slice(0, 8); }
function itemId(): string { return randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase(); }
function exists(path: string): Promise<boolean> { return stat(path).then(() => true, () => false); }
function utf8Bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }

function cleanText(value: unknown): string {
	return String(value ?? "")
		.replace(/\r\n?/g, "\n")
		.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
		.trim();
}

function planEvent(kind: string, runId: string, detail: Record<string, unknown> = {}): void {
	record("plan-runner", kind, { run_id: runId, provider: activeModel.provider, model: activeModel.id, ...detail });
	if (!api) return;
	if (kind === "write" && typeof detail.items === "number" && typeof detail.open_items === "number") {
		emitHarnessSignal(api.events, { v: 1, type: "plan/write", runIdHash: signalRunId(runId), items: detail.items, openItems: detail.open_items });
	}
	if (kind === "go") emitHarnessSignal(api.events, { v: 1, type: "plan/go", runIdHash: signalRunId(runId) });
}

function todoPath(cwd: string): string { return join(cwd, ".pi", "TODO.md"); }
function statePath(cwd: string): string | null {
	return planStorageMode() === "project" ? join(cwd, ".pi", "plan-state.json") : privatePlanStatePath(cwd);
}
function tracePath(cwd: string): string | null {
	return planStorageMode() === "project" ? join(cwd, ".pi", "traces", "plan-runner.jsonl") : privatePlanTracePath(cwd);
}
function usesPrivateStorage(cwd: string): boolean {
	return planStorageMode() === "capsule" && privatePlanStatePath(cwd) !== null;
}

async function atomicWrite(path: string, contents: string, privateFile: boolean): Promise<void> {
	const tmp = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
	if (privateFile) {
		const handle = await open(tmp, "wx", 0o600);
		try { await handle.writeFile(contents, "utf8"); await handle.chmod(0o600); }
		finally { await handle.close(); }
	} else {
		await writeFile(tmp, contents, "utf8");
	}
	try {
		await rename(tmp, path);
		if (privateFile) await chmod(path, 0o600);
	} catch (error) {
		await unlink(tmp).catch(() => undefined);
		throw error;
	}
}

function migrateState(raw: any): PlanState | undefined {
	if (!raw || typeof raw !== "object" || !Array.isArray(raw.items)) return undefined;
	const items: PlanItem[] = raw.items.slice(0, MAX_ITEMS).map((item: any) => ({
		id: typeof item.id === "string" && /^[A-Za-z0-9._:-]{1,96}$/.test(item.id) ? item.id : itemId(),
		title: cleanText(item.title).slice(0, MAX_TITLE_BYTES),
		note: item.note ? cleanText(item.note).slice(0, MAX_NOTE_BYTES) : undefined,
		status: ["pending", "in_progress", "done", "blocked"].includes(item.status) ? item.status : "pending",
	}));
	const now = isoNow();
	return {
		schema_version: 4,
		run_id: typeof raw.run_id === "string" ? raw.run_id : `plan-${timestamp()}`,
		request: cleanText(raw.request || "Migrated plan").slice(0, 1000),
		summary: cleanText(raw.summary || "Migrated bounded plan.").slice(0, 300),
		autonomy: raw.autonomy === "yolo" ? "yolo" : "lean",
		phase: raw.phase === "executing" ? "executing" : "planned",
		created_at: typeof raw.created_at === "string" ? raw.created_at : now,
		updated_at: now,
		items,
		writer: typeof raw.writer === "string" ? raw.writer : undefined,
	};
}

async function readState(cwd: string): Promise<PlanState | undefined> {
	const path = statePath(cwd);
	if (!path || !(await exists(path))) return undefined;
	try { return migrateState(JSON.parse(await readFile(path, "utf8"))); }
	catch { return undefined; }
}

function currentItem(state: PlanState): PlanItem | undefined {
	return state.items.find((item) => item.status === "in_progress") ?? state.items.find((item) => item.status === "pending");
}
function openItemCount(state: PlanState): number { return state.items.filter((item) => item.status !== "done").length; }
function blockedItemCount(state: PlanState): number { return state.items.filter((item) => item.status === "blocked").length; }
function derivedStatus(state: PlanState): string {
	if (state.items.length === 0) return "empty";
	if (state.items.every((item) => item.status === "done")) return "completed";
	if (state.items.every((item) => item.status === "done" || item.status === "blocked")) return "blocked";
	return state.phase === "planned" ? "planned (awaiting /plan-go)" : "executing";
}

function renderTodo(state: PlanState): string {
	const lines = state.items.flatMap((item) => {
		const first = `${item.id}  [${item.status.replace("_", " ")}] ${item.title}`;
		if (!item.note) return [first];
		return [first, ...item.note.split("\n").filter(Boolean).map((line) => `  - ${line.replace(/^[-*]\s*/, "")}`)];
	});
	return [
		"# Active Request", state.request, "", "# Status", derivedStatus(state), "",
		"# Plan Summary", state.summary || "(none)", "", "# Todo", lines.join("\n") || "(none)", "",
		"# Meta", `Phase: ${state.phase}`, `Updated: ${state.updated_at}`, `Run ID: ${state.run_id}`, "",
	].join("\n");
}

function validateStateSize(state: PlanState): void {
	const bytes = utf8Bytes(`${JSON.stringify(state)}\n`);
	if (bytes > MAX_PLAN_BYTES) rejectPlanTool(`plan rejected: authoritative state would be ${bytes} bytes; maximum is ${MAX_PLAN_BYTES}`);
}

async function writeState(cwd: string, state: PlanState): Promise<void> {
	state.updated_at = isoNow();
	state.writer = PROC_MARK;
	validateStateSize(state);
	const path = statePath(cwd);
	if (!path) throw new Error("private plan storage is not ready; retry after session startup");
	const privateFile = usesPrivateStorage(cwd);
	await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : undefined });
	if (privateFile) await chmod(dirname(path), 0o700);
	await atomicWrite(path, `${JSON.stringify(state, null, 2)}\n`, privateFile);
	if (privateFile) {
		const projection = privatePlanProjectionPath(cwd);
		if (!projection) throw new Error("private plan projection is not ready");
		await atomicWrite(projection, renderTodo(state), true);
	}
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id, item_id: currentItem(state)?.id, open_items: openItemCount(state), blocked_items: blockedItemCount(state),
	};
}

async function mutatePlan<T>(cwd: string, fn: (state: PlanState | undefined) => Promise<{ state?: PlanState; result: T }>): Promise<T> {
	const path = statePath(cwd);
	if (!path) throw new Error("private plan storage is not ready; retry after session startup");
	const privateFile = planStorageMode() === "capsule";
	await mkdir(dirname(path), { recursive: true, mode: privateFile ? 0o700 : undefined });
	if (privateFile) await chmod(dirname(path), 0o700);
	return withFileMutationQueue(path, async () => {
		const out = await fn(await readState(cwd));
		if (out.state) await writeState(cwd, out.state);
		return out.result;
	});
}

function rejectPlanTool(text: string): never { throw new Error(text); }

function validateIncoming(items: Array<{ item_id?: string; title: string; note?: string }>): void {
	if (items.length < 1 || items.length > MAX_ITEMS) rejectPlanTool(`plan_write rejected: provide 1-${MAX_ITEMS} top-level items`);
	const ids = new Set<string>();
	for (const [index, item] of items.entries()) {
		const title = cleanText(item.title);
		const note = item.note === undefined ? undefined : cleanText(item.note);
		if (!title) rejectPlanTool(`plan_write rejected: item ${index + 1} has an empty title`);
		if (utf8Bytes(title) > MAX_TITLE_BYTES) rejectPlanTool(`plan_write rejected: item ${index + 1} title exceeds ${MAX_TITLE_BYTES} UTF-8 bytes`);
		if (note !== undefined && utf8Bytes(note) > MAX_NOTE_BYTES) rejectPlanTool(`plan_write rejected: item ${index + 1} note exceeds ${MAX_NOTE_BYTES} UTF-8 bytes`);
		if (item.item_id !== undefined) {
			if (!/^[A-Za-z0-9._:-]{1,96}$/.test(item.item_id)) rejectPlanTool(`plan_write rejected: item ${index + 1} has an invalid item_id`);
			if (ids.has(item.item_id)) rejectPlanTool(`plan_write rejected: duplicate item_id ${item.item_id}`);
			ids.add(item.item_id);
		}
	}
}

function structuralItems(previous: PlanState | undefined, incoming: Array<{ item_id?: string; title: string; note?: string }>): PlanItem[] {
	validateIncoming(incoming);
	const byId = new Map((previous?.items ?? []).map((item) => [item.id, item]));
	const retained = new Set<string>();
	const next = incoming.map((item) => {
		const prior = item.item_id ? byId.get(item.item_id) : undefined;
		if (item.item_id && !prior) rejectPlanTool(`plan_write rejected: unknown item_id ${item.item_id}`);
		if (prior) retained.add(prior.id);
		return {
			id: prior?.id ?? itemId(), title: cleanText(item.title),
			note: item.note === undefined ? prior?.note : (cleanText(item.note) || undefined),
			status: prior?.status ?? "pending",
		} satisfies PlanItem;
	});
	const omitted = (previous?.items ?? []).filter((item) =>
		(item.status === "pending" || item.status === "in_progress") && !retained.has(item.id));
	if (omitted.length) rejectPlanTool(`plan_write rejected: unresolved item_id(s) omitted: ${omitted.map((item) => item.id).join(", ")}. Mark them done or blocked with plan_update first.`);
	return next;
}

function isPlanning(): boolean { return (globalThis as Record<string, unknown>)[PLAN_FLAG] === true; }
function setPlanning(value: boolean): void {
	if (value) (globalThis as Record<string, unknown>)[PLAN_FLAG] = true;
	else delete (globalThis as Record<string, unknown>)[PLAN_FLAG];
}

function enterPlanningSurface(pi: ExtensionAPI): boolean {
	const active = pi.getActiveTools();
	const all = pi.getAllTools().map((tool) => tool.name);
	const explicit = (globalThis as Record<string, unknown>)[EXPLICIT_FLAG] === true;
	const next = explicit ? active.filter((name) => SAFE_PLAN_TOOLS.has(name)) : all.filter((name) => SAFE_PLAN_TOOLS.has(name));
	if (!next.includes("plan_write")) return false;
	planningSurfaceBefore = [...active];
	planningSurfaceApplied = [...next];
	pi.setActiveTools(next);
	return true;
}

function leavePlanningSurface(pi: ExtensionAPI, keepPlanTools: boolean): void {
	const active = pi.getActiveTools();
	if (planningSurfaceApplied && planningSurfaceBefore) {
		const applied = new Set(planningSurfaceApplied);
		const current = new Set(active);
		const manuallyRemoved = new Set(planningSurfaceApplied.filter((name) => !current.has(name)));
		const activatedDuringPlan = active.filter((name) => !applied.has(name));
		const restored = planningSurfaceBefore.filter((name) => !manuallyRemoved.has(name));
		for (const name of activatedDuringPlan) if (!restored.includes(name)) restored.push(name);
		if (keepPlanTools) {
			for (const name of ["plan_write", "plan_update"]) {
				if (!manuallyRemoved.has(name) && pi.getAllTools().some((tool) => tool.name === name) && !restored.includes(name)) restored.push(name);
			}
		}
		pi.setActiveTools(restored);
	}
	planningSurfaceBefore = null;
	planningSurfaceApplied = null;
}

function planPrompt(request: string): string {
	return `MODE: PLAN\nREQUEST:\n${request}\n\nInvestigate with the read-only tools. Then call plan_write once. Use 1-${MAX_ITEMS} short top-level items. Put compact substeps in note, not extra items. Stop after plan_write and wait for /plan-go.`;
}

function executionPrompt(state: PlanState): string {
	const open = state.items.filter((item) => item.status === "pending" || item.status === "in_progress")
		.map((item) => `${item.id} [${item.status}] ${item.title}${item.note ? `\n  ${item.note.replace(/\n/g, "\n  ")}` : ""}`)
		.join("\n");
	return `MODE: RUN\nREQUEST: ${state.request}\nOPEN ITEMS:\n${open || "(none)"}\n\nUse plan_update for status or notes; do not replay the full plan for routine progress. Keep at most one item in_progress. Verify the project once after the latest source mutation before final handoff.`;
}

const planWrite = defineTool({
	name: "plan_write", label: "Write Plan Structure",
	description: `Create or structurally revise a bounded ordered plan of at most ${MAX_ITEMS} top-level items. Status belongs to plan_update.`,
	promptSnippet: "plan_write: create or structurally revise the bounded plan",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Use short top-level items. Put compact substeps in note instead of multiplying items.",
		"Retain item_id when revising an existing item; use plan_update for status changes.",
	] : undefined,
	parameters: Type.Object({
		summary: Type.Optional(Type.String({ maxLength: 300 })),
		items: Type.Array(Type.Object({
			item_id: Type.Optional(Type.String({ minLength: 1, maxLength: 96 })),
			title: Type.String({ minLength: 1, maxLength: 120 }), note: Type.Optional(Type.String({ maxLength: 300 })),
		}), { minItems: 1, maxItems: MAX_ITEMS }),
	}),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		rememberModel(ctx);
		const result = await mutatePlan(ctx.cwd, async (previous) => {
			if (!isPlanning() && !previous && !FORCE_PLAN_WRITE) rejectPlanTool("plan_write is available only after /plan");
			const items = structuralItems(previous, params.items);
			const now = isoNow();
			const state: PlanState = previous ? {
				...previous, summary: params.summary === undefined ? previous.summary : cleanText(params.summary), items,
			} : {
				schema_version: 4, run_id: `plan-${timestamp()}`, request: "Headless plan", summary: cleanText(params.summary),
				autonomy: "lean", phase: isPlanning() ? "planned" : "executing", created_at: now, updated_at: now, items,
			};
			validateStateSize(state);
			return { state, result: state };
		});
		planEvent("write", result.run_id, { items: result.items.length, open_items: openItemCount(result), rewrite: true });
		const listing = result.items.map((item) => `${item.id} ${item.title}`).join("\n");
		return { content: [{ type: "text" as const, text: `Plan saved (${result.items.length}/${MAX_ITEMS} items).\n${listing}\n${isPlanning() ? "Stop now and wait for /plan-go." : "Use plan_update for progress."}` }], details: { tool_name: "plan_write", success: true } };
	},
});

const planUpdate = defineTool({
	name: "plan_update", label: "Update Plan Progress",
	description: "Update status or note for existing plan item IDs. Cannot change structure.",
	promptSnippet: "plan_update: apply small stable-ID status/note deltas",
	promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
		"Send only changed item IDs. Do not replay the full plan for routine progress.",
		"Keep at most one item in_progress; a blocked item needs a short reason in note.",
	] : undefined,
	parameters: Type.Object({ deltas: Type.Array(Type.Object({
		item_id: Type.String({ minLength: 1, maxLength: 96 }),
		status: Type.Optional(Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("done"), Type.Literal("blocked")])),
		note: Type.Optional(Type.String({ maxLength: 300 })),
	}), { minItems: 1, maxItems: MAX_DELTAS }) }),
	async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
		rememberModel(ctx);
		const outcome = await mutatePlan(ctx.cwd, async (previous) => {
			if (!previous) rejectPlanTool("plan_update rejected: no plan exists; start with /plan");
			const applied = applyPlanDeltas(previous.items, params.deltas as PlanDelta[]);
			if (!applied.ok) rejectPlanTool(`plan_update rejected: ${applied.errors.join("; ")}`);
			const state = { ...previous, items: applied.items as PlanItem[] };
			validateStateSize(state);
			return { state, result: { state, changed: applied.changed, idempotent: applied.idempotent } };
		});
		planEvent("delta", outcome.state.run_id, { changed: outcome.changed, idempotent: outcome.idempotent, open_items: openItemCount(outcome.state) });
		return { content: [{ type: "text" as const, text: `Plan updated: ${outcome.changed} changed, ${outcome.idempotent} already current, ${openItemCount(outcome.state)} open.` }], details: { tool_name: "plan_update", success: true } };
	},
});

type GoOutcome = { ok: true; state: PlanState; stale: PlanItem[] } | { ok: false; reason: "no-plan" | "no-open-items" };
async function goTransition(cwd: string): Promise<GoOutcome> {
	return mutatePlan<GoOutcome>(cwd, async (previous) => {
		if (!previous) return { result: { ok: false, reason: "no-plan" } as const };
		if (!previous.items.some((item) => item.status === "pending" || item.status === "in_progress")) return { result: { ok: false, reason: "no-open-items" } as const };
		const stale = previous.writer === PROC_MARK ? [] : previous.items.filter((item) => item.status === "in_progress");
		const state: PlanState = { ...previous, phase: "executing" };
		return { state, result: { ok: true, state, stale } as const };
	});
}

async function clearPlan(cwd: string): Promise<void> {
	const path = statePath(cwd);
	if (path) await withFileMutationQueue(path, async () => {
		await unlink(path).catch(() => undefined);
		const projection = privatePlanProjectionPath(cwd);
		if (projection) await unlink(projection).catch(() => undefined);
	});
	delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
}

async function startPlanCommand(args: string, ctx: any, pi: ExtensionAPI): Promise<void> {
	const request = cleanText(args);
	if (!request) { ctx.ui.notify("Usage: /plan <request>", "error"); return; }
	if (!enterPlanningSurface(pi)) { ctx.ui.notify("Planning cannot start because the explicit tool selection excludes plan_write.", "error"); return; }
	try {
		rememberModel(ctx);
		await clearPlan(ctx.cwd);
		const now = isoNow();
		await writeState(ctx.cwd, {
			schema_version: 4, run_id: `plan-${timestamp()}`, request, summary: "Planning pending.", autonomy: "lean",
			phase: "planned", created_at: now, updated_at: now, items: [],
		});
	} catch (error) {
		leavePlanningSurface(pi, false);
		throw error;
	}
	setPlanning(true);
	awaitingReview = true;
	planEvent("start", `plan-${actionId()}`, { request_bytes: utf8Bytes(request) });
	pi.sendUserMessage(planPrompt(request), { deliverAs: "steer" });
}

async function goCommand(ctx: any, pi: ExtensionAPI): Promise<void> {
	const outcome = await goTransition(ctx.cwd);
	if (!outcome.ok) { ctx.ui.notify(outcome.reason === "no-plan" ? "No plan to run. Start with /plan <request>." : "Plan has no open items.", "error"); return; }
	setPlanning(false);
	awaitingReview = false;
	leavePlanningSurface(pi, true);
	planEvent("go", outcome.state.run_id, { resumed: outcome.stale.length > 0 });
	pi.appendEntry("plan_spine", { run_id: outcome.state.run_id });
	const stale = outcome.stale.length ? `\n\nPreviously in_progress IDs may contain partial work: ${outcome.stale.map((item) => item.id).join(", ")}. Inspect before continuing.` : "";
	pi.sendUserMessage(executionPrompt(outcome.state) + stale, { deliverAs: "steer" });
}

async function rebindActivePlan(cwd: string, notify: (message: string) => void): Promise<void> {
	const state = await readState(cwd);
	if (!state) return;
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id, item_id: currentItem(state)?.id, open_items: openItemCount(state), blocked_items: blockedItemCount(state),
	};
	if (state.writer !== PROC_MARK && openItemCount(state) > 0) notify(`Interrupted plan: ${openItemCount(state)} open item(s). Use /plan-status, /plan-go, or /plan-cancel.`);
}

export async function tailLines(path: string, maxLines: number): Promise<string[]> {
	let handle: Awaited<ReturnType<typeof open>> | null = null;
	try {
		handle = await open(path, "r");
		const info = await handle.stat();
		const length = Math.min(info.size, TRACE_TAIL_MAX_BYTES);
		const buffer = Buffer.alloc(length);
		await handle.read(buffer, 0, length, info.size - length);
		let raw = buffer.toString("utf8");
		if (info.size > length) raw = raw.slice(Math.max(0, raw.indexOf("\n") + 1));
		return raw.split("\n").filter((line) => line.trim()).slice(-maxLines);
	} catch { return []; }
	finally { await handle?.close().catch(() => undefined); }
}

export function policyBlock(_autonomy: Autonomy, subagentAvailable: boolean): string {
	return `Work one bounded plan item at a time. Update status by item ID.${subagentAvailable ? " Delegate only independent, well-scoped work." : ""}`;
}

export default function (pi: ExtensionAPI): void {
	api = pi;
	pi.registerTool(planWrite);
	pi.registerTool(planUpdate);

	if (PLAN_TOOL_GO) {
		pi.registerTool(defineTool({
			name: "plan_go", label: "Start Plan Execution", description: "Headless opt-in: start the saved plan.", parameters: Type.Object({}),
			async execute(_id, _params, _signal, _update, ctx) {
				if (awaitingReview) rejectPlanTool("plan_go rejected: the user must start an interactive /plan with /plan-go");
				const outcome = await goTransition(ctx.cwd);
				if (!outcome.ok) rejectPlanTool(`plan_go rejected: ${outcome.reason}`);
				setPlanning(false);
				planEvent("go", outcome.state.run_id, { resumed: false });
				return { content: [{ type: "text" as const, text: executionPrompt(outcome.state) }], details: { tool_name: "plan_go", success: true } };
			},
		}));
	}

	pi.on("session_start", async (_event, ctx) => {
		setPlanning(false);
		awaitingReview = false;
		planningSurfaceBefore = null;
		planningSurfaceApplied = null;
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		lastSessionCwd = ctx.cwd;
		rememberModel(ctx);
		await rebindActivePlan(ctx.cwd, (message) => ctx.ui.notify(message, "info"));
		if (!FORCE_PLAN_WRITE) {
			const hidden = new Set(["plan_write", "plan_update", "plan_go"]);
			pi.setActiveTools(pi.getActiveTools().filter((name) => !hidden.has(name)));
		}
	});

	onHarnessSignal(pi.events, (signal) => {
		if (signal.type !== "capsule/identity" || !lastSessionCwd) return;
		pendingRebind = rebindActivePlan(lastSessionCwd, () => undefined).catch(() => undefined).finally(() => { pendingRebind = null; });
	});
	pi.on("before_agent_start", async () => { if (pendingRebind) await pendingRebind; });

	pi.registerCommand("plan", { description: "Enter bounded read-only planning for a request.", handler: async (args, ctx) => startPlanCommand(args, ctx, pi) });
	pi.registerCommand("plan-go", { description: "Start or resume execution of the reviewed plan.", handler: async (_args, ctx) => goCommand(ctx, pi) });
	pi.registerCommand("plan-cancel", {
		description: "Discard the active plan and restore the previous tool selection.",
		handler: async (_args, ctx) => {
			await clearPlan(ctx.cwd);
			setPlanning(false);
			awaitingReview = false;
			leavePlanningSurface(pi, false);
			ctx.ui.notify("Plan cancelled.", "info");
		},
	});
	pi.registerCommand("plan-status", { description: "Show the current bounded plan.", handler: async (_args, ctx) => {
		const state = await readState(ctx.cwd);
		ctx.ui.notify(state ? renderTodo(state) : "No current plan found.", "info");
	} });
	pi.registerCommand("plan-export", { description: "Export the private plan to .pi/TODO.md.", handler: async (_args, ctx) => {
		const state = await readState(ctx.cwd);
		if (!state) { ctx.ui.notify("No plan to export.", "info"); return; }
		await mkdir(dirname(todoPath(ctx.cwd)), { recursive: true });
		await atomicWrite(todoPath(ctx.cwd), renderTodo(state), false);
		ctx.ui.notify("Plan exported to .pi/TODO.md.", "info");
	} });
	pi.registerCommand("plan-trace", { description: "Show bounded historical plan trace lines.", handler: async (args, ctx) => {
		const path = tracePath(ctx.cwd);
		const n = Math.min(50, Math.max(1, Number.parseInt(args.trim(), 10) || 10));
		ctx.ui.notify(path ? (await tailLines(path, n)).join("\n") || "No plan trace found." : "No plan trace found.", "info");
	} });

	pi.on("tool_call", async (event) => {
		if (isPlanning() && !SAFE_PLAN_TOOLS.has(event.toolName)) {
			emitHarnessSignal(pi.events, { v: 1, type: "tool/prevented", toolCallId: event.toolCallId, failureClass: "policy_rejection" });
			planEvent("plan-mode-block", `plan-mode-${actionId()}`, { toolName: event.toolName });
			return { block: true, reason: "failure_class=policy_rejection. Planning is read-only. Finish with plan_write, then wait for /plan-go." };
		}
		if (!FORCE_PLAN_WRITE || isPlanning()) return;
		const mutates = MUTATION_TOOLS.has(event.toolName) || (event.toolName === "bash" && classifyBashCommand(String((event.input as any)?.command ?? "")).mutates);
		if (!mutates || !pi.getActiveTools().includes("plan_write")) return;
		const state = lastSessionCwd ? await readState(lastSessionCwd) : undefined;
		if (!state) {
			emitHarnessSignal(pi.events, { v: 1, type: "tool/prevented", toolCallId: event.toolCallId, failureClass: "policy_rejection" });
			return { block: true, reason: "failure_class=policy_rejection. This compatibility mode requires plan_write before source mutation. Set FORCE_PLAN_WRITE=off for explicit /plan-only behavior." };
		}
	});

	pi.on("tool_result", async (event, ctx) => {
		if (!event.isError || (event.toolName !== "plan_write" && event.toolName !== "plan_update")) return;
		const state = await readState(ctx.cwd);
		planEvent("write-rejected", state?.run_id ?? `rejected-${actionId()}`, { reason_class: "schema_or_execution" });
	});

	pi.on("agent_end", async (_event, ctx) => {
		const state = await readState(ctx.cwd);
		if (!state || state.phase !== "executing" || openItemCount(state) === 0) return;
		record("plan-runner", "ended-open", { run_id: state.run_id, open_items: openItemCount(state) });
	});
}
