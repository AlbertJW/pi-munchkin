/**
 * Pi Subagent Extension
 *
 * Delegates tasks to specialized subagents, each running as an isolated `pi`
 * process.
 *
 * Supports two invocation shapes:
 *   - Single:   { agent: "name", task: "..." }
 *   - Parallel: { tasks: [{ agent: "name", task: "..." }, ...] }
 *
 * And two context modes:
 *   - spawn (default): child gets only the task prompt.
 *   - fork: child gets a forked snapshot of current session context + task prompt.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { type AgentConfig, discoverAgents, discoverAgentsWithStarter } from "./agents.js";
import { renderCall, renderResult } from "./render.js";
import { getResultSummaryText } from "./runner-events.js";
import { mapConcurrent, runAgent } from "./runner.js";
import {
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  DEFAULT_DELEGATION_MODE,
  agentDescriptionForPrompt,
  emptyUsage,
  formatParallelSummaryText,
  isTerminalPlannedFailure,
  isTerminalPlannedFailureResult,
  parseDelegationMode,
  isResultError,
} from "./types.js";
import { ACTIVE_TOOL_PROMPTS } from "../../lib/active-tool-prompts.ts";
import { emitHarnessSignal } from "../../lib/harness-signals.ts";
import { BRANCH_REPORT_ENV, PLAN_CONTEXT_ENV, RESEARCH_SCOUT_ENV, RESEARCH_SCOUT_DISPATCHED_KEY, readBranchReport, readPlanContext, researchUsageFromMessages, validateRootResearchDispatch, validateScoutDispatch, type PlanContextV1, type ScoutReceiptV1 } from "../../lib/branch-report.ts";
import type { PlanStatus, ResearchBudget } from "../../lib/plan-graph.ts";
import { acquireResearchBranchLease, releaseResearchBranchLease, researchBranchDispatchContext, researchBranchDispatchEpoch } from "../../extensions/plan-runner.ts";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

const MAX_PARALLEL_TASKS = 8;
// Local llama-server is a single-concurrency provider: parallel children only queue,
// thrash the KV/prompt cache, and (fork) multiply full-parent-context prompt cost.
// Default 1; PI_SUBAGENT_CONCURRENCY=4 restores parallelism for cloud sessions.
const MAX_CONCURRENCY = (() => {
	const n = Number.parseInt(process.env.PI_SUBAGENT_CONCURRENCY || "1", 10);
	return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_PARALLEL_TASKS) : 1;
})();
const PARALLEL_HEARTBEAT_MS = 1000;
const DEFAULT_MAX_DELEGATION_DEPTH = 3;
const DEFAULT_PREVENT_CYCLE_DELEGATION = true;
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_MAX_DEPTH_ENV = "PI_SUBAGENT_MAX_DEPTH";
const SUBAGENT_STACK_ENV = "PI_SUBAGENT_STACK";
const SUBAGENT_PREVENT_CYCLES_ENV = "PI_SUBAGENT_PREVENT_CYCLES";
const PLAN_GRAPH_ENABLED = process.env.PLAN_GRAPH === "on";
const BRANCH_PLANNER_PROCESS = Boolean(process.env[PLAN_CONTEXT_ENV]);
const RESEARCH_SCOUT_PROCESS = process.env[RESEARCH_SCOUT_ENV] === "1";
const SCOUT_RECEIPTS_KEY = "__pi_research_scout_receipts";
const SCOUT_DISPATCH_STATE_KEY = "__pi_research_scout_dispatch_v1";
const ROOT_DISPATCH_STATE_KEY = "__pi_research_root_dispatch_v1";
const ROOT_CONTEXTS_KEY = "__pi_research_root_contexts_v1";

type ScoutDispatchState = {
	key: string;
	count: number;
	parents: string[];
	owners: string[];
};

type RootDispatchState = {
	key: string;
	parents: string[];
	owners: string[];
	epochs: Record<string, number>;
};

function scoutDispatchState(): ScoutDispatchState {
	const shared = globalThis as Record<string, unknown>;
	const existing = shared[SCOUT_DISPATCH_STATE_KEY] as Partial<ScoutDispatchState> | undefined;
	if (existing && typeof existing.key === "string" && typeof existing.count === "number" && Number.isSafeInteger(existing.count) && existing.count >= 0 &&
		Array.isArray(existing.parents) && Array.isArray(existing.owners) && existing.parents.every((value) => typeof value === "string") &&
		existing.owners.every((value) => typeof value === "string")) return existing as ScoutDispatchState;
	const fresh: ScoutDispatchState = { key: "", count: 0, parents: [], owners: [] };
	shared[SCOUT_DISPATCH_STATE_KEY] = fresh;
	return fresh;
}

function alignScoutDispatchState(state: ScoutDispatchState, context: PlanContextV1 | null): void {
	if (!context) return;
	const key = `${context.run_id}:${context.parent_item_id}:${context.owner_ref}`;
	if (state.key === key) return;
	state.key = key;
	state.count = 0;
	state.parents = [];
	state.owners = [];
}

function recordDispatchedScouts(context: PlanContextV1 | null, children: PlanContextV1[]): void {
	if (!context || context.depth !== 1) return;
	const shared = globalThis as Record<string, unknown>;
	const key = `${context.run_id}:${context.parent_item_id}:${context.owner_ref}`;
	const existing = shared[RESEARCH_SCOUT_DISPATCHED_KEY] as { key?: unknown; ids?: unknown } | undefined;
	const ids = existing?.key === key && Array.isArray(existing.ids)
		? existing.ids.filter((value): value is string => typeof value === "string")
		: [];
	for (const child of children) if (!ids.includes(child.parent_item_id)) ids.push(child.parent_item_id);
	shared[RESEARCH_SCOUT_DISPATCHED_KEY] = { key, ids };
}

function rootDispatchState(): RootDispatchState {
	const shared = globalThis as Record<string, unknown>;
	const existing = shared[ROOT_DISPATCH_STATE_KEY] as Partial<RootDispatchState> | undefined;
	if (existing && typeof existing.key === "string" && Array.isArray(existing.parents) && Array.isArray(existing.owners) &&
		existing.parents.every((value) => typeof value === "string") && existing.owners.every((value) => typeof value === "string")) {
		if (!existing.epochs || typeof existing.epochs !== "object" || Array.isArray(existing.epochs)) existing.epochs = {};
		return existing as RootDispatchState;
	}
	const fresh: RootDispatchState = { key: "", parents: [], owners: [], epochs: {} };
	shared[ROOT_DISPATCH_STATE_KEY] = fresh;
	return fresh;
}

function alignRootDispatchState(state: RootDispatchState, runId: string | undefined): void {
	if (!runId) return;
	if (state.key === runId) return;
	state.key = runId;
	state.parents = [];
	state.owners = [];
	state.epochs = {};
}

function forgetRootDispatch(state: RootDispatchState, context: PlanContextV1): void {
	state.parents = state.parents.filter((parent) => parent !== context.parent_item_id);
	state.owners = state.owners.filter((owner) => owner !== context.owner_ref);
}

async function reconcileReopenedRoots(cwd: string, contexts: PlanContextV1[], state: RootDispatchState): Promise<void> {
	for (const context of contexts) {
		if (!state.parents.includes(context.parent_item_id)) continue;
		let epoch: number | null;
		try { epoch = await researchBranchDispatchEpoch(cwd, context); }
		catch { continue; }
		if (epoch === null) continue;
		const prior = state.epochs[context.owner_ref];
		if (prior !== undefined && epoch > prior) forgetRootDispatch(state, context);
		if (prior === undefined || epoch > prior) state.epochs[context.owner_ref] = epoch;
	}
}

function activeResearchRootContexts(): ReadonlySet<string> {
	const raw = (globalThis as Record<string, unknown>)[ROOT_CONTEXTS_KEY];
	if (!Array.isArray(raw) || !raw.every((value) => typeof value === "string" && value.length <= 300)) return new Set();
	return new Set(raw);
}

type AcquiredRootLease = { context: PlanContextV1; leaseId: string };
type RootLeaseOperations = {
	acquire: typeof acquireResearchBranchLease;
	release: typeof releaseResearchBranchLease;
};
type RootDispatchOperations = Partial<RootLeaseOperations> & { epoch?: typeof researchBranchDispatchEpoch };

/**
 * Acquire every root lease before any child is launched. A provider or
 * filesystem exception during a later acquisition is still a failed
 * dispatch, not a reason to strand the leases already acquired. The optional
 * operations are a deterministic fault-injection seam for this lifecycle
 * boundary; production callers use the graph-backed defaults above.
 */
