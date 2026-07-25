import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, normalize, sep } from "node:path";
import { defineTool, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { classifyBashCommand } from "./command-policy.ts";
import {
	buildCapabilitySnapshot,
	nextReflectionStage,
	renderContextMarkdown,
	renderPlanMarkdown,
	renderStepMarkdown,
	stepFileName,
	validateReflectionAppend,
	validateV4Plan,
	type CapabilitySnapshot,
	type PlanStepV4,
	type ReflectionRecord,
	type StepStatusV4,
	type TestReceipt,
} from "./plan-synthesis.ts";
import {
	backtrackAndStale,
	nextRouteStreak,
	rankEligibleSteps,
	routeFingerprint,
	tddEvidenceErrors,
	testReceipt,
	validateRouteTarget,
} from "./plan-router.ts";
import { processWriterMarker } from "./process-writer.ts";
import { record } from "./telemetry.ts";
import { agentDir } from "./agent-dir.ts";

type Autonomy = "lean" | "yolo";
type Phase = "reflecting" | "planned" | "executing";
type ContextMode = "off" | "current" | "spawn";
type ReviewState = {
	status: "pending" | "approved" | "rejected";
	request_id: string;
	review_id?: string;
	content_sha256: string;
	feedback?: string;
	updated_at: string;
};
type RouteState = {
	selected_step_id?: string;
	checkpoint_required?: string;
	history: Array<{ at: string; action: string; target?: string; reason: string }>;
	fingerprint?: string;
	no_progress_streak: number;
	invalidated_assumptions: string[];
};
export type PlanStateV4 = {
	schema_version: 4;
	run_id: string;
	request: string;
	summary: string;
	autonomy: Autonomy;
	phase: Phase;
	created_at: string;
	updated_at: string;
	writer?: string;
	reflections: ReflectionRecord[];
	capability_snapshot: CapabilitySnapshot;
	items: PlanStepV4[];
	final_validation: string;
	final_receipt?: TestReceipt;
	route: RouteState;
	review?: ReviewState;
	test_exceptions_approved?: boolean;
};

const PROC_MARK = processWriterMarker();
const PLANNOTATOR_TIMEOUT_MS = Math.max(100, Number.parseInt(process.env.PLAN_REVIEW_TIMEOUT_MS || "1200", 10) || 1200);
const ROUTE_STREAK_MAX = 3;
// c44/c45 paired profile switch. "off" is the c40-c43 neutral setting;
// "current" lets the parent mutate, "spawn" requires one explicit executor.
const CONTEXT_MODE = (["off", "current", "spawn"].includes(process.env.PLAN_STEP_CONTEXT ?? "")
	? process.env.PLAN_STEP_CONTEXT
	: "off") as ContextMode;
// c41: observed command/result evidence, never self-reported completion.
const TDD_EVIDENCE = process.env.PLAN_TDD_EVIDENCE === "on";
// c42: model-owned partial-order routing; this module validates but dispatches nothing.
const DYNAMIC_ROUTE = process.env.PLAN_DYNAMIC_ROUTE === "on";
// c43: explicit-only shared event bridge; absent listeners fail boundedly.
const PLANNOTATOR_BRIDGE = process.env.PLAN_PLANNOTATOR_BRIDGE === "on";
const pendingTestCalls = new Map<string, { cwd: string; stepId: string; command: string }>();
const pendingSubagentCalls = new Map<string, { cwd: string; stepId: string; parentInput: number }>();
const reviewRequestCwds = new Map<string, string>();
const latestPrompts = new Map<string, string>();

function isoNow(): string {
	return new Date().toISOString();
}

function timestamp(): string {
	return isoNow().replace(/[:.]/g, "-");
}

function statePath(cwd: string): string {
	return join(cwd, ".pi", "plan-state.json");
}

function todoPath(cwd: string): string {
	return join(cwd, ".pi", "TODO.md");
}

function tracePath(cwd: string): string {
	return join(cwd, ".pi", "traces", "plan-runner.jsonl");
}

function planDir(cwd: string, runId: string): string {
	return join(cwd, ".pi", "plans", runId);
}

function safeRunId(value: string): boolean {
	return /^plan-[a-zA-Z0-9._-]+$/.test(value);
}

function safeRelativePath(value: string): boolean {
	if (!value.trim() || isAbsolute(value)) return false;
	const normalized = normalize(value);
	return normalized !== ".." && !normalized.startsWith(`..${sep}`) && !normalized.split(sep).includes("..");
}

function compactText(value: unknown, max = 500): string {
	return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function identifierSha256(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function textContent(content: Array<{ type?: string; text?: string }>): string {
	return content.filter((item) => item.type === "text").map((item) => item.text ?? "").join("\n");
}

function subagentCommandReceipts(details: Record<string, unknown>, command: string): TestReceipt[] {
	const receipts: TestReceipt[] = [];
	const results = Array.isArray(details.results) ? details.results as Array<Record<string, unknown>> : [];
	for (const result of results) {
		const calls = new Map<string, string>();
		const messages = Array.isArray(result.messages) ? result.messages as Array<Record<string, unknown>> : [];
		for (const message of messages) {
			const role = message.role;
			const content = Array.isArray(message.content) ? message.content as Array<Record<string, unknown>> : [];
			if (role === "assistant") {
				for (const item of content) {
					if (item.type === "toolCall" && item.name === "bash") {
						const args = item.arguments && typeof item.arguments === "object" ? item.arguments as Record<string, unknown> : {};
						calls.set(String(item.id ?? ""), compactText(args.command, 500));
					}
				}
			} else if (role === "toolResult" && calls.get(String(message.toolCallId ?? "")) === command) {
				receipts.push(testReceipt(
					command,
					message.isError ? 1 : 0,
					textContent(content as Array<{ type?: string; text?: string }>),
				));
			}
		}
	}
	return receipts;
}

function activeStep(state: PlanStateV4): PlanStepV4 | undefined {
	return state.items.find((step) => step.id === state.route.selected_step_id)
		?? state.items.find((step) => step.status === "in_progress");
}

function finalEvidenceError(state: PlanStateV4): string | undefined {
	if (!state.items.every((step) => step.status === "done")) return undefined;
	if (!state.final_receipt || state.final_receipt.exit_code !== 0 || state.final_receipt.command !== state.final_validation) {
		return `plan completion requires a passing receipt for final_validation: ${state.final_validation}`;
	}
	return undefined;
}

function completionEvidenceErrors(step: PlanStepV4): string[] {
	if (step.kind === "behavior" && step.test) return tddEvidenceErrors(step);
	const command = step.test_exception?.validation ?? step.validation;
	if (!command) return [];
	if (!step.green_receipt || step.green_receipt.exit_code !== 0 || step.green_receipt.command !== command) {
		return [`step "${step.title}" requires a passing validation receipt for: ${command}`];
	}
	return [];
}

function planStatus(state: PlanStateV4): string {
	if (state.items.length === 0) return state.phase;
	if (state.items.every((step) => step.status === "done")) return "completed";
	if (state.items.some((step) => step.status === "stale")) return "stale";
	if (state.items.some((step) => step.status === "blocked") &&
		!state.items.some((step) => step.status === "pending" || step.status === "in_progress")) return "blocked";
	return state.phase;
}

function compatibilityTodo(state: PlanStateV4): string {
	const mark: Record<StepStatusV4, string> = { pending: " ", in_progress: "~", done: "x", blocked: "!", stale: "?" };
	return [
		"# Active Request",
		state.request,
		"",
		"# Status",
		planStatus(state),
		"",
		"# Plan Summary",
		state.summary,
		"",
		"# Todo",
		...state.items.map((step) =>
			`- [${mark[step.status]}] ${step.title}${step.hard_depends_on.length ? ` (after: ${step.hard_depends_on.join("; ")})` : ""}${step.stale_reason ? ` — ${step.stale_reason}` : ""}`),
		"",
		"# Meta",
		"Schema: 4",
		`Phase: ${state.phase}`,
		`Run ID: ${state.run_id}`,
		`Capability snapshot: ${state.capability_snapshot.sha256}`,
		`Current route: ${state.route.selected_step_id ?? "(none)"}`,
		"",
	].join("\n");
}

async function appendReceipt(cwd: string, state: PlanStateV4, kind: string, detail: Record<string, unknown>): Promise<void> {
	const path = tracePath(cwd);
	await mkdir(dirname(path), { recursive: true });
	const row = {
		timestamp: isoNow(),
		run_id: state.run_id,
		action_type: "tool",
		tool_name: kind,
		success: detail.success !== false,
		...detail,
	};
	await appendFile(path, `${JSON.stringify(row)}\n`, "utf8");
}

async function readV4(cwd: string): Promise<PlanStateV4 | undefined> {
	try {
		const raw = JSON.parse(await readFile(statePath(cwd), "utf8"));
		return raw?.schema_version === 4 && Array.isArray(raw.items) ? raw as PlanStateV4 : undefined;
	} catch {
		return undefined;
	}
}

async function runtimeStatusText(ctx: { model?: { provider?: string; id?: string } }): Promise<string> {
	let settings: any = {};
	let models: any = {};
	try { settings = JSON.parse(await readFile(join(agentDir(), "settings.json"), "utf8")); } catch {}
	try { models = JSON.parse(await readFile(join(agentDir(), "models.json"), "utf8")); } catch {}
	const provider = ctx.model?.provider ?? settings.defaultProvider ?? "unknown";
	const model = ctx.model?.id ?? settings.defaultModel ?? "unknown";
	const providerCfg = models.providers?.[provider];
	return [
		`Active provider: ${provider}`,
		`Active model: ${model}`,
		`Configured default provider: ${settings.defaultProvider ?? "unknown"}`,
		`Configured default model: ${settings.defaultModel ?? "unknown"}`,
		`Base URL: ${providerCfg?.baseUrl ?? "not configured for selected provider"}`,
		`API: ${providerCfg?.api ?? "unknown"}`,
		`Default thinking: ${settings.defaultThinkingLevel ?? "unknown"}`,
		`Compaction: ${settings.compaction?.enabled ? "enabled" : "disabled"}`,
		`Keep recent tokens: ${settings.compaction?.keepRecentTokens ?? "unknown"}`,
	].join("\n");
}

function planContentSha(state: PlanStateV4): string {
	// Bind review to authored plan content, not execution bookkeeping. Status,
	// receipts, route history, timestamps, and notes change during a normal run
	// and must not invalidate approval or make restart/resume impossible.
	const material = JSON.stringify({
		request: state.request,
		reflections: state.reflections,
		capability_snapshot_sha256: state.capability_snapshot.sha256,
		final_validation: state.final_validation,
		steps: state.items.map((step) => ({
			id: step.id,
			order: step.order,
			title: step.title,
			kind: step.kind,
			objective: step.objective,
			acceptance: step.acceptance,
			covers: step.covers,
			hard_depends_on: step.hard_depends_on,
			soft_after: step.soft_after,
			required_capabilities: step.required_capabilities,
			capability_fallback: step.capability_fallback,
			risk: step.risk,
			information_value: step.information_value,
			effort: step.effort,
			expected_files: step.expected_files,
			invalidated_by: step.invalidated_by,
			test: step.test,
			test_exception: step.test_exception,
			validation: step.validation,
		})),
	});
	return createHash("sha256").update(material).digest("hex");
}

async function writeArtifacts(cwd: string, state: PlanStateV4): Promise<void> {
	if (!safeRunId(state.run_id)) throw new Error(`unsafe plan run id: ${state.run_id}`);
	const dir = planDir(cwd, state.run_id);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "CONTEXT.md"), renderContextMarkdown(
		state.request,
		state.reflections,
		state.capability_snapshot,
		state.items,
		Boolean(state.test_exceptions_approved),
	), "utf8");
	await writeFile(join(dir, "PLAN.md"), renderPlanMarkdown(state.request, state.summary, state.items, state.capability_snapshot, state.route.selected_step_id), "utf8");
	for (const step of state.items) {
		await writeFile(join(dir, stepFileName(step)), renderStepMarkdown(step), "utf8");
	}
}

async function writeV4(cwd: string, state: PlanStateV4): Promise<void> {
	state.updated_at = isoNow();
	state.writer = PROC_MARK;
	await mkdir(dirname(statePath(cwd)), { recursive: true });
	await writeFile(statePath(cwd), `${JSON.stringify(state, null, 2)}\n`, "utf8");
	await writeFile(todoPath(cwd), compatibilityTodo(state), "utf8");
	await writeArtifacts(cwd, state);
	(globalThis as Record<string, unknown>).__pi_active_plan_context = {
		run_id: state.run_id,
		item_id: activeStep(state)?.id,
	};
}

async function mutateV4(
	cwd: string,
	fn: (state: PlanStateV4 | undefined) => Promise<{ state?: PlanStateV4; result: any }>,
): Promise<any> {
	const path = statePath(cwd);
	await mkdir(dirname(path), { recursive: true });
	return withFileMutationQueue(path, async () => {
		const current = await readV4(cwd);
		const out = await fn(current);
		if (out.state) await writeV4(cwd, out.state);
		return out.result;
	});
}

function passiveCapabilities(pi: ExtensionAPI) {
	const active = new Set(pi.getActiveTools());
	return [
		{ name: "verification-guard", description: "Final read-only verification gate", active: true, planning_note: "Completion still needs final verification." },
		{ name: "git-destructive-guard", description: "Confirmation for destructive Git operations", active: true, planning_note: "Do not plan silent destructive recovery." },
		{ name: "context-guards", description: "Context inlet, watcher, and output controls", active: true, planning_note: "Prefer bounded evidence reads." },
		{ name: "plan-mode", description: "Planning blocks source mutation", active: true, planning_note: "Finish reflection and plan_write before execution." },
		{ name: "subagents", description: "Explicit model-owned delegated execution", active: active.has("subagent"), planning_note: "The harness never launches a child itself." },
		{ name: "plannotator-review", description: "Optional asynchronous browser plan review", active: PLANNOTATOR_BRIDGE, planning_note: "Only used through explicit /plan-review." },
	];
}

function capabilitySnapshot(pi: ExtensionAPI): CapabilitySnapshot {
	return buildCapabilitySnapshot(
		pi.getActiveTools(),
		pi.getAllTools().map((tool) => ({
			name: tool.name,
			description: tool.description,
			sourceInfo: { source: tool.sourceInfo?.source, path: tool.sourceInfo?.path },
		})),
		pi.getCommands().map((command) => ({
			name: command.name,
			description: command.description,
			source: command.sourceInfo?.source,
		})),
		passiveCapabilities(pi),
	);
}

function telemetry(kind: string, state: PlanStateV4, detail: Record<string, unknown>): void {
	record("plan-runner", kind, { run_id: state.run_id, ...detail });
}

const stringList = (description: string) => Type.Array(Type.String(), { description });
const signalsSchema = Type.Object({
	repository_behavior: Type.Optional(Type.Boolean()),
	ambiguity: Type.Optional(Type.Boolean()),
	multiple_artifacts: Type.Optional(Type.Boolean()),
	external_effects: Type.Optional(Type.Boolean()),
	risk: Type.Optional(Type.Boolean()),
	capability_dependent: Type.Optional(Type.Boolean()),
	competing_approaches: Type.Optional(Type.Boolean()),
	safety_or_compatibility: Type.Optional(Type.Boolean()),
	test_exception: Type.Optional(Type.Boolean()),
});
const reflectSchema = Type.Object({
	stage: Type.Union([Type.Literal("interpretation"), Type.Literal("evidence"), Type.Literal("critique")]),
	requirements: stringList("Explicit requirements, preserved verbatim enough for exact coverage."),
	constraints: stringList("Hard constraints."),
	non_goals: stringList("Explicit non-goals."),
	assumptions: stringList("Concise assumptions, not private reasoning."),
	evidence_refs: stringList("Repository/tool evidence references, e.g. path:line or command result."),
	uncertainties: stringList("Unresolved uncertainties."),
	capability_use: stringList("Relevant active capability names and intended use."),
	scope_cuts: stringList("YAGNI cuts; never silently cut explicit scope."),
	test_seams: stringList("Observable test seams."),
	signals: signalsSchema,
});

const statusSchema = Type.Union([
	Type.Literal("pending"),
	Type.Literal("in_progress"),
	Type.Literal("done"),
	Type.Literal("blocked"),
	Type.Literal("stale"),
]);
const ordinalSchema = Type.Union([Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")]);
const stepSchema = Type.Object({
	step_id: Type.String({ description: "Stable safe identifier, e.g. step-api-contract." }),
	title: Type.String(),
	kind: Type.Union([Type.Literal("behavior"), Type.Literal("support")]),
	status: statusSchema,
	objective: Type.String(),
	acceptance: stringList("Observable executable acceptance criteria."),
	covers: stringList("Exact requirements from the interpretation reflection covered by this step."),
	hard_depends_on: stringList("Stable step_ids that must be done first."),
	soft_after: stringList("Preferred ordering only; legal jumps may cross this."),
	required_capabilities: stringList("Exact capability names from the captured snapshot."),
	capability_fallback: Type.Optional(Type.String()),
	risk: ordinalSchema,
	information_value: ordinalSchema,
	effort: ordinalSchema,
	expected_files: stringList("Relative paths or surfaces; no absolute or parent paths."),
	invalidated_by: stringList("Assumptions/evidence changes that reopen this step."),
	test: Type.Optional(Type.Object({
		paths: stringList("Test paths."),
		command: Type.String(),
		red_expectation: Type.String(),
		green_expectation: Type.String(),
	})),
	test_exception: Type.Optional(Type.Object({
		reason: Type.String(),
		validation: Type.String({ description: "Smallest read-only alternative validation command." }),
	})),
	validation: Type.Optional(Type.String({ description: "Read-only validation command for support steps." })),
	note: Type.Optional(Type.String()),
});

function toStep(raw: any, order: number, previous?: PlanStepV4): PlanStepV4 {
	return {
		id: compactText(raw.step_id, 80),
		order: previous?.order ?? order,
		title: compactText(raw.title, 160),
		kind: raw.kind,
		status: raw.status,
		objective: compactText(raw.objective, 500),
		acceptance: raw.acceptance.map((value: unknown) => compactText(value, 300)),
		covers: raw.covers.map((value: unknown) => compactText(value, 300)),
		hard_depends_on: raw.hard_depends_on.map((value: unknown) => compactText(value, 80)),
		soft_after: raw.soft_after.map((value: unknown) => compactText(value, 80)),
		required_capabilities: raw.required_capabilities.map((value: unknown) => compactText(value, 80)),
		capability_fallback: raw.capability_fallback ? compactText(raw.capability_fallback, 300) : undefined,
		risk: raw.risk,
		information_value: raw.information_value,
		effort: raw.effort,
		expected_files: raw.expected_files.map((value: unknown) => compactText(value, 240)),
		invalidated_by: raw.invalidated_by.map((value: unknown) => compactText(value, 200)),
		test: raw.test ? {
			paths: raw.test.paths.map((value: unknown) => compactText(value, 240)),
			command: compactText(raw.test.command, 500),
			red_expectation: compactText(raw.test.red_expectation, 300),
			green_expectation: compactText(raw.test.green_expectation, 300),
		} : undefined,
		test_exception: raw.test_exception ? {
			reason: compactText(raw.test_exception.reason, 300),
			validation: compactText(raw.test_exception.validation, 500),
		} : undefined,
		validation: raw.validation ? compactText(raw.validation, 500) : undefined,
		note: raw.note ? compactText(raw.note, 500) : undefined,
		stale_reason: raw.status === "stale" ? previous?.stale_reason : undefined,
		route_history: previous?.route_history,
		red_receipt: previous?.red_receipt,
		green_receipt: previous?.green_receipt,
		spawn_receipt: previous?.spawn_receipt,
	};
}

function pathErrors(steps: PlanStepV4[]): string[] {
	const errors: string[] = [];
	for (const step of steps) {
		if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(step.id)) errors.push(`unsafe step_id "${step.id}"`);
		for (const path of [...step.expected_files, ...(step.test?.paths ?? [])]) {
			if (!safeRelativePath(path)) errors.push(`step "${step.title}" contains unsafe path "${path}"`);
		}
		const validationCommand = step.test?.command ?? step.test_exception?.validation ?? step.validation;
		if (validationCommand && classifyBashCommand(validationCommand).mutates) {
			errors.push(`step "${step.title}" validation command mutates state`);
		}
	}
	return errors;
}

function workingBrief(step: PlanStepV4): string {
	return [
		renderStepMarkdown(step),
		"",
		"## Execution contract",
		"- Work only this bounded increment.",
		"- For behavior: obtain matching failed RED evidence, then GREEN.",
		"- Report changed files, commands, outcomes, and invalidated assumptions.",
	].join("\n");
}

function briefCoverageErrors(step: PlanStepV4, task: string): string[] {
	const normalized = task.toLowerCase();
	const required = [
		step.id,
		step.objective,
		...step.acceptance,
		step.test?.command ?? step.test_exception?.validation ?? step.validation ?? "",
	].filter(Boolean);
	return required.filter((value) => !normalized.includes(value.toLowerCase()));
}

function alternativesText(state: PlanStateV4): string {
	const ranked = rankEligibleSteps(state.items, state.capability_snapshot, state.route.invalidated_assumptions, state.route.selected_step_id);
	return ranked.length
		? ranked.map((step, index) => `${index + 1}. ${step.id} — ${step.title}`).join("\n")
		: "(none)";
}

function unavailableRequiredCapabilities(step: PlanStepV4, snapshot: CapabilitySnapshot): string[] {
	if (step.capability_fallback?.trim()) return [];
	const active = new Set(snapshot.entries.filter((entry) => entry.active).map((entry) => entry.name));
	return step.required_capabilities.filter((name) => !active.has(name));
}

function reflectionFromParams(params: any): ReflectionRecord {
	return {
		stage: params.stage,
		requirements: params.requirements.map((value: unknown) => compactText(value, 300)),
		constraints: params.constraints.map((value: unknown) => compactText(value, 300)),
		non_goals: params.non_goals.map((value: unknown) => compactText(value, 300)),
		assumptions: params.assumptions.map((value: unknown) => compactText(value, 300)),
		evidence_refs: params.evidence_refs.map((value: unknown) => compactText(value, 300)),
		uncertainties: params.uncertainties.map((value: unknown) => compactText(value, 300)),
		capability_use: params.capability_use.map((value: unknown) => compactText(value, 160)),
		scope_cuts: params.scope_cuts.map((value: unknown) => compactText(value, 300)),
		test_seams: params.test_seams.map((value: unknown) => compactText(value, 300)),
		signals: params.signals,
	};
}

function goHoldReason(state: PlanStateV4, pi: ExtensionAPI): string | undefined {
	const next = nextReflectionStage(state.reflections);
	if (next) return `reflection sequence is incomplete; next required pass: ${next}`;
	if (state.items.length === 0) return "no plan steps exist";
	if (state.review && state.review.status !== "approved") return `plan review is ${state.review.status}`;
	if (state.review?.status === "approved" && state.review.content_sha256 !== planContentSha(state)) return "plan changed after review approval";
	if (state.items.some((step) => step.test_exception) && !state.test_exceptions_approved) {
		return "one or more non-testable exceptions still require explicit user or approved review";
	}
	if (CONTEXT_MODE === "spawn" && !pi.getActiveTools().includes("subagent")) {
		return "PLAN_STEP_CONTEXT=spawn requires the active subagent tool";
	}
	return undefined;
}

function planPrompt(request: string, snapshot: CapabilitySnapshot, yolo: boolean): string {
	const active = snapshot.entries.filter((entry) => entry.active)
		.map((entry) => `- ${entry.name} (${entry.kind}): ${entry.description}${entry.planning_note ? ` — ${entry.planning_note}` : ""}`)
		.join("\n");
	return `MODE: REFLECTIVE PLAN${yolo ? "+RUN" : ""}
REQ:
${request}

CAPABILITY SNAPSHOT ${snapshot.sha256}:
${active || "(none)"}

Call plan_reflect with structured conclusions only; never expose hidden chain-of-thought.
Pass 1 interpretation is mandatory. The tool will name the next required pass (up to evidence and critique) or say complete.
Only after reflection is complete, call plan_write with ponytail/YAGNI micro-steps: one observable behavior or support increment per step, exact requirement coverage, hard and soft dependencies, real capabilities/fallbacks, and test-first contracts.
Do not mutate source files during planning.${yolo ? " Then call plan_go and execute." : " Then stop and wait for /plan-go."}`;
}

function runPrompt(state: PlanStateV4): string {
	const routeInstruction = DYNAMIC_ROUTE
		? "Call plan_route(action=select, target_step=...) before work and at every RED/GREEN, failed gate, contradiction, capability change, user input, or invalidated-assumption checkpoint. You may select any legal step; the harness never dispatches it."
		: "Execute the micro-steps in their stored order.";
	const contextInstruction = CONTEXT_MODE === "spawn"
		? "For the selected step, explicitly call subagent(executor, ..., mode=spawn) with the complete returned brief. Direct parent mutation is blocked while that routed child step is active."
		: CONTEXT_MODE === "current"
			? "The parent executes the selected step in this context."
			: "";
	return `MODE: RUN
REQ: ${state.request}
PLAN: ${join(".pi", "plans", state.run_id, "PLAN.md")}
${routeInstruction}
${contextInstruction}
Behavior completion needs observed RED→GREEN receipts. Reopening a prerequisite makes completed hard dependents stale; inspect and revalidate them—no source rollback is automatic.
Run the declared final_validation and obtain a passing receipt before completing the plan.`;
}

function normalizedReviewResult(value: unknown): { status: "approved" | "rejected"; feedback?: string } | undefined {
	if (typeof value === "string") {
		if (value === "approved") return { status: "approved" };
		if (value === "rejected") return { status: "rejected" };
	}
	if (value && typeof value === "object") {
		const raw = value as Record<string, unknown>;
		if (typeof raw.approved === "boolean") {
			return {
				status: raw.approved ? "approved" : "rejected",
				feedback: typeof raw.feedback === "string" ? compactText(raw.feedback, 1000) : undefined,
			};
		}
		if (raw.status === "handled" && raw.result && typeof raw.result === "object") {
			return normalizedReviewResult(raw.result);
		}
		const status = raw.status ?? raw.action;
		if (status === "approved" || status === "rejected") {
			return { status, feedback: typeof raw.feedback === "string" ? compactText(raw.feedback, 1000) : undefined };
		}
	}
	return undefined;
}

function pendingReviewId(value: unknown): string | undefined {
	if (!value || typeof value !== "object") return undefined;
	const raw = value as Record<string, unknown>;
	const result = raw.status === "handled" && raw.result && typeof raw.result === "object"
		? raw.result as Record<string, unknown>
		: raw;
	return result.status === "pending" && typeof result.reviewId === "string"
		? compactText(result.reviewId, 160)
		: undefined;
}

async function applyReviewResult(cwd: string, value: unknown): Promise<boolean> {
	const parsed = normalizedReviewResult(value);
	if (!parsed) return false;
	await mutateV4(cwd, async (current) => {
		if (!current?.review) return { result: undefined };
		const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
		if (typeof raw.reviewId === "string" && current.review.review_id && raw.reviewId !== current.review.review_id) {
			return { result: undefined };
		}
		current.review = { ...current.review, status: parsed.status, feedback: parsed.feedback, updated_at: isoNow() };
		if (parsed.status === "approved") current.test_exceptions_approved = true;
		return { state: current, result: undefined };
	});
	return true;
}

async function persistPlannotatorResponse(cwd: string, requestId: string, value: unknown): Promise<void> {
	const reviewId = pendingReviewId(value);
	if (reviewId) {
		await mutateV4(cwd, async (current) => {
			if (!current?.review || current.review.request_id !== requestId) return { result: undefined };
			current.review = { ...current.review, review_id: reviewId, updated_at: isoNow() };
			return { state: current, result: undefined };
		});
		reviewRequestCwds.set(reviewId, cwd);
		return;
	}
	await applyReviewResult(cwd, value);
}

export function registerPlanV4(pi: ExtensionAPI): void {
	let planning = false;

	pi.on("before_agent_start", async (event, ctx) => {
		if (event.prompt?.trim()) latestPrompts.set(ctx.cwd, event.prompt.trim());
	});
	pi.on("session_start", async (_event, ctx) => {
		const state = await readV4(ctx.cwd);
		if (state?.review?.status === "pending" && state.review.review_id) {
			reviewRequestCwds.set(state.review.review_id, ctx.cwd);
			pi.events.emit("plannotator:request", {
				requestId: `status-${randomUUID()}`,
				action: "review-status",
				payload: { reviewId: state.review.review_id },
				respond: (value: unknown) => { void applyReviewResult(ctx.cwd, value); },
			});
		}
	});
	pi.events.on("plannotator:review-result", (raw) => {
		const value = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
		const reviewId = compactText(value.reviewId, 160);
		const cwd = reviewRequestCwds.get(reviewId);
		if (cwd && reviewId) void applyReviewResult(cwd, value);
	});

	pi.registerTool(defineTool({
		name: "plan_reflect",
		label: "Reflect on Plan Evidence",
		description: "Start or continue a schema-v4 plan by persisting one structured interpretation/evidence/critique pass. Stores conclusions and evidence only, never hidden reasoning. plan_write is blocked until required passes finish.",
		promptSnippet: "Record the next structured planning reflection pass.",
		parameters: reflectSchema,
		async execute(_id, params, _signal, _update, ctx) {
			const incoming = reflectionFromParams(params);
			const result = await mutateV4(ctx.cwd, async (state) => {
				if (!state) {
					const request = latestPrompts.get(ctx.cwd);
					if (!request) return { result: { ok: false, error: "No request is available. Start with /plan." } };
					const now = isoNow();
					state = {
						schema_version: 4,
						run_id: `plan-${timestamp()}-${randomUUID().slice(0, 6)}`,
						request,
						summary: "Reflection pending.",
						// A tool-initiated one-shot has no later slash-command turn; it
						// mirrors `/plan ... yolo` but still requires the model to call
						// plan_go explicitly. The harness never dispatches execution.
						autonomy: "yolo",
						phase: "reflecting",
						created_at: now,
						updated_at: now,
						reflections: [],
						capability_snapshot: capabilitySnapshot(pi),
						items: [],
						final_validation: "",
						route: { history: [], no_progress_streak: 0, invalidated_assumptions: [] },
					};
					planning = true;
				}
				let records = state.reflections;
				const revisingRejected = state.review?.status === "rejected" && incoming.stage === "critique";
				if (revisingRejected) records = records.filter((record) => record.stage !== "critique");
				const errors = validateReflectionAppend(records, incoming);
				if (errors.length) return { result: { ok: false, error: errors.join("; "), state } };
				const nextState: PlanStateV4 = { ...state, reflections: [...records, incoming] };
				if (state.review) {
					nextState.review = {
						...state.review,
						status: "pending",
						content_sha256: planContentSha(nextState),
						updated_at: isoNow(),
					};
				}
				return { state: nextState, result: { ok: true, state: nextState } };
			});
			if (!result.ok) {
				return { content: [{ type: "text" as const, text: `plan_reflect rejected: ${result.error}` }], isError: true, details: { success: false }, terminate: false };
			}
			const next = nextReflectionStage(result.state.reflections);
			telemetry("reflection", result.state, {
				stage: incoming.stage,
				pass: result.state.reflections.length,
				next: next ?? "complete",
				requirements: incoming.requirements.length,
				uncertainties: incoming.uncertainties.length,
			});
			await appendReceipt(ctx.cwd, result.state, "plan_reflect", {
				success: true,
				stage: incoming.stage,
				pass: result.state.reflections.length,
				next: next ?? "complete",
			});
			return {
				content: [{ type: "text" as const, text: next
					? `Reflection pass ${result.state.reflections.length}/3 stored. Next required stage: ${next}.`
					: `Reflection complete after ${result.state.reflections.length} pass(es). Call plan_write.` }],
				details: { success: true, stage: incoming.stage, next },
				terminate: false,
			};
		},
	}));

	pi.registerTool(defineTool({
		name: "plan_write",
		label: "Write Reflective Plan",
		description: "Validate and write the complete schema-v4 micro-plan. Pass the entire list each call. Explicit requirements, capabilities, hard dependencies, and TDD contracts are checked before state changes.",
		promptSnippet: "Write or revise the complete validated v4 plan.",
		parameters: Type.Object({
			request: Type.Optional(Type.String()),
			summary: Type.String(),
			final_validation: Type.String({ description: "Read-only whole-plan verification command." }),
			items: Type.Array(stepSchema, { minItems: 1 }),
		}),
		async execute(_id, params, _signal, _update, ctx) {
			const outcome = await mutateV4(ctx.cwd, async (state) => {
				if (!state) return { result: { ok: false, errors: ["No v4 plan session. Start with /plan."] } };
				const previous = new Map(state.items.map((step) => [step.id, step]));
				let nextOrder = Math.max(0, ...state.items.map((step) => step.order)) + 1;
				const steps = params.items.map((raw: any) => {
					const prior = previous.get(compactText(raw.step_id, 80));
					return toStep(raw, prior?.order ?? nextOrder++, prior);
				});
				const errors = [
					...validateV4Plan(steps, state.reflections, state.capability_snapshot),
					...pathErrors(steps),
				];
				const incomingActive = steps.find((step) => step.status === "in_progress");
				if (DYNAMIC_ROUTE && state.phase === "executing" && incomingActive && incomingActive.id !== state.route.selected_step_id) {
					errors.push("in_progress status must match the step explicitly selected by plan_route");
				}
				const next: PlanStateV4 = {
					...state,
					request: compactText(params.request ?? state.request, 4000),
					summary: compactText(params.summary, 1000),
					final_validation: compactText(params.final_validation, 500),
					items: steps,
					phase: state.phase === "reflecting" ? "planned" : state.phase,
					route: {
						...state.route,
						selected_step_id: steps.some((step) => step.id === state.route.selected_step_id)
							&& steps.find((step) => step.id === state.route.selected_step_id)?.status === "in_progress"
							? state.route.selected_step_id
							: undefined,
					},
				};
				if (!next.final_validation.trim() || classifyBashCommand(next.final_validation).mutates) {
					errors.push("final_validation must be a non-mutating verification command");
				}
				if (TDD_EVIDENCE) {
					for (const step of steps.filter((candidate) => candidate.status === "done")) errors.push(...completionEvidenceErrors(step));
					const finalError = finalEvidenceError(next);
					if (finalError) errors.push(finalError);
				}
				if (CONTEXT_MODE === "spawn") {
					for (const step of steps.filter((candidate) => candidate.status === "done")) {
						if (!step.spawn_receipt?.success) errors.push(`spawn profile requires one successful executor receipt before completing "${step.title}"`);
					}
				}
				if (errors.length) return { result: { ok: false, errors } };
				const oldSha = state.items.length ? planContentSha(state) : undefined;
				const newSha = planContentSha(next);
				if (state.review && oldSha !== newSha) {
					next.review = {
						...state.review,
						status: "pending",
						content_sha256: newSha,
						updated_at: isoNow(),
					};
				}
				if (steps.some((step) => step.test_exception) && !state.test_exceptions_approved) {
					next.test_exceptions_approved = false;
				}
				return { state: next, result: { ok: true, state: next } };
			});
			if (!outcome.ok) {
				const existing = await readV4(ctx.cwd);
				if (existing) telemetry("v4-write", existing, {
					steps: params.items.length,
					behavior: params.items.filter((step: any) => step.kind === "behavior").length,
					support: params.items.filter((step: any) => step.kind === "support").length,
					requirements: new Set(existing.reflections.flatMap((record) => record.requirements).map((value) => compactText(value).toLowerCase())).size,
					covered_requirements: new Set(params.items.flatMap((step: any) => Array.isArray(step.covers) ? step.covers : []).map((value: unknown) => compactText(value).toLowerCase())).size,
					acceptance_criteria: params.items.reduce((sum: number, step: any) => sum + (Array.isArray(step.acceptance) ? step.acceptance.length : 0), 0),
					required_capabilities: new Set(params.items.flatMap((step: any) => Array.isArray(step.required_capabilities) ? step.required_capabilities : []).map((value: unknown) => compactText(value))).size,
					coverage_errors: outcome.errors.filter((error: string) => error.includes("requirement")).length,
					capability_errors: outcome.errors.filter((error: string) => error.includes("capability")).length,
					accepted: false,
				});
				return {
					content: [{ type: "text" as const, text: `plan_write rejected:\n- ${outcome.errors.join("\n- ")}` }],
					isError: true,
					details: { success: false, errors: outcome.errors.length },
					terminate: false,
				};
			}
			telemetry("v4-write", outcome.state, {
				steps: outcome.state.items.length,
				behavior: outcome.state.items.filter((step: PlanStepV4) => step.kind === "behavior").length,
				support: outcome.state.items.filter((step: PlanStepV4) => step.kind === "support").length,
				requirements: new Set(outcome.state.reflections.flatMap((record: ReflectionRecord) => record.requirements).map((value: string) => compactText(value).toLowerCase())).size,
				covered_requirements: new Set(outcome.state.items.flatMap((step: PlanStepV4) => step.covers).map((value: string) => compactText(value).toLowerCase())).size,
				acceptance_criteria: outcome.state.items.reduce((sum: number, step: PlanStepV4) => sum + step.acceptance.length, 0),
				required_capabilities: new Set(outcome.state.items.flatMap((step: PlanStepV4) => step.required_capabilities).map((value: string) => compactText(value))).size,
				coverage_errors: 0,
				capability_errors: 0,
				accepted: true,
			});
			await appendReceipt(ctx.cwd, outcome.state, "plan_write", { success: true, steps: outcome.state.items.length });
			return {
				content: [{ type: "text" as const, text:
					`Plan v4 written: ${outcome.state.items.length} micro-step(s).\n` +
					`Artifacts: ${join(".pi", "plans", outcome.state.run_id)}\n` +
					`${outcome.state.items.some((step: PlanStepV4) => step.test_exception) && !outcome.state.test_exceptions_approved
						? "Execution hold: test exception approval required.\n"
						: ""}` +
					(outcome.state.autonomy === "yolo"
						? "Call plan_go explicitly, then continue with plan_route/implementation."
						: planning
							? "Stop and wait for /plan-go."
							: "Continue with plan_route/implementation.") }],
				details: { success: true, run_id: outcome.state.run_id, steps: outcome.state.items.length },
				terminate: false,
			};
		},
	}));

	if (DYNAMIC_ROUTE) {
		pi.registerTool(defineTool({
			name: "plan_route",
			label: "Choose Plan Route",
			description: "Model-owned route selection/checkpoint/backtrack/block. Validates legal moves and returns a working brief; never launches tools, commands, LLMs, or subagents.",
			promptSnippet: "Select or revise the next legal v4 plan step.",
			parameters: Type.Object({
				action: Type.Union([Type.Literal("select"), Type.Literal("checkpoint"), Type.Literal("backtrack"), Type.Literal("block")]),
				current_step: Type.Optional(Type.String()),
				target_step: Type.Optional(Type.String()),
				observed_outcome: Type.String(),
				evidence_receipts: stringList("Concise evidence receipt IDs or hashes."),
				invalidated_assumptions: stringList("Assumption identifiers invalidated by new evidence."),
				reason: Type.String(),
			}),
			async execute(_id, params, _signal, _update, ctx) {
				const outcome = await mutateV4(ctx.cwd, async (state) => {
					if (!state) return { result: { ok: false, error: "No v4 plan." } };
					const refreshed = capabilitySnapshot(pi);
					const capabilityChanged = refreshed.sha256 !== state.capability_snapshot.sha256;
					let next: PlanStateV4 = {
						...state,
						capability_snapshot: refreshed,
						route: {
							...state.route,
							invalidated_assumptions: [...new Set([...state.route.invalidated_assumptions, ...params.invalidated_assumptions.map((v) => compactText(v, 200))])],
							checkpoint_required: undefined,
						},
					};
					let stale: string[] = [];
					const target = params.target_step ? compactText(params.target_step, 80) : undefined;
					const rankedBefore = rankEligibleSteps(
						next.items,
						refreshed,
						next.route.invalidated_assumptions,
						next.route.selected_step_id,
					);
					const selectedRank = target ? rankedBefore.findIndex((step) => step.id === target) + 1 : 0;
					const previouslySelected = activeStep(state);
					const lostCapabilities = previouslySelected
						? unavailableRequiredCapabilities(previouslySelected, refreshed)
						: [];
					if (params.action === "checkpoint" && previouslySelected && lostCapabilities.length) {
						next.items = next.items.map((step) => step.id === previouslySelected.id
							? { ...step, status: "pending", note: `Required capability became unavailable: ${lostCapabilities.join(", ")}` }
							: step);
						next.route.selected_step_id = undefined;
						next.route.history = [...next.route.history, {
							at: isoNow(),
							action: "capability-replan",
							target: previouslySelected.id,
							reason: `Unavailable: ${lostCapabilities.join(", ")}`,
						}].slice(-50);
						return {
							state: next,
							result: {
								ok: false,
								error: `Required capability became unavailable (${lostCapabilities.join(", ")}); selection cleared for replanning. No call was dispatched.`,
								state: next,
								stale,
								capability_changed: capabilityChanged,
							},
						};
					}
					if (params.action === "select") {
						if (!target) return { result: { ok: false, error: "select requires target_step" } };
						const errors = validateRouteTarget(target, next.items, refreshed);
						if (errors.length) return { state: next, result: { ok: false, error: errors.join("; "), state: next, capability_changed: capabilityChanged } };
						next.items = next.items.map((step) => ({
							...step,
							status: step.id === target ? "in_progress" : step.status === "in_progress" ? "pending" : step.status,
							route_history: step.id === target
								? [...(step.route_history ?? []), { at: isoNow(), action: "select", reason: compactText(params.reason, 500) }].slice(-30)
								: step.route_history,
						}));
						next.route.selected_step_id = target;
					} else if (params.action === "backtrack") {
						if (!target) return { result: { ok: false, error: "backtrack requires target_step" } };
						const result = backtrackAndStale(next.items, target, compactText(params.reason, 500));
						if (result.stale.length === 0) return { result: { ok: false, error: `unknown target step "${target}"` } };
						next.items = result.steps;
						next.items = next.items.map((step) => result.stale.includes(step.id)
							? { ...step, route_history: [...(step.route_history ?? []), { at: isoNow(), action: "backtrack", reason: compactText(params.reason, 500) }].slice(-30) }
							: step);
						stale = result.stale;
						next.route.selected_step_id = undefined;
					} else if (params.action === "block") {
						const id = target ?? params.current_step ?? next.route.selected_step_id;
						if (!id) return { result: { ok: false, error: "block requires a current or target step" } };
						if (!next.items.some((step) => step.id === id)) return { result: { ok: false, error: `unknown step "${id}"` } };
						next.items = next.items.map((step) => step.id === id
							? {
								...step,
								status: "blocked",
								note: compactText(params.reason, 500),
								route_history: [...(step.route_history ?? []), { at: isoNow(), action: "block", reason: compactText(params.reason, 500) }].slice(-30),
							}
							: step);
						next.route.selected_step_id = undefined;
					}
					const evidence = [
						...params.evidence_receipts.map((value) => compactText(value, 160)),
						`cap:${refreshed.sha256}`,
						compactText(params.observed_outcome, 300),
					];
					const fingerprint = routeFingerprint(next.items, next.route.selected_step_id, evidence);
					if (params.action === "checkpoint" && next.route.selected_step_id) {
						next.items = next.items.map((step) => step.id === next.route.selected_step_id
							? {
								...step,
								route_history: [...(step.route_history ?? []), { at: isoNow(), action: "checkpoint", reason: compactText(params.reason, 500) }].slice(-30),
							}
							: step);
					}
					const streak = nextRouteStreak(state.route.fingerprint, fingerprint, state.route.no_progress_streak);
					next.route = {
						...next.route,
						fingerprint,
						no_progress_streak: streak,
						history: [...next.route.history, {
							at: isoNow(),
							action: params.action,
							target,
							reason: compactText(params.reason, 500),
						}].slice(-50),
					};
					if (streak >= ROUTE_STREAK_MAX) {
						if (next.route.selected_step_id) {
							next.items = next.items.map((step) => step.id === next.route.selected_step_id
								? { ...step, status: "blocked", note: "Route churn: three changes without new evidence or state." }
								: step);
						}
						next.route.selected_step_id = undefined;
						return { state: next, result: { ok: false, error: "Route churn limit reached: blocked after three no-progress changes.", state: next, stale, capability_changed: capabilityChanged } };
					}
					return {
						state: next,
						result: {
							ok: true,
							state: next,
							stale,
							capability_changed: capabilityChanged,
							eligible_count: rankedBefore.length,
							selected_rank: selectedRank,
						},
					};
				});
				const state = outcome.state ?? await readV4(ctx.cwd);
				if (!state) {
					return { content: [{ type: "text" as const, text: `plan_route rejected: ${outcome.error}` }], isError: true, details: { success: false }, terminate: false };
				}
				const selected = activeStep(state);
				telemetry("route", state, {
					action: params.action,
					eligible: Number(outcome.eligible_count ?? rankEligibleSteps(state.items, state.capability_snapshot, state.route.invalidated_assumptions, state.route.selected_step_id).length),
					selected_rank: Number(outcome.selected_rank ?? 0),
					stale: outcome.stale?.length ?? 0,
					stale_item_sha256: (outcome.stale ?? []).map((id: string) => identifierSha256(id)),
					target_sha256: params.target_step ? identifierSha256(compactText(params.target_step, 80)) : undefined,
					streak: state.route.no_progress_streak,
					context_mode: CONTEXT_MODE,
					accepted: outcome.ok,
				});
				telemetry("capability-refresh", state, {
					active_tools: state.capability_snapshot.entries.filter((entry: CapabilitySnapshot["entries"][number]) => entry.kind === "tool" && entry.active).length,
					commands: state.capability_snapshot.entries.filter((entry: CapabilitySnapshot["entries"][number]) => entry.kind === "command").length,
					changed: Boolean(outcome.capability_changed),
				});
				await appendReceipt(ctx.cwd, state, "plan_route", {
					success: outcome.ok,
					action: params.action,
					target: params.target_step,
					stale: outcome.stale?.length ?? 0,
				});
				if (!outcome.ok) {
					return {
						content: [{ type: "text" as const, text: `plan_route rejected: ${outcome.error}\nLegal alternatives:\n${alternativesText(state)}` }],
						isError: true,
						details: { success: false },
						terminate: false,
					};
				}
				const spawnHold = CONTEXT_MODE === "spawn" && selected && !pi.getActiveTools().includes("subagent");
				if (spawnHold) {
					return {
						content: [{ type: "text" as const, text: "Selected route is blocked: spawn context requires an active subagent tool. No child was launched." }],
						isError: true,
						details: { success: false },
						terminate: false,
					};
				}
				const churnWarning = state.route.no_progress_streak === ROUTE_STREAK_MAX - 1
					? "\n\nThrash ladder warning: two route changes produced no new evidence, status change, or eligible-set change. The next identical change blocks the route."
					: "";
				return {
					content: [{ type: "text" as const, text:
						`${selected ? `Selected ${selected.id}.\n\n${workingBrief(selected)}` : "Checkpoint recorded; no step was auto-selected."}\n\nLegal alternatives:\n${alternativesText(state)}${churnWarning}` }],
					details: {
						success: true,
						selected: selected?.id,
						alternatives: rankEligibleSteps(
							state.items,
							state.capability_snapshot,
							state.route.invalidated_assumptions,
							state.route.selected_step_id,
						).length,
					},
					terminate: false,
				};
			},
		}));
	}

	const startExecution = async (cwd: string): Promise<{ ok: true; state: PlanStateV4; resuming: boolean } | { ok: false; error: string; state?: PlanStateV4 }> =>
		mutateV4(cwd, async (state) => {
			if (!state) return { result: { ok: false, error: "No schema-v4 plan. Start with /plan." } as const };
			const hold = goHoldReason(state, pi);
			if (hold) return { result: { ok: false, error: hold, state } as const };
			if (!state.items.some((step) => step.status === "pending" || step.status === "in_progress" || step.status === "stale")) {
				return { result: { ok: false, error: "Plan has no open steps.", state } as const };
			}
			const resuming = state.phase === "executing";
			const next: PlanStateV4 = { ...state, phase: "executing" };
			return { state: next, result: { ok: true, state: next, resuming } as const };
		});

	pi.registerTool(defineTool({
		name: "plan_go",
		label: "Start Reflective Plan",
		description: "Begin or resume schema-v4 execution after reflection, validation, review, exception, and context-profile holds pass.",
		promptSnippet: "Start executing the validated v4 plan.",
		parameters: Type.Object({}),
		async execute(_id, _params, _signal, _update, ctx) {
			const outcome = await startExecution(ctx.cwd);
			if (!outcome.ok) {
				if (outcome.state) telemetry("go-blocked", outcome.state, { reason: outcome.error });
				return { content: [{ type: "text" as const, text: `plan_go blocked: ${outcome.error}` }], isError: true, details: { success: false }, terminate: false };
			}
			planning = false;
			pi.appendEntry("plan_spine", { run_id: outcome.state.run_id });
			telemetry("go", outcome.state, { resumed: outcome.resuming, stale: outcome.state.items.filter((step) => step.status === "stale").length });
			await appendReceipt(ctx.cwd, outcome.state, "plan_go", { success: true });
			return { content: [{ type: "text" as const, text: `Execution started.\n\n${runPrompt(outcome.state)}` }], details: { success: true }, terminate: false };
		},
	}));

	pi.registerCommand("plan", {
		description: "Create a capability-aware reflective v4 plan. Add 'yolo' to continue after planning.",
		handler: async (args, ctx) => {
			const yolo = /(^|\s)yolo$/i.test(args);
			const request = args.replace(/(^|\s)yolo$/i, "").trim();
			if (!request) {
				ctx.ui.notify("Usage: /plan <request> [yolo]", "error");
				return;
			}
			const snapshot = capabilitySnapshot(pi);
			const now = isoNow();
			const state: PlanStateV4 = {
				schema_version: 4,
				run_id: `plan-${timestamp()}-${randomUUID().slice(0, 6)}`,
				request,
				summary: "Reflection pending.",
				autonomy: yolo ? "yolo" : "lean",
				phase: "reflecting",
				created_at: now,
				updated_at: now,
				reflections: [],
				capability_snapshot: snapshot,
				items: [],
				final_validation: "",
				route: { history: [], no_progress_streak: 0, invalidated_assumptions: [] },
			};
			await withFileMutationQueue(statePath(ctx.cwd), async () => writeV4(ctx.cwd, state));
			planning = true;
			telemetry("capability-refresh", state, {
				active_tools: snapshot.entries.filter((entry) => entry.kind === "tool" && entry.active).length,
				commands: snapshot.entries.filter((entry) => entry.kind === "command").length,
				changed: true,
			});
			await appendReceipt(ctx.cwd, state, "plan", { success: true, capability_sha256: snapshot.sha256 });
			pi.sendUserMessage(planPrompt(request, snapshot, yolo));
		},
	});

	pi.registerCommand("plan-go", {
		description: "Run or resume the current reflective v4 plan.",
		handler: async (_args, ctx) => {
			const outcome = await startExecution(ctx.cwd);
			if (!outcome.ok) {
				ctx.ui.notify(`Execution held: ${outcome.error}`, "warning");
				return;
			}
			planning = false;
			pi.appendEntry("plan_spine", { run_id: outcome.state.run_id });
			await appendReceipt(ctx.cwd, outcome.state, "plan-go", { success: true });
			pi.sendUserMessage(runPrompt(outcome.state));
		},
	});

	pi.registerCommand("plan-status", {
		description: "Show the current reflective plan projection.",
		handler: async (_args, ctx) => {
			const state = await readV4(ctx.cwd);
			ctx.ui.notify(state ? compatibilityTodo(state) : "No schema-v4 plan found.", state ? "info" : "warning");
		},
	});

	pi.registerCommand("plan-trace", {
		description: "Show recent plan trace entries.",
		handler: async (args, ctx) => {
			const parsed = Number.parseInt(args.trim(), 10);
			const count = Number.isNaN(parsed) ? 10 : Math.min(50, Math.max(1, parsed));
			try {
				const lines = (await readFile(tracePath(ctx.cwd), "utf8")).split("\n").filter(Boolean).slice(-count);
				ctx.ui.notify(lines.join("\n"), "info");
			} catch {
				ctx.ui.notify("No plan trace found.", "info");
			}
		},
	});

	pi.registerCommand("runtime-status", {
		description: "Show provider/model runtime status.",
		handler: async (_args, ctx) => ctx.ui.notify(await runtimeStatusText(ctx), "info"),
	});

	pi.registerCommand("collapse", {
		description: "Rewind window to the plan node and summarize execution noise.",
		handler: async (args, ctx) => {
			const spine = [...ctx.sessionManager.getEntries()].reverse()
				.find((entry) => entry.type === "custom" && entry.customType === "plan_spine");
			if (!spine) {
				ctx.ui.notify("No plan node found — run /plan-go first, or use /compact.", "warning");
				return;
			}
			await ctx.navigateTree(spine.id, {
				summarize: true,
				label: "collapsed to plan",
				customInstructions: args.trim() ||
					"Summarize completed steps, evidence receipts, current route, stale/blocked work, and what remains. Drop tool noise.",
			});
		},
	});

	pi.registerCommand("plan-approve-exceptions", {
		description: "Explicitly approve declared non-testable exceptions after reviewing their alternative validations.",
		handler: async (_args, ctx) => {
			const state = await readV4(ctx.cwd);
			if (!state) {
				ctx.ui.notify("No schema-v4 plan found.", "warning");
				return;
			}
			const exceptions = state.items.filter((step) => step.test_exception);
			if (!exceptions.length) {
				ctx.ui.notify("This plan has no test exceptions.", "info");
				return;
			}
			const approved = await ctx.ui.confirm(
				"Approve test exceptions?",
				exceptions.map((step) => `${step.title}: ${step.test_exception!.reason}\nValidation: ${step.test_exception!.validation}`).join("\n\n"),
			);
			if (!approved) return;
			state.test_exceptions_approved = true;
			await writeV4(ctx.cwd, state);
			await appendReceipt(ctx.cwd, state, "plan-approve-exceptions", { success: true, count: exceptions.length });
			ctx.ui.notify(`Approved ${exceptions.length} test exception(s).`, "info");
		},
	});

	if (PLANNOTATOR_BRIDGE) {
		pi.registerCommand("plan-review", {
			description: "Request optional asynchronous Plannotator review for the current plan content.",
			handler: async (_args, ctx) => {
				const state = await readV4(ctx.cwd);
				if (!state || state.items.length === 0) {
					ctx.ui.notify("No written schema-v4 plan to review.", "warning");
					return;
				}
				const requestId = `review-${randomUUID()}`;
				const sha = planContentSha(state);
				state.review = { status: "pending", request_id: requestId, content_sha256: sha, updated_at: isoNow() };
				await writeV4(ctx.cwd, state);
				reviewRequestCwds.set(requestId, ctx.cwd);
				let responded = false;
				let resolveResponse: (value: unknown) => void = () => {};
				let persistResponse: Promise<void> | undefined;
				const response = new Promise<unknown>((resolve) => { resolveResponse = resolve; });
				pi.events.emit("plannotator:request", {
					requestId,
					action: "plan-review",
					payload: {
						planContent: [
							renderContextMarkdown(state.request, state.reflections, state.capability_snapshot, state.items, Boolean(state.test_exceptions_approved)),
							renderPlanMarkdown(state.request, state.summary, state.items, state.capability_snapshot, state.route.selected_step_id),
							...state.items.map(renderStepMarkdown),
						].join("\n---\n"),
						planFilePath: join(planDir(ctx.cwd, state.run_id), "PLAN.md"),
					},
					respond: (value: unknown) => {
						responded = true;
						persistResponse = persistPlannotatorResponse(ctx.cwd, requestId, value);
						resolveResponse(value);
					},
				});
				const result = await Promise.race([
					response,
					new Promise<undefined>((resolve) => setTimeout(resolve, PLANNOTATOR_TIMEOUT_MS)),
				]);
				if (!responded) {
					telemetry("review", state, { status: "unavailable", available: false });
					ctx.ui.notify("Plannotator review listener unavailable. The plan is unchanged; /plan-go remains held because review was explicitly requested.", "warning");
					return;
				}
				const reviewId = pendingReviewId(result);
				if (reviewId) {
					await persistResponse;
					const pendingState = await readV4(ctx.cwd);
					if (pendingState) telemetry("review", pendingState, { status: "pending", available: true });
					ctx.ui.notify("Plannotator opened the browser review. /plan-go remains held until approval.", "info");
					return;
				}
				const parsed = normalizedReviewResult(result);
				if (!parsed) {
					ctx.ui.notify("Plannotator returned an invalid review response; review remains pending.", "warning");
					return;
				}
				await persistResponse;
				const updated = await readV4(ctx.cwd);
				if (updated) telemetry("review", updated, { status: parsed.status, available: true });
				ctx.ui.notify(parsed.status === "approved" ? "Plan approved for this exact content SHA." : `Plan rejected${parsed.feedback ? `: ${parsed.feedback}` : "."}`, parsed.status === "approved" ? "info" : "warning");
			},
		});
	}

	pi.on("tool_call", async (event, ctx) => {
		const state = await readV4(ctx.cwd);
		if (!state) return;
		const mutation =
			["edit", "write", "multiedit"].includes(event.toolName) ||
			(event.toolName === "bash" && classifyBashCommand(String((event.input as any)?.command ?? "")).mutates);
		if (planning && mutation) {
			return { block: true, reason: "failure_class=plan_mode_violation. Reflective PLAN phase blocks mutation; finish plan_reflect and plan_write, then /plan-go." };
		}
		if (state.phase !== "executing") return;
		if (DYNAMIC_ROUTE && mutation && state.route.checkpoint_required) {
			return { block: true, reason: `Routing checkpoint required after ${state.route.checkpoint_required}. Call plan_route before more mutation.` };
		}
		const selected = activeStep(state);
		if (CONTEXT_MODE === "spawn" && selected) {
			if (event.toolName === "subagent") {
				const input = event.input as Record<string, unknown>;
				if (selected.spawn_receipt) {
					return { block: true, reason: `Routed step ${selected.id} already has its one spawn receipt. Call plan_route checkpoint/backtrack instead of launching a second child.` };
				}
				if (input.agent !== "executor" || input.mode !== "spawn") {
					return { block: true, reason: "This routed step requires one explicit subagent(executor, ..., mode=spawn) call with the complete step brief." };
				}
				const missing = briefCoverageErrors(selected, String(input.task ?? ""));
				if (missing.length) {
					return {
						block: true,
						reason: `Spawn task is not self-contained: it omits ${missing.length} required brief element(s). Copy the complete plan_route brief, including step id, objective, every acceptance criterion, and test/validation command.`,
					};
				}
				pendingSubagentCalls.set(event.toolCallId, {
					cwd: ctx.cwd,
					stepId: selected.id,
					parentInput: ctx.getContextUsage?.()?.tokens ?? 0,
				});
			} else if (mutation) {
				return {
					block: true,
					reason: pi.getActiveTools().includes("subagent")
						? `Direct parent mutation is blocked for routed step ${selected.id}. Explicitly call subagent(executor, …, mode=spawn) with its complete plan_route brief.`
						: `Routed step ${selected.id} is blocked: PLAN_STEP_CONTEXT=spawn requires the active subagent tool.`,
				};
			}
		}
		if (event.toolName !== "bash") return;
		const command = compactText((event.input as Record<string, unknown>).command, 500);
		const expected = selected?.test?.command ?? selected?.test_exception?.validation ?? selected?.validation;
		if (selected && expected === command) pendingTestCalls.set(event.toolCallId, { cwd: ctx.cwd, stepId: selected.id, command });
		else if (state.final_validation === command) pendingTestCalls.set(event.toolCallId, { cwd: ctx.cwd, stepId: "__final__", command });
	});

	pi.on("tool_result", async (event, ctx) => {
		const testCall = pendingTestCalls.get(event.toolCallId);
		if (testCall) {
			pendingTestCalls.delete(event.toolCallId);
			const output = textContent(event.content as Array<{ type?: string; text?: string }>);
			const exitCode = event.isError ? 1 : 0;
			const state = await mutateV4(testCall.cwd, async (current) => {
				if (!current) return { result: undefined };
				const receipt = testReceipt(testCall.command, exitCode, output);
				if (testCall.stepId === "__final__") {
					if (exitCode === 0) current.final_receipt = receipt;
				} else {
					current.items = current.items.map((step) => {
						if (step.id !== testCall.stepId) return step;
						if (step.kind === "behavior" && step.test) {
							if (exitCode !== 0 && !step.red_receipt) return { ...step, red_receipt: receipt };
							if (exitCode === 0 && step.red_receipt) return { ...step, green_receipt: receipt };
							return step;
						}
						return exitCode === 0 ? { ...step, green_receipt: receipt } : step;
					});
				}
				if (DYNAMIC_ROUTE) current.route.checkpoint_required = exitCode === 0 ? "GREEN evidence" : "RED/failed validation evidence";
				return { state: current, result: current };
			});
			if (state) {
				telemetry("tdd", state, {
					phase: testCall.stepId === "__final__" ? "final" : exitCode === 0 ? "green" : "red",
					pass: exitCode === 0,
					exit_code: exitCode,
					item_sha256: identifierSha256(testCall.stepId),
				});
				await appendReceipt(testCall.cwd, state, "plan_tdd", {
					success: exitCode === 0,
					item_id: testCall.stepId,
					phase: testCall.stepId === "__final__" ? "final" : exitCode === 0 ? "green" : "red",
					exit_code: exitCode,
					output_sha256: createHash("sha256").update(output).digest("hex"),
				});
			}
		}
		const subagentCall = pendingSubagentCalls.get(event.toolCallId);
		if (subagentCall) {
			pendingSubagentCalls.delete(event.toolCallId);
			const state = await mutateV4(subagentCall.cwd, async (current) => {
				if (!current) return { result: undefined };
				const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
				const results = Array.isArray(details.results) ? details.results as Array<Record<string, unknown>> : [];
				const usages = results.map((result) => result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : {});
				const childInput = usages.reduce((sum, usage) => sum + Number(usage.input ?? 0), 0);
				const childOutput = usages.reduce((sum, usage) => sum + Number(usage.output ?? 0), 0);
				current.items = current.items.map((step) => {
					if (step.id !== subagentCall.stepId) return step;
					let updated = {
						...step,
						spawn_receipt: {
							recorded_at: isoNow(),
							success: !event.isError,
							parent_input: subagentCall.parentInput,
							child_input: childInput,
							child_output: childOutput,
						},
					};
					const command = step.test?.command ?? step.test_exception?.validation ?? step.validation;
					if (command) {
						for (const receipt of subagentCommandReceipts(details, command)) {
							if (step.kind === "behavior" && step.test) {
								if (receipt.exit_code !== 0 && !updated.red_receipt) updated = { ...updated, red_receipt: receipt };
								else if (receipt.exit_code === 0 && updated.red_receipt) updated = { ...updated, green_receipt: receipt };
							} else if (receipt.exit_code === 0) {
								updated = { ...updated, green_receipt: receipt };
							}
						}
					}
					return updated;
				});
				if (DYNAMIC_ROUTE) current.route.checkpoint_required = "spawned executor result";
				return { state: current, result: current };
			});
			if (state) {
				const details = event.details && typeof event.details === "object" ? event.details as Record<string, unknown> : {};
				const results = Array.isArray(details.results) ? details.results as Array<Record<string, unknown>> : [];
				const usages = results.map((result) => result.usage && typeof result.usage === "object" ? result.usage as Record<string, unknown> : {});
				const childInput = usages.reduce((sum, usage) => sum + Number(usage.input ?? 0), 0);
				const childOutput = usages.reduce((sum, usage) => sum + Number(usage.output ?? 0), 0);
				const completedStep = state.items.find((step: PlanStepV4) => step.id === subagentCall.stepId);
				const childCommand = completedStep?.test?.command ?? completedStep?.test_exception?.validation ?? completedStep?.validation;
				for (const receipt of childCommand ? subagentCommandReceipts(details, childCommand) : []) {
					const phase = completedStep?.kind === "behavior"
						? receipt.exit_code === 0 ? "green" : "red"
						: "validation";
					telemetry("tdd", state, {
						phase,
						pass: receipt.exit_code === 0,
						exit_code: receipt.exit_code,
						item_sha256: identifierSha256(subagentCall.stepId),
					});
					await appendReceipt(subagentCall.cwd, state, "plan_tdd", {
						success: receipt.exit_code === 0,
						item_id: subagentCall.stepId,
						phase,
						exit_code: receipt.exit_code,
						output_sha256: receipt.output_sha256,
						origin: "spawn",
					});
				}
				telemetry("step-context", state, {
					mode: "spawn",
					delegated: true,
					success: !event.isError,
					parent_input: subagentCall.parentInput,
					child_input: childInput,
					child_output: childOutput,
				});
				await appendReceipt(subagentCall.cwd, state, "plan_subagent", {
					success: !event.isError,
					item_id: subagentCall.stepId,
					usage: {
						parent_input: subagentCall.parentInput,
						child_input: childInput,
						child_output: childOutput,
					},
				});
			}
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		planning = false;
		const state = await readV4(ctx.cwd);
		if (state && state.phase === "executing" && planStatus(state) !== "completed") {
			await appendReceipt(ctx.cwd, state, "agent_end", { success: false, final_status: planStatus(state) });
		}
	});
}