export async function acquireRootLeases(
	cwd: string,
	contexts: PlanContextV1[],
	operations: Partial<RootLeaseOperations> = {},
): Promise<{ ok: true; leases: AcquiredRootLease[] } | { ok: false; reason: string }> {
	const acquire = operations.acquire ?? acquireResearchBranchLease;
	const release = operations.release ?? releaseResearchBranchLease;
	const acquired: AcquiredRootLease[] = [];
	const releaseAcquired = async (): Promise<void> => {
		await Promise.all(acquired.map((prior) => release(cwd, prior.context, prior.leaseId).catch(() => false)));
	};
	try {
		for (const context of contexts) {
			let result: Awaited<ReturnType<typeof acquire>>;
			try {
				result = await acquire(cwd, context);
			} catch {
				await releaseAcquired();
				return { ok: false, reason: "lease_unavailable" };
			}
			if (!result.ok) {
				await releaseAcquired();
				const reason = result.reason === "already-leased" ? "already in-flight (durable dispatch lease)" : result.reason;
				return { ok: false, reason };
			}
			acquired.push({ context, leaseId: result.lease_id });
		}
		return { ok: true, leases: acquired };
	} catch {
		await releaseAcquired();
		return { ok: false, reason: "lease_unavailable" };
	}
}

export async function prepareRootDispatch(cwd: string, contexts: PlanContextV1[], state: RootDispatchState, operations: RootDispatchOperations = {}): Promise<{ ok: true; contexts: PlanContextV1[] } | { ok: false; reason: string }> {
	const leases = await acquireRootLeases(cwd, contexts, operations);
	if (!leases.ok) return leases;
	// Stage runtime-ledger changes until every persisted epoch has been read. A
	// failure must release all leases and leave the in-process guard unchanged.
	const parents = [...state.parents];
	const owners = [...state.owners];
	const epochs = { ...state.epochs };
	let epochUnavailable = false;
	try {
		for (const context of contexts) {
			if (!parents.includes(context.parent_item_id)) parents.push(context.parent_item_id);
			if (!owners.includes(context.owner_ref)) owners.push(context.owner_ref);
			if (epochs[context.owner_ref] === undefined) {
				const epoch = await (operations.epoch ?? researchBranchDispatchEpoch)(cwd, context);
				if (epoch === null) {
					epochUnavailable = true;
					throw new Error("research branch dispatch epoch unavailable");
				}
				epochs[context.owner_ref] = epoch;
			}
		}
		state.parents = parents;
		state.owners = owners;
		state.epochs = epochs;
		const leaseByParent = new Map(leases.leases.map((lease) => [lease.context.parent_item_id, lease.leaseId]));
		return { ok: true, contexts: contexts.map((context) => ({
			...context,
			dispatch_epoch: context.dispatch_epoch ?? epochs[context.owner_ref] ?? 0,
			lease_id: leaseByParent.get(context.parent_item_id),
		})) };
	} catch {
		const release = operations.release ?? releaseResearchBranchLease;
		await Promise.all(leases.leases.map((lease) => release(cwd, lease.context, lease.leaseId).catch(() => false)));
		return { ok: false, reason: epochUnavailable ? "epoch_unavailable" : "lease_unavailable" };
	}
}

function publishScoutReceipt(context: PlanContextV1 | undefined, result: SingleResult): void {
	if (context?.depth !== 2) return;
	const shared = globalThis as Record<string, unknown>;
	const prior = Array.isArray(shared[SCOUT_RECEIPTS_KEY]) ? shared[SCOUT_RECEIPTS_KEY] as ScoutReceiptV1[] : [];
	const usage = researchUsageFromMessages(result.messages);
	shared[SCOUT_RECEIPTS_KEY] = [...prior.filter((receipt) => receipt.owner_ref !== context.owner_ref), {
		owner_ref: context.owner_ref, ...usage,
		...(result.researchCoverage ? { coverage: result.researchCoverage } : {}),
	}];
}

/**
 * A runner can fail before it has spawned a child (for example while creating
 * the private prompt or plan-context artifact). Planned branches still need a
 * normal result so the parent can publish the branch-result signal and release
 * its durable dispatch lease. Keep the diagnostic deliberately generic: the
 * real exception may contain a private path or other process detail, and the
 * model-facing renderer already has a bounded untrusted failure contract.
 */
function runnerFailureResult(
	agentName: string,
	task: string,
	agents: AgentConfig[],
	planContext: PlanContextV1 | undefined,
	sessionModel: string | undefined,
): SingleResult {
	const agent = agents.find((candidate) => candidate.name === agentName);
	return {
		agent: agentName,
		agentSource: agent?.source ?? "unknown",
		task,
		exitCode: 1,
		messages: [],
		stderr: "Subagent runner failed before the child process completed.",
		usage: emptyUsage(),
		model: agent?.model ?? sessionModel,
		stopReason: "error",
		errorMessage: "Subagent runner failed before the child process completed.",
		...(planContext ? { planContext } : {}),
	};
}

// ---------------------------------------------------------------------------
// Tool parameter schema
// ---------------------------------------------------------------------------

const PlanContextSchema = Type.Object({
	v: Type.Literal(1), profile: Type.Literal("deep-research"),
	run_id: Type.String({ minLength: 1, maxLength: 200 }), parent_item_id: Type.String({ minLength: 1, maxLength: 96 }),
	owner_ref: Type.String({ minLength: 24, maxLength: 24 }), depth: Type.Union([Type.Literal(1), Type.Literal(2)]),
	budget: Type.Object({ searches: Type.Integer({ minimum: 0, maximum: 100 }), reads: Type.Integer({ minimum: 0, maximum: 100 }) }),
	limits: Type.Object({ max_depth: Type.Literal(2), max_children: Type.Union([Type.Literal(0), Type.Literal(2)]) }),
	lease_id: Type.Optional(Type.String({ minLength: 8, maxLength: 96 })),
	dispatch_epoch: Type.Optional(Type.Integer({ minimum: 0, maximum: 1_000_000 })),
});

const TaskItem = Type.Object({
  agent: Type.String({
    description: "Name of an available agent (must match exactly)",
  }),
  task: Type.String({
    description:
      "Task description for this delegated run. In spawn mode include all required context; in fork mode the subagent also sees your current session context.",
  }),
  cwd: Type.Optional(
    Type.String({ description: "Working directory for this agent's process" }),
  ),
	...(PLAN_GRAPH_ENABLED ? { plan_context: Type.Optional(PlanContextSchema) } : {}),
});

const SubagentParams = Type.Object({
  agent: Type.Optional(
    Type.String({
      description:
        "Agent name for single mode. Must match an available agent name exactly.",
    }),
  ),
  task: Type.Optional(
    Type.String({
      description:
        "Task description for single mode. In spawn mode it must be self-contained; in fork mode the subagent also receives your current session context.",
    }),
  ),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description:
        "For parallel mode: array of {agent, task} objects. Each task runs in an isolated process concurrently. Do NOT set agent/task when using this.",
    }),
  ),
  mode: Type.Optional(
    Type.String({
      description:
        "Context mode for delegated runs. 'spawn' (default) sends only the task prompt (best for isolated, reproducible runs with lower token/cost and less context leakage). 'fork' adds a snapshot of current session context plus task prompt (best for follow-up work, but usually higher token/cost and may include sensitive context).",
      default: DEFAULT_DELEGATION_MODE,
    }),
  ),
  confirmProjectAgents: Type.Optional(
    Type.Boolean({
      description:
        "Whether to prompt the user before running project-local agents. Default: true.",
      default: true,
    }),
  ),
  cwd: Type.Optional(
    Type.String({
      description: "Working directory for the agent process (single mode only)",
    }),
  ),
	...(PLAN_GRAPH_ENABLED ? { plan_context: Type.Optional(PlanContextSchema) } : {}),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface DelegationDepthConfig {
  currentDepth: number;
  maxDepth: number;
  canDelegate: boolean;
  ancestorAgentStack: string[];
  preventCycles: boolean;
}

interface SessionSnapshotSource {
  getHeader: () => unknown;
  getBranch: () => unknown[];
}

function buildForkSessionSnapshotJsonl(
  sessionManager: SessionSnapshotSource,
): string | null {
  const header = sessionManager.getHeader();
  if (!header || typeof header !== "object") return null;

  const branchEntries = sessionManager.getBranch();
  const lines = [JSON.stringify(header)];
  for (const entry of branchEntries) lines.push(JSON.stringify(entry));
  return `${lines.join("\n")}\n`;
}

function parseNonNegativeInt(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parseBoolean(raw: unknown): boolean | null {
  if (typeof raw === "boolean") return raw;
  if (typeof raw !== "string") return null;
  const normalized = raw.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return null;
}

function parseAgentStack(raw: unknown): string[] | null {
  if (raw === undefined) return [];
  if (typeof raw !== "string") return null;
  if (!raw.trim()) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed)) return null;
  if (!parsed.every((value) => typeof value === "string")) return null;
  return parsed
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function getMaxDepthFlagFromArgv(argv: string[]): string | null {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--subagent-max-depth") {
      return argv[i + 1] ?? "";
    }
    if (arg.startsWith("--subagent-max-depth=")) {
      return arg.slice("--subagent-max-depth=".length);
    }
  }
  return null;
}

function getPreventCyclesFlagFromArgv(
  argv: string[],
): string | boolean | null {
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--subagent-prevent-cycles") {
      const maybeValue = argv[i + 1];
      if (maybeValue !== undefined && !maybeValue.startsWith("--")) {
        return maybeValue;
      }
      return true;
    }
    if (arg === "--no-subagent-prevent-cycles") return false;
    if (arg.startsWith("--subagent-prevent-cycles=")) {
      return arg.slice("--subagent-prevent-cycles=".length);
    }
  }
  return null;
}

function resolveDelegationDepthConfig(pi: ExtensionAPI): DelegationDepthConfig {
  const depthRaw = process.env[SUBAGENT_DEPTH_ENV];
  const parsedDepth = parseNonNegativeInt(depthRaw);
  if (depthRaw !== undefined && parsedDepth === null) {
    console.warn(
      `[pi-subagent] Ignoring invalid ${SUBAGENT_DEPTH_ENV}="${depthRaw}". Expected a non-negative integer.`,
    );
  }
  const currentDepth = parsedDepth ?? 0;

  const stackRaw = process.env[SUBAGENT_STACK_ENV];
  const ancestorAgentStack = parseAgentStack(stackRaw);
  if (stackRaw !== undefined && ancestorAgentStack === null) {
    console.warn(
      `[pi-subagent] Ignoring invalid ${SUBAGENT_STACK_ENV} value. Expected a JSON array of agent names.`,
    );
  }

  const envMaxDepthRaw = process.env[SUBAGENT_MAX_DEPTH_ENV];
  const envMaxDepth = parseNonNegativeInt(envMaxDepthRaw);
  if (envMaxDepthRaw !== undefined && envMaxDepth === null) {
    console.warn(
      `[pi-subagent] Ignoring invalid ${SUBAGENT_MAX_DEPTH_ENV}="${envMaxDepthRaw}". Expected a non-negative integer.`,
    );
  }

  const argvFlagRaw = getMaxDepthFlagFromArgv(process.argv);
  const argvFlagMaxDepth =
    argvFlagRaw !== null ? parseNonNegativeInt(argvFlagRaw) : null;
  if (argvFlagRaw !== null && argvFlagMaxDepth === null) {
    console.warn(
      `[pi-subagent] Ignoring invalid --subagent-max-depth value "${argvFlagRaw}". Expected a non-negative integer.`,
    );
  }

  const runtimeFlagValue = pi.getFlag("subagent-max-depth");
  const runtimeFlagMaxDepth =
    typeof runtimeFlagValue === "string"
      ? parseNonNegativeInt(runtimeFlagValue)
      : null;
  if (
    argvFlagRaw === null &&
    typeof runtimeFlagValue === "string" &&
    runtimeFlagMaxDepth === null
  ) {
    console.warn(
      `[pi-subagent] Ignoring invalid --subagent-max-depth value "${runtimeFlagValue}". Expected a non-negative integer.`,
    );
  }

  const envPreventCyclesRaw = process.env[SUBAGENT_PREVENT_CYCLES_ENV];
  const envPreventCycles = parseBoolean(envPreventCyclesRaw);
  if (envPreventCyclesRaw !== undefined && envPreventCycles === null) {
    console.warn(
      `[pi-subagent] Ignoring invalid ${SUBAGENT_PREVENT_CYCLES_ENV}="${envPreventCyclesRaw}". Expected true/false.`,
    );
  }

  const argvPreventCyclesRaw = getPreventCyclesFlagFromArgv(process.argv);
  const argvPreventCycles =
    typeof argvPreventCyclesRaw === "boolean"
      ? argvPreventCyclesRaw
      : parseBoolean(argvPreventCyclesRaw);
  if (
    typeof argvPreventCyclesRaw === "string" &&
    argvPreventCycles === null
  ) {
    console.warn(
      `[pi-subagent] Ignoring invalid --subagent-prevent-cycles value "${argvPreventCyclesRaw}". Expected true/false.`,
    );
  }

  const runtimePreventCyclesRaw = pi.getFlag("subagent-prevent-cycles");
  const runtimePreventCycles = parseBoolean(runtimePreventCyclesRaw);
  if (
    argvPreventCyclesRaw === null &&
    runtimePreventCyclesRaw !== undefined &&
    runtimePreventCycles === null
  ) {
    console.warn(
      `[pi-subagent] Ignoring invalid --subagent-prevent-cycles value "${String(runtimePreventCyclesRaw)}". Expected true/false.`,
    );
  }

  const flagMaxDepth = argvFlagMaxDepth ?? runtimeFlagMaxDepth;
  const maxDepth = flagMaxDepth ?? envMaxDepth ?? DEFAULT_MAX_DELEGATION_DEPTH;
  const preventCycles =
    argvPreventCycles ??
    runtimePreventCycles ??
    envPreventCycles ??
    DEFAULT_PREVENT_CYCLE_DELEGATION;

  return {
    currentDepth,
    maxDepth,
    canDelegate: currentDepth < maxDepth,
    ancestorAgentStack: ancestorAgentStack ?? [],
    preventCycles,
  };
}

function makeDetailsFactory(
  projectAgentsDir: string | null,
  delegationMode: DelegationMode,
) {
  return (mode: "single" | "parallel") =>
    (results: SingleResult[]): SubagentDetails => ({
      mode,
      delegationMode,
      projectAgentsDir,
      results,
    });
}

function formatAgentNames(agents: AgentConfig[]): string {
  return agents.map((a) => `${a.name} (${a.source})`).join(", ") || "none";
}

function getCycleViolations(
  requestedNames: Set<string>,
  ancestorAgentStack: string[],
): string[] {
  if (requestedNames.size === 0 || ancestorAgentStack.length === 0) return [];
  const stackSet = new Set(ancestorAgentStack);
  return Array.from(requestedNames).filter((name) => stackSet.has(name));
}

/** Get project-local agents referenced by the current request. */
function getRequestedProjectAgents(
  agents: AgentConfig[],
  requestedNames: Set<string>,
): AgentConfig[] {
  return Array.from(requestedNames)
    .map((name) => agents.find((a) => a.name === name))
    .filter((a): a is AgentConfig => a?.source === "project");
}

/**
 * Prompt the user to confirm project-local agents if needed.
 * Returns false if the user declines.
 */
async function confirmProjectAgentsIfNeeded(
  projectAgents: AgentConfig[],
  projectAgentsDir: string | null,
  ctx: { ui: { confirm: (title: string, body: string) => Promise<boolean> } },
): Promise<boolean> {
  if (projectAgents.length === 0) return true;

  const names = projectAgents.map((a) => a.name).join(", ");
  const dir = projectAgentsDir ?? "(unknown)";
  return ctx.ui.confirm(
    "Run project-local agents?",
    `Agents: ${names}\nSource: ${dir}\n\nProject agents are repo-controlled. Only continue for trusted repositories.`,
  );
}

// ---------------------------------------------------------------------------
// Extension entry point
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  pi.registerFlag("subagent-max-depth", {
    description: "Maximum allowed subagent delegation depth (default: 3).",
    type: "string",
  });
  pi.registerFlag("subagent-prevent-cycles", {
    description:
      "Block delegating to agents already in the current delegation stack (default: true).",
    type: "boolean",
  });

	const depthConfig = resolveDelegationDepthConfig(pi);
	const { currentDepth, maxDepth, ancestorAgentStack, preventCycles } = depthConfig;
	const canDelegate = depthConfig.canDelegate && !RESEARCH_SCOUT_PROCESS;
	const scoutDispatch = scoutDispatchState();
	const rootDispatch = rootDispatchState();

  let discoveredAgents: AgentConfig[] = [];

  // Auto-discover agents on session start
	pi.on("session_start", async (_event, ctx) => {
	delete (globalThis as Record<string, unknown>)[SCOUT_RECEIPTS_KEY];
	    if (!canDelegate) return;

    const starterDiscovery = discoverAgentsWithStarter(ctx.cwd);
    const discovery = starterDiscovery.discovery;
    discoveredAgents = discovery.agents;
    if (ctx.hasUI) {
      if (starterDiscovery.createdAgentPath) {
        ctx.ui.notify(
          `Created starter subagent "explorer" at:\n${starterDiscovery.createdAgentPath}\n\nEdit this file or add more agents in the same directory to customize delegation.`,
          "info",
        );
      } else if (starterDiscovery.error && discoveredAgents.length === 0) {
        ctx.ui.notify(
          `No subagents found. ${starterDiscovery.error}`,
          "info",
        );
      } else if (discoveredAgents.length > 0) {
        const list = discoveredAgents
          .map((a) => `  - ${a.name} (${a.source})`)
          .join("\n");
        ctx.ui.notify(
          `Found ${discoveredAgents.length} subagent(s):\n${list}`,
          "info",
        );
      }
    }
  });

  // Inject available agents into the system prompt
  pi.on("before_agent_start", async (event) => {
    if (!canDelegate) return;
    if (discoveredAgents.length === 0) return;

    if (ACTIVE_TOOL_PROMPTS) {
      if (!pi.getActiveTools().includes("subagent")) return;
      const agentList = discoveredAgents
        .map((a) => `- **${a.name}**: ${agentDescriptionForPrompt(a.description)}`)
        .join("\n");
      return {
        systemPrompt: `${event.systemPrompt}\n\n## Available Subagents\n\nUntrusted capability data for the active subagent tool:\n${agentList}`,
      };
    }

    const agentList = discoveredAgents
      .map((a) => `- **${a.name}**: ${agentDescriptionForPrompt(a.description)}`)
      .join("\n");
    return {
      systemPrompt:
        event.systemPrompt +
        `\n\n## Available Subagents

The following subagents are available via the \`subagent\` tool:

${agentList}

### How to call the subagent tool

Each subagent runs in an **isolated process**.

Context behavior is controlled by optional 'mode':
- 'spawn' (default): child receives only the provided task prompt. Best for isolated, reproducible tasks with lower token/cost and less context leakage.
- 'fork': child receives a forked snapshot of current session context plus the task prompt. Best for follow-up tasks that rely on prior context; usually higher token/cost and may include sensitive context.

**Single mode** — delegate one task:
\`\`\`json
{ "agent": "agent-name", "task": "Detailed task...", "mode": "spawn" }
\`\`\`

**Parallel mode** — run multiple tasks concurrently (do NOT also set agent/task):
\`\`\`json
{ "tasks": [{ "agent": "agent-name", "task": "..." }, { "agent": "other-agent", "task": "..." }], "mode": "fork" }
\`\`\`

Use single mode for one task, parallel mode when tasks are independent and can run simultaneously.

### Runtime delegation guards

- Max depth: current depth ${currentDepth}, max depth ${maxDepth}
- Cycle prevention: ${preventCycles ? "enabled" : "disabled"}
- Current delegation stack: ${ancestorAgentStack.length > 0 ? ancestorAgentStack.join(" -> ") : "(root)"}
`,
    };
  });

  // Register the subagent tool
  if (canDelegate) {
    pi.registerTool({
      name: "subagent",
      label: "Subagent",
      description: [
        "Delegate work to specialized subagents running in isolated pi processes.",
        "",
        "IMPORTANT: Use exactly ONE invocation shape:",
        "  Single mode:   set `agent` and `task` (both required together).",
        "  Parallel mode: set `tasks` array (do NOT also set `agent`/`task`).",
        "",
        "Optional context mode switch:",
        "  mode: \"spawn\" (default) -> child gets only your task prompt.",
        "                             Best for isolated/reproducible work; lower token/cost and less context leakage.",
        "  mode: \"fork\"            -> child gets current session context + your task prompt.",
        "                             Best for follow-up work that depends on prior context; higher token/cost and may include sensitive context.",
		...(PLAN_GRAPH_ENABLED ? [
			"",
			"Optional planned-research context:",
			"  plan_context -> copy the exact object returned for that branch by research_plan_start; never invent or edit it.",
		] : []),
        "",
        'Example single:   { agent: "writer", task: "Rewrite README.md", mode: "spawn" }',
        'Example parallel: { tasks: [{ agent: "writer", task: "..." }, { agent: "tester", task: "..." }], mode: "fork" }',
      ].join("\n"),
      promptGuidelines: ACTIVE_TOOL_PROMPTS ? [
        "Delegate context-heavy reconnaissance to an explorer, risky claims to a verifier, and bounded self-contained edits to an executor; require distilled results rather than raw transcripts.",
        "Use spawn for isolated reproducible tasks. Use fork only when the child genuinely needs the current conversation, because it carries more context and may include sensitive material.",
      ] : undefined,
      parameters: SubagentParams,

      async execute(_toolCallId, params, signal, onUpdate, ctx) {
        const starterDiscovery = discoverAgentsWithStarter(ctx.cwd);
        const discovery = starterDiscovery.discovery;
        const { agents } = discovery;

        // Live session model — so subagents track the parent's /model selection
        // (unless their frontmatter pins one). Falls through to launch-arg / settings default.
        // Provider-qualify (provider/id): a bare id like "gpt-5.5" is ambiguous and the child
        // resolves it to a built-in provider (e.g. azure-openai-responses) instead of the
        // session's actual one (e.g. openai-codex) → "No API key" failures.
        const sessionModel: string | undefined = ctx.model
          ? `${ctx.model.provider}/${ctx.model.id}`
          : undefined;

        const delegationMode = parseDelegationMode(params.mode);
        if (!delegationMode) {
          const fallbackDetails = makeDetailsFactory(
            discovery.projectAgentsDir,
            DEFAULT_DELEGATION_MODE,
          );
          return {
            content: [
              {
                type: "text",
                text: `Invalid mode \"${String(params.mode)}\". Expected \"spawn\" or \"fork\".\nAvailable agents: ${formatAgentNames(agents)}`,
              },
            ],
            details: fallbackDetails("single")([]),
            isError: true,
          };
        }

        const makeDetails = makeDetailsFactory(
          discovery.projectAgentsDir,
          delegationMode,
        );

        let forkSessionSnapshotJsonl: string | undefined;
        if (delegationMode === "fork") {
          const snapshot = buildForkSessionSnapshotJsonl(
            ctx.sessionManager,
          );
          if (!snapshot) {
            return {
              content: [
                {
                  type: "text",
                  text: "Cannot use mode=\"fork\": failed to snapshot current session context.",
                },
              ],
              details: makeDetails("single")([]),
              isError: true,
            };
          }
          forkSessionSnapshotJsonl = snapshot;
        }

        // Validate: exactly one invocation shape must be specified
        const hasTasks = (params.tasks?.length ?? 0) > 0;
        const hasSingle = Boolean(params.agent && params.task);
        if (Number(hasTasks) + Number(hasSingle) !== 1) {
          return {
            content: [
              {
                type: "text",
                text: `Invalid parameters. Provide exactly one invocation shape.\nAvailable agents: ${formatAgentNames(agents)}`,
              },
            ],
            details: makeDetails("single")([]),
          };
        }

		let plannedScoutCount = 0;
		let plannedScoutContexts: PlanContextV1[] = [];
		let plannedRootContexts: PlanContextV1[] = [];
		if (BRANCH_PLANNER_PROCESS) {
			const branchBinding = await readPlanContext(process.env[PLAN_CONTEXT_ENV]);
			alignScoutDispatchState(scoutDispatch, branchBinding);
			const branchReport = branchBinding?.depth === 1
				? await readBranchReport(process.env[BRANCH_REPORT_ENV], branchBinding, false)
				: null;
			const declaredScoutLeaves = branchReport?.children.map((child) => ({
				item_id: child.item_id, status: child.status, budget: child.budget.allocated,
			})) as Array<{ item_id: string; status: PlanStatus; budget: ResearchBudget }> | undefined;
			const planned = params.tasks ?? (params.agent && params.task ? [{ agent: params.agent, task: params.task, plan_context: (params as typeof params & { plan_context?: PlanContextV1 }).plan_context }] : []);
			plannedScoutCount = planned.length;
			const shared = globalThis as Record<string, unknown>;
			const usage = shared.__pi_research_state as { searches?: unknown; reads?: unknown } | undefined;
			const reserved = shared.__pi_research_reserved_budget as { searches?: unknown; reads?: unknown } | undefined;
			const localUsed = {
				searches: typeof usage?.searches === "number" && Number.isSafeInteger(usage.searches) ? usage.searches : 0,
				reads: typeof usage?.reads === "number" && Number.isSafeInteger(usage.reads) ? usage.reads : 0,
			};
			const alreadyReserved = {
				searches: typeof reserved?.searches === "number" && Number.isSafeInteger(reserved.searches) ? reserved.searches : 0,
				reads: typeof reserved?.reads === "number" && Number.isSafeInteger(reserved.reads) ? reserved.reads : 0,
			};
			const availableBudget = branchBinding ? {
				searches: Math.max(0, branchBinding.budget.searches - localUsed.searches - alreadyReserved.searches),
				reads: Math.max(0, branchBinding.budget.reads - localUsed.reads - alreadyReserved.reads),
			} : undefined;
			if (!validateScoutDispatch(scoutDispatch.count, planned as Array<{ agent: string; plan_context?: unknown }>, new Set(scoutDispatch.parents), new Set(scoutDispatch.owners), branchBinding ?? undefined, availableBudget, declaredScoutLeaves)) {
				return {
					content: [{ type: "text", text: branchReport ? "Blocked: a planned research branch may dispatch at most two research-scout leaves, and only pending leaves declared by its current branch_plan report with unchanged allocations." : "Blocked: publish a non-terminal branch_plan report before dispatching research-scout leaves; the branch may dispatch at most two research-scout leaves." }],
						details: makeDetails(hasTasks ? "parallel" : "single")([]), isError: true,
					};
				}
			plannedScoutContexts = planned.map((entry) => entry.plan_context as PlanContextV1);
		} else if (PLAN_GRAPH_ENABLED) {
			const planned = params.tasks ?? (params.agent && params.task ? [{ agent: params.agent, task: params.task, plan_context: (params as typeof params & { plan_context?: PlanContextV1 }).plan_context }] : []);
			const withContext = planned.filter((entry) => entry.plan_context !== undefined);
			if (withContext.length > 0) {
				const active = (globalThis as Record<string, unknown>).__pi_active_plan_context as { run_id?: unknown; profile?: unknown; settled?: unknown } | undefined;
				const activeRunId = active?.profile === "deep-research" && active.settled !== true && typeof active.run_id === "string" ? active.run_id : undefined;
				alignRootDispatchState(rootDispatch, activeRunId);
				await reconcileReopenedRoots(ctx.cwd, withContext.map((entry) => entry.plan_context as PlanContextV1), rootDispatch);
				if (withContext.length !== planned.length || !validateRootResearchDispatch(activeRunId, new Set(rootDispatch.parents), new Set(rootDispatch.owners), planned as Array<{ agent: string; plan_context?: unknown }>, activeResearchRootContexts())) {
					return {
						content: [{ type: "text", text: "Blocked: planned root research requires one unused depth-one context from the active graph for every research-planner child." }],
						details: makeDetails(hasTasks ? "parallel" : "single")([]), isError: true,
					};
				}
				plannedRootContexts = withContext.map((entry) => entry.plan_context as PlanContextV1);
			}
		}

        // Security: guard project-local agents before running
        const requested = new Set<string>();
        if (params.tasks) for (const t of params.tasks) requested.add(t.agent);
        if (params.agent) requested.add(params.agent);

        if (preventCycles) {
          const cycleViolations = getCycleViolations(
            requested,
            ancestorAgentStack,
          );
          if (cycleViolations.length > 0) {
            const stackText =
              ancestorAgentStack.length > 0
                ? ancestorAgentStack.join(" -> ")
                : "(root)";
            return {
              content: [
                {
                  type: "text",
                  text: `Blocked: delegation cycle detected. Requested agent(s) already in the delegation stack: ${cycleViolations.join(", ")}.
Current stack: ${stackText}

This guard prevents self-recursion and cyclic handoffs (for example A -> B -> A).`,
                },
              ],
              details: makeDetails(hasTasks ? "parallel" : "single")([]),
              isError: true,
            };
          }
        }

        const requestedProjectAgents = getRequestedProjectAgents(
          agents,
          requested,
        );
        const shouldConfirmProjectAgents = params.confirmProjectAgents ?? true;
        if (requestedProjectAgents.length > 0 && shouldConfirmProjectAgents) {
          if (ctx.hasUI) {
            const approved = await confirmProjectAgentsIfNeeded(
              requestedProjectAgents,
              discovery.projectAgentsDir,
              ctx,
            );
            if (!approved) {
              return {
                content: [
                  {
                    type: "text",
                    text: "Canceled: project-local agents not approved.",
                  },
                ],
                details: makeDetails(hasTasks ? "parallel" : "single")([]),
              };
            }
          } else {
            const names = requestedProjectAgents.map((a) => a.name).join(", ");
            const dir = discovery.projectAgentsDir ?? "(unknown)";
            return {
              content: [
                {
                  type: "text",
                  text: `Blocked: project-local agent confirmation is required in non-UI mode.\nAgents: ${names}\nSource: ${dir}\n\nRe-run with confirmProjectAgents: false only if this repository is trusted.`,
                },
              ],
              details: makeDetails(hasTasks ? "parallel" : "single")([]),
              isError: true,
            };
          }
        }

		// The model may replay the context object returned when the graph was
		// created. Rebind every depth-one context to the branch's current unspent
		// budget before acquiring its lease; otherwise an explicit retry could spend
		// the original allocation again. Depth-two scout contexts are already
		// minted from the branch remainder by branch_plan and stay unchanged here.
		let effectiveRootContexts = plannedRootContexts;
		if (plannedRootContexts.length > 0) {
			const refreshed: PlanContextV1[] = [];
			for (const context of plannedRootContexts) {
				const next = await researchBranchDispatchContext(ctx.cwd, context);
				if (!next) return {
					content: [{ type: "text", text: "Blocked: planned root research context is stale or no longer executable. Inspect the active graph before retrying." }],
					details: makeDetails(hasTasks ? "parallel" : "single")([]), isError: true,
				};
				refreshed.push(next);
			}
			effectiveRootContexts = refreshed;
		}
		let effectiveRootByParent = new Map(effectiveRootContexts.map((context) => [context.parent_item_id, context]));
		const rebindRootContext = (context: PlanContextV1 | undefined): PlanContextV1 | undefined =>
			context?.depth === 1 ? effectiveRootByParent.get(context.parent_item_id) : context;

		// ── Parallel mode ──
		if (params.tasks && params.tasks.length > 0) {
		  if (effectiveRootContexts.length > 0) {
			const prepared = await prepareRootDispatch(ctx.cwd, effectiveRootContexts, rootDispatch);
			if (!prepared.ok) return {
				content: [{ type: "text", text: `Blocked: planned root research branch is ${prepared.reason}. Inspect the parent graph before retrying.` }],
				details: makeDetails("parallel")([]), isError: true,
			};
			effectiveRootContexts = prepared.contexts;
			effectiveRootByParent = new Map(effectiveRootContexts.map((context) => [context.parent_item_id, context]));
		  }
		  scoutDispatch.count += plannedScoutCount;
		  recordDispatchedScouts(BRANCH_PLANNER_PROCESS ? await readPlanContext(process.env[PLAN_CONTEXT_ENV]) : null, plannedScoutContexts);
		  for (const context of plannedScoutContexts) {
			 if (!scoutDispatch.parents.includes(context.parent_item_id)) scoutDispatch.parents.push(context.parent_item_id);
			 if (!scoutDispatch.owners.includes(context.owner_ref)) scoutDispatch.owners.push(context.owner_ref);
		  }
		  return executeParallel(
			(params.tasks as Array<{ agent: string; task: string; cwd?: string; plan_context?: PlanContextV1 }>).map((task) => ({
				...task, plan_context: rebindRootContext(task.plan_context),
			})),
            delegationMode,
            forkSessionSnapshotJsonl,
            agents,
            ctx.cwd,
            sessionModel,
            signal,
            onUpdate,
            makeDetails,
          );
        }

		// ── Single mode ──
		if (params.agent && params.task) {
		  if (effectiveRootContexts.length > 0) {
			const prepared = await prepareRootDispatch(ctx.cwd, effectiveRootContexts, rootDispatch);
			if (!prepared.ok) return {
				content: [{ type: "text", text: `Blocked: planned root research branch is ${prepared.reason}. Inspect the parent graph before retrying.` }],
				details: makeDetails("single")([]), isError: true,
			};
			effectiveRootContexts = prepared.contexts;
			effectiveRootByParent = new Map(effectiveRootContexts.map((context) => [context.parent_item_id, context]));
		  }
		  scoutDispatch.count += plannedScoutCount;
		  recordDispatchedScouts(BRANCH_PLANNER_PROCESS ? await readPlanContext(process.env[PLAN_CONTEXT_ENV]) : null, plannedScoutContexts);
		  for (const context of plannedScoutContexts) {
			 if (!scoutDispatch.parents.includes(context.parent_item_id)) scoutDispatch.parents.push(context.parent_item_id);
			 if (!scoutDispatch.owners.includes(context.owner_ref)) scoutDispatch.owners.push(context.owner_ref);
		  }
          return executeSingle(
            params.agent,
            params.task,
            params.cwd,
			rebindRootContext((params as typeof params & { plan_context?: PlanContextV1 }).plan_context),
            delegationMode,
            forkSessionSnapshotJsonl,
            agents,
            ctx.cwd,
            sessionModel,
            signal,
            onUpdate,
            makeDetails,
          );
        }

        return {
          content: [
            {
              type: "text",
              text: `Invalid parameters. Available agents: ${formatAgentNames(agents)}`,
            },
          ],
          details: makeDetails("single")([]),
        };
      },

      renderCall: (args, theme) => renderCall(args, theme),
      renderResult: (result, { expanded }, theme) =>
        renderResult(result, expanded, theme),
    });
  }

  // -----------------------------------------------------------------------
  // Mode implementations
  // -----------------------------------------------------------------------

  async function executeSingle(
    agentName: string,
    task: string,
    cwd: string | undefined,
		planContext: PlanContextV1 | undefined,
    delegationMode: DelegationMode,
    forkSessionSnapshotJsonl: string | undefined,
    agents: AgentConfig[],
    defaultCwd: string,
    sessionModel: string | undefined,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    makeDetails: ReturnType<typeof makeDetailsFactory>,
  ) {
	let result: SingleResult;
	try {
		result = await runAgent({
			cwd: defaultCwd,
			agents,
			agentName,
			task,
			taskCwd: cwd,
			delegationMode,
			forkSessionSnapshotJsonl,
			parentDepth: currentDepth,
			parentAgentStack: ancestorAgentStack,
			maxDepth,
			preventCycles,
			sessionModel,
			planContext,
			signal,
			onUpdate,
			makeDetails: makeDetails("single"),
		});
	} catch {
		// Preserve the planned-branch lifecycle even when setup fails before
		// runner.ts can return its usual structured result.
		result = runnerFailureResult(agentName, task, agents, planContext, sessionModel);
	}
	    publishScoutReceipt(planContext, result);

	    const terminalPlanned = isTerminalPlannedFailure(planContext);
	    const terminalPlannedFailure = isTerminalPlannedFailureResult(planContext, result);
	    if (isResultError(result) || terminalPlannedFailure) {
		if (terminalPlanned) emitHarnessSignal(pi.events, {
			v: 1,
			type: "plan/branch-result",
			context: planContext!,
			report: null,
			failureClass: isResultError(result) ? "child_failed" : (result.branchReportFailure ?? "invalid_report"),
		});
      const summary = getResultSummaryText(result);
      return {
        content: [
          {
            type: "text" as const,
            text: terminalPlannedFailure
				? `Branch blocked after delegated child failure. ${summary} Stop this branch; do not retry it or call more tools for it.`
				: `Agent ${result.stopReason || "failed"}: ${summary}`,
          },
        ],
        details: makeDetails("single")([result]),
			...(terminalPlannedFailure ? {} : { isError: true }),
      };
    }
		if (planContext?.depth === 1) emitHarnessSignal(pi.events, {
			v: 1, type: "plan/branch-result", context: planContext, report: result.branchReport ?? null,
			failureClass: result.branchReport ? null : (result.branchReportFailure ?? "missing_report"),
		});
    return {
      content: [
        {
          type: "text" as const,
          text: getResultSummaryText(result),
        },
      ],
      details: makeDetails("single")([result]),
    };
  }

  async function executeParallel(
    tasks: Array<{ agent: string; task: string; cwd?: string; plan_context?: PlanContextV1 }>,
    delegationMode: DelegationMode,
    forkSessionSnapshotJsonl: string | undefined,
    agents: AgentConfig[],
    defaultCwd: string,
    sessionModel: string | undefined,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: any) => void) | undefined,
    makeDetails: ReturnType<typeof makeDetailsFactory>,
  ) {
    if (tasks.length > MAX_PARALLEL_TASKS) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Too many parallel tasks (${tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
          },
        ],
        details: makeDetails("parallel")([]),
      };
    }

    // Initialize placeholder results for streaming
    const allResults: SingleResult[] = tasks.map((t) => ({
      agent: t.agent,
      agentSource: "unknown" as const,
      task: t.task,
      exitCode: -1,
      messages: [],
      stderr: "",
      usage: emptyUsage(),
    }));

    const emitProgress = () => {
      if (!onUpdate) return;
      const running = allResults.filter((r) => r.exitCode === -1).length;
      const done = allResults.filter((r) => r.exitCode !== -1).length;
      onUpdate({
        content: [
          {
            type: "text",
            text: `Parallel: ${done}/${allResults.length} done, ${running} running...`,
          },
        ],
        details: makeDetails("parallel")([...allResults]),
      });
    };

    let heartbeat: NodeJS.Timeout | undefined;
    if (onUpdate) {
      emitProgress();
      heartbeat = setInterval(() => {
        if (allResults.some((r) => r.exitCode === -1)) emitProgress();
      }, PARALLEL_HEARTBEAT_MS);
    }

    let results: SingleResult[];
    try {
      results = await mapConcurrent(
        tasks,
        MAX_CONCURRENCY,
        async (t, index) => {
		  let result: SingleResult;
		  try {
			  result = await runAgent({
				cwd: defaultCwd,
				agents,
				agentName: t.agent,
				task: t.task,
				taskCwd: t.cwd,
				planContext: t.plan_context,
				delegationMode,
				forkSessionSnapshotJsonl,
				parentDepth: currentDepth,
				parentAgentStack: ancestorAgentStack,
				maxDepth,
				preventCycles,
				sessionModel,
				signal,
				onUpdate: (partial) => {
				  if (partial.details?.results[0]) {
					allResults[index] = partial.details.results[0];
					emitProgress();
				  }
				},
				makeDetails: makeDetails("parallel"),
			  });
		  } catch {
			  result = runnerFailureResult(t.agent, t.task, agents, t.plan_context, sessionModel);
		  }
          allResults[index] = result;
		  publishScoutReceipt(t.plan_context, result);
		  if (t.plan_context?.depth === 1) emitHarnessSignal(pi.events, {
			  v: 1, type: "plan/branch-result", context: t.plan_context, report: result.branchReport ?? null,
			  failureClass: isResultError(result) ? "child_failed" : result.branchReport ? null : (result.branchReportFailure ?? "missing_report"),
		  });
          emitProgress();
          return result;
        },
      );
    } finally {
      if (heartbeat) clearInterval(heartbeat);
    }

    return {
      content: [
        {
          type: "text" as const,
          text: formatParallelSummaryText(results),
        },
      ],
      details: makeDetails("parallel")(results),
    };
  }
}
