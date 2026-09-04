/**
 * Subagent process runner.
 *
 * Spawns isolated `pi` processes and streams results back via callbacks.
 */

import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AgentConfig } from "./agents.js";
import { parseInheritedCliArgs } from "./runner-cli.js";
import { processPiJsonLine } from "./runner-events.js";
import { buildSubagentEnv } from "./runner-env.js";
import { currentSessionId } from "../../lib/telemetry.ts";
import { BRANCH_REPORT_ENV, PLAN_CONTEXT_ENV, RESEARCH_SCOUT_ENV, readBranchReport, validatePlanContext, validatePlanContextRole, type PlanContextV1 } from "../../lib/branch-report.ts";
import {
  type DelegationMode,
  type SingleResult,
  type SubagentDetails,
  emptyUsage,
  getFinalOutput,
  normalizeCompletedResult,
  isResultError,
} from "./types.js";

const isWindows = process.platform === "win32";
const SIGKILL_TIMEOUT_MS = 5000;
const AGENT_END_GRACE_MS = 250;
const SUBAGENT_DEPTH_ENV = "PI_SUBAGENT_DEPTH";
const SUBAGENT_MAX_DEPTH_ENV = "PI_SUBAGENT_MAX_DEPTH";
const SUBAGENT_STACK_ENV = "PI_SUBAGENT_STACK";
const SUBAGENT_PREVENT_CYCLES_ENV = "PI_SUBAGENT_PREVENT_CYCLES";
const PI_OFFLINE_ENV = "PI_OFFLINE";
import { resolveSubagentTimeoutMs } from "./timeout.js";

type OnUpdateCallback = (partial: AgentToolResult<SubagentDetails>) => void;

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

/**
 * Derive the spawn command from the current process context so child invocations
 * work on Unix and Windows without going through a shell wrapper.
 */
function resolvePiSpawn(): { command: string; prefixArgs: string[] } {
  const isNode = /[\\/]node(?:\.exe)?$/i.test(process.execPath);
  if (isNode && process.argv[1]) {
    return { command: process.execPath, prefixArgs: [process.argv[1]] };
  }
  return { command: process.execPath, prefixArgs: [] };
}

// ---------------------------------------------------------------------------
// Temp file helpers
// ---------------------------------------------------------------------------

function writePromptToTempFile(
  agentName: string,
  prompt: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  fs.writeFileSync(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function writeForkSessionToTempFile(
  agentName: string,
  sessionJsonl: string,
): { dir: string; filePath: string } {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `fork-${safeName}.jsonl`);
  fs.writeFileSync(filePath, sessionJsonl, { encoding: "utf-8", mode: 0o600 });
  return { dir: tmpDir, filePath };
}

function cleanupTempDir(dir: string | null): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

function writePlanContextToTemp(context: PlanContextV1): { dir: string; contextPath: string; reportPath: string } {
	if (!validatePlanContext(context)) throw new Error("invalid delegated plan_context");
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-plan-"));
	const contextPath = path.join(dir, "context.json");
	const reportPath = path.join(dir, "report.json");
	fs.writeFileSync(contextPath, `${JSON.stringify(context)}\n`, { encoding: "utf8", mode: 0o600 });
	return { dir, contextPath, reportPath };
}

// ---------------------------------------------------------------------------
// Build pi CLI arguments
// ---------------------------------------------------------------------------

const inheritedCliArgs = parseInheritedCliArgs(process.argv);

/**
 * A depth-one research planner has a private report channel in addition to
 * Pi's ordinary assistant transcript.  A natural-language final answer is not
 * sufficient to close that channel: the parent cannot safely merge claims or
 * release the branch lease without a validated branch_plan artifact.  Keep
 * this instruction at the runner boundary so it is present even when an agent
 * prompt is stale, reordered, or supplied by a project-local override.
 */
export function buildPlannedBranchTask(task: string, context?: PlanContextV1): string {
	if (context?.depth !== 1) return task;
	return `${task}\n\nPLANNED BRANCH PROTOCOL (mandatory):\nYou MUST invoke the \`branch_plan\` tool before ending this child run, with a validated report: use a terminal status (done, blocked, or deferred) for a resolved branch, or a pending status only when declaring bounded scout leaves. A plain-text RESULT is not a valid completion and will be treated as a missing report. Do not stop or return text until \`branch_plan\` has been accepted.\n\nCoverage invariant (copy exactly): coverage.complete MUST be true only when truncated=false, budget_exhausted=false, failed=false, and scope=bounded (or scope=exhaustive with returned_count=total_count). If the web tool says the result is truncated, failed, or budget-limited, set that flag true, set complete=false, include at least one evidence_gaps entry, and prefer \`deferred\` when partial evidence remains (with defer.value, defer.risk, and defer.rationale); use blocked only when there is no viable path. A done report requires complete=true, no evidence_gaps, and at least one source lead with positive retrieval yield. Minimal deferred shape: status=deferred; consumed={searches:<observed>,reads:<observed>}; children=[]; source_leads=[one usable lead if any]; evidence_gaps=[short unresolved gap]; coverage={strategy:\"direct\",scope:\"bounded\",returned_count:<leads>,truncated:<flag>,budget_exhausted:<flag>,failed:<flag>,complete:false}; defer={value:\"what remains useful\",risk:\"what may be wrong\",rationale:\"why it is deferred\"}. Do not invent total_count for bounded coverage. After \`branch_plan\` returns, stop this branch and do not perform further research or delegation.`;
}

/** Planned children communicate through their bounded report/receipt channel.
 * Streaming each cumulative child transcript through the parent creates an
 * unbounded series of repeated tool-execution payloads and can hit the
 * parent's output cap before the child reaches its final report. Ordinary
 * delegation keeps the interactive progress stream. */
export function shouldStreamSubagentUpdates(context?: PlanContextV1): boolean {
	return context === undefined;
}

/** A planned parallel dispatch has a bounded report channel for every task;
 * aggregate heartbeat snapshots would still replay the cumulative result
 * envelope into the parent. Ordinary progress remains enabled when any task
 * is an unplanned delegation. */
export function shouldStreamParallelUpdates(tasks: ReadonlyArray<{ plan_context?: PlanContextV1 }>): boolean {
	return tasks.some((task) => shouldStreamSubagentUpdates(task.plan_context));
}

/** Turn a completed planned dispatch into an explicit next action for the
 * parent model. The generic child summary intentionally omits branch state;
 * without this bounded, status-only cue a parent can keep rereading or retrying
 * after every branch is already terminal. */
export function plannedResultGuidance(results: ReadonlyArray<SingleResult>): string {
	const planned = results.filter((result) => result.planContext?.depth === 1);
	if (planned.length === 0) return "";
	if (planned.some((result) => isResultError(result) || result.branchReportFailure)) {
		return "\n\nPlanned branch dispatch is terminal for this attempt. Do not retry a failed branch; inspect the graph and report any blocked branch as an explicit evidence gap in the parent answer.";
	}
	const statuses = planned.map((result) => result.branchReport?.status);
	if (statuses.every((status) => status && ["done", "blocked", "deferred"].includes(status))) {
		if (statuses.includes("blocked")) return "\n\nAll planned branches are terminal, including a blocked branch. Do not dispatch again; a blocked branch prevents plan_settle, so state the bounded evidence gap and stop.";
		return "\n\nAll planned branches are terminal. The parent must reread every delegated source lead, then call plan_settle once the parent evidence ledger is complete; do not redispatch these branches.";
	}
	return "\n\nA planned branch report is not terminal yet. Continue only with the declared branch context; do not start a new research plan.";
}

function buildPiArgs(
  agent: AgentConfig,
  systemPromptPath: string | null,
  task: string,
	delegationMode: DelegationMode,
	forkSessionPath: string | null,
	sessionModel: string | undefined,
	planContext: PlanContextV1 | undefined,
): string[] {
  const args: string[] = [
    "--mode",
    "json",
    ...inheritedCliArgs.extensionArgs,
    ...inheritedCliArgs.alwaysProxy,
    "-p",
  ];

  if (delegationMode === "spawn") {
    args.push("--no-session");
  } else if (forkSessionPath) {
    args.push("--session", forkSessionPath);
  }

  const model = agent.model ?? sessionModel ?? inheritedCliArgs.fallbackModel;
  if (model) args.push("--model", model);

  const thinking = agent.thinking ?? inheritedCliArgs.fallbackThinking;
  if (thinking) args.push("--thinking", thinking);

  if (agent.tools && agent.tools.length > 0) {
    args.push("--tools", agent.tools.join(","));
  } else if (agent.tools === undefined) {
    if (inheritedCliArgs.fallbackTools !== undefined) {
      args.push("--tools", inheritedCliArgs.fallbackTools);
    } else if (inheritedCliArgs.fallbackNoTools) {
      args.push("--no-tools");
    }
  }

  if (systemPromptPath) args.push("--append-system-prompt", systemPromptPath);
	args.push(`Task: ${buildPlannedBranchTask(task, planContext)}`);
	return args;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RunAgentOptions {
  /** Fallback working directory when the task doesn't specify one. */
  cwd: string;
  /** All available agent configs. */
  agents: AgentConfig[];
  /** Name of the agent to run. */
  agentName: string;
  /** Task description. */
  task: string;
  /** Optional override working directory. */
  taskCwd?: string;
  /** Context mode: spawn (fresh) or fork (session snapshot + task). */
  delegationMode: DelegationMode;
  /** Serialized parent session snapshot used when delegationMode is "fork". */
  forkSessionSnapshotJsonl?: string;
  /** Current delegation depth of the caller process. */
  parentDepth: number;
  /** Delegation stack from the caller process (ancestor agent names). */
  parentAgentStack: string[];
  /** Maximum allowed delegation depth to propagate to child processes. */
  maxDepth: number;
  /** Whether cycle prevention should be enforced in child processes. */
  preventCycles: boolean;
  /** Live session model id (from ctx.model); used when the agent file pins no model. */
  sessionModel?: string;
  /** Optional bounded branch context. The child may return one validated branch report. */
  planContext?: PlanContextV1;
  /** Abort signal for cancellation. */
  signal?: AbortSignal;
  /** Hard wall-clock limit for the child process. */
  timeoutMs?: number;
  /** Streaming update callback. */
  onUpdate?: OnUpdateCallback;
  /** Factory to wrap results into SubagentDetails. */
  makeDetails: (results: SingleResult[]) => SubagentDetails;
}

/**
 * Spawn a single subagent process and collect its results.
 *
 * Returns a SingleResult even on failure (exitCode > 0, stderr populated).
 */
export async function runAgent(opts: RunAgentOptions): Promise<SingleResult> {
  const {
    cwd,
    agents,
    agentName,
    task,
    taskCwd,
    delegationMode,
    forkSessionSnapshotJsonl,
    parentDepth,
    parentAgentStack,
    maxDepth,
    preventCycles,
    sessionModel,
    planContext,
    signal,
    timeoutMs,
    onUpdate,
    makeDetails,
  } = opts;

  const agent = agents.find((a) => a.name === agentName);
  if (!agent) {
    const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
    return {
      agent: agentName,
      agentSource: "unknown",
      task,
      exitCode: 1,
      messages: [],
      stderr: `Unknown agent: "${agentName}". Available agents: ${available}.`,
      usage: emptyUsage(),
    };
  }

  if (
    delegationMode === "fork" &&
    (!forkSessionSnapshotJsonl || !forkSessionSnapshotJsonl.trim())
  ) {
    return {
      agent: agentName,
      agentSource: agent.source,
      task,
      exitCode: 1,
      messages: [],
      stderr:
        "Cannot run in fork mode: missing parent session snapshot context.",
      usage: emptyUsage(),
      model: agent.model,
      stopReason: "error",
      errorMessage:
        "Cannot run in fork mode: missing parent session snapshot context.",
    };
  }

	if (planContext && !validatePlanContext(planContext)) {
		return {
			agent: agentName, agentSource: agent.source, task, exitCode: 1, messages: [], stderr: "Invalid plan_context.",
			usage: emptyUsage(), model: agent.model, stopReason: "error", errorMessage: "Invalid plan_context.",
		};
	}
	if (!validatePlanContextRole(agentName, planContext)) {
		return {
			agent: agentName, agentSource: agent.source, task, exitCode: 1, messages: [], stderr: "plan_context is missing or does not match the delegated research role.",
			usage: emptyUsage(), model: agent.model, stopReason: "error", errorMessage: "plan_context is missing or does not match the delegated research role.",
		};
	}

  const result: SingleResult = {
    agent: agentName,
    agentSource: agent.source,
    task,
    exitCode: -1,
    messages: [],
    stderr: "",
    usage: emptyUsage(),
    model: agent.model,
  };

  const emitUpdate = () => {
    onUpdate?.({
      content: [
        {
          type: "text",
          text: getFinalOutput(result.messages) || "(running...)",
        },
      ],
      details: makeDetails([result]),
    });
  };

  // Write system prompt to temp file if needed
  let promptTmpDir: string | null = null;
  let promptTmpPath: string | null = null;
  if (agent.systemPrompt.trim()) {
    const tmp = writePromptToTempFile(agent.name, agent.systemPrompt);
    promptTmpDir = tmp.dir;
    promptTmpPath = tmp.filePath;
  }

  // Write forked session snapshot if needed
  let forkSessionTmpDir: string | null = null;
  let forkSessionTmpPath: string | null = null;
  if (delegationMode === "fork" && forkSessionSnapshotJsonl) {
    const tmp = writeForkSessionToTempFile(agent.name, forkSessionSnapshotJsonl);
    forkSessionTmpDir = tmp.dir;
    forkSessionTmpPath = tmp.filePath;
  }

	let planTmpDir: string | null = null;
	let planContextPath: string | null = null;
	let branchReportPath: string | null = null;
	if (planContext) {
		const tmp = writePlanContextToTemp(planContext);
		planTmpDir = tmp.dir;
		planContextPath = tmp.contextPath;
		branchReportPath = planContext.depth === 1 ? tmp.reportPath : null;
		result.planContext = planContext;
	}

  try {
    const piArgs = buildPiArgs(
      agent,
      promptTmpPath,
      task,
		delegationMode,
		forkSessionTmpPath,
		sessionModel,
		planContext,
	);
    let wasAborted = false;
    let wasTimedOut = false;

    const exitCode = await new Promise<number>((resolve) => {
      const nextDepth = Math.max(0, Math.floor(parentDepth)) + 1;
      const propagatedMaxDepth = Math.max(0, Math.floor(maxDepth));
      const propagatedStack = [...parentAgentStack, agentName];
      const { command, prefixArgs } = resolvePiSpawn();
      const proc = spawn(command, [...prefixArgs, ...piArgs], {
        cwd: taskCwd ?? cwd,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
        detached: !isWindows,
        env: {
          ...buildSubagentEnv(process.env, { parentSession: currentSessionId() }),
          [SUBAGENT_DEPTH_ENV]: String(nextDepth),
          [SUBAGENT_MAX_DEPTH_ENV]: String(propagatedMaxDepth),
          [SUBAGENT_STACK_ENV]: JSON.stringify(propagatedStack),
          [SUBAGENT_PREVENT_CYCLES_ENV]: preventCycles ? "1" : "0",
          [PI_OFFLINE_ENV]: "1",
			  ...(planContextPath ? { [PLAN_CONTEXT_ENV]: planContextPath } : {}),
			  ...(branchReportPath ? { [BRANCH_REPORT_ENV]: branchReportPath } : {}),
			  ...(planContext?.depth === 2 ? { [RESEARCH_SCOUT_ENV]: "1" } : {}),
        },
      });

      proc.stdin.on("error", () => {
        /* ignore broken pipe on fast exits */
      });
      proc.stdin.end();

      let buffer = "";
      let didClose = false;
      let settled = false;
      let abortHandler: (() => void) | undefined;
      let semanticCompletionTimer: NodeJS.Timeout | undefined;
      let hardTimeout: NodeJS.Timeout | undefined;

      const clearSemanticCompletionTimer = () => {
        if (semanticCompletionTimer) {
          clearTimeout(semanticCompletionTimer);
          semanticCompletionTimer = undefined;
        }
      };

      const terminateChild = () => {
        if (isWindows) {
          if (proc.pid !== undefined) {
            const killer = spawn("taskkill", ["/T", "/F", "/PID", String(proc.pid)], {
              stdio: "ignore",
            });
            killer.unref();
          }
          return;
        }

        if (proc.pid !== undefined) {
          try { process.kill(-proc.pid, "SIGTERM"); } catch { proc.kill("SIGTERM"); }
        }
        const sigkillTimer = setTimeout(() => {
          if (!didClose && proc.pid !== undefined) {
            try { process.kill(-proc.pid, "SIGKILL"); } catch { proc.kill("SIGKILL"); }
          }
        }, SIGKILL_TIMEOUT_MS);
        sigkillTimer.unref();
      };

      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearSemanticCompletionTimer();
        if (hardTimeout) clearTimeout(hardTimeout);
        if (signal && abortHandler) {
          signal.removeEventListener("abort", abortHandler);
        }
        resolve(code);
      };

      const flushLine = (line: string) => {
        if (processPiJsonLine(line, result)) emitUpdate();
        maybeFinishFromAgentEnd();
      };

      const flushBufferedLines = (text: string) => {
        for (const line of text.split(/\r?\n/)) {
          if (line.trim()) flushLine(line);
        }
      };

      const maybeFinishFromAgentEnd = () => {
        if (!result.sawAgentEnd || didClose || settled) return;
        clearSemanticCompletionTimer();
        semanticCompletionTimer = setTimeout(() => {
          if (didClose || settled || !result.sawAgentEnd) return;
          if (buffer.trim()) {
            flushBufferedLines(buffer);
            buffer = "";
          }
          proc.stdout.removeListener("data", onStdoutData);
          proc.stderr.removeListener("data", onStderrData);
          finish(0);
          terminateChild();
        }, AGENT_END_GRACE_MS);
        semanticCompletionTimer.unref();
      };

      const onStdoutData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || "";
        for (const line of lines) flushLine(line);
      };

      const onStderrData = (chunk: Buffer) => {
        result.stderr += chunk.toString();
      };

      proc.stdout.on("data", onStdoutData);
      proc.stderr.on("data", onStderrData);

      proc.on("close", (code, closeSignal) => {
        didClose = true;
        if (buffer.trim()) flushBufferedLines(buffer);
        if (closeSignal && !wasAborted && !wasTimedOut) {
          result.stopReason = "error";
          result.errorMessage = `Subagent terminated by signal ${closeSignal}.`;
          if (!result.stderr.trim()) result.stderr = result.errorMessage;
        }
        finish(code ?? (closeSignal ? 128 : 1));
      });

      proc.on("error", (err) => {
        if (!result.stderr.trim()) result.stderr = err.message;
        finish(1);
      });

      // Abort handling
      if (signal) {
        abortHandler = () => {
          if (didClose || settled) return;
          wasAborted = true;
          terminateChild();
        };
        if (signal.aborted) abortHandler();
        else signal.addEventListener("abort", abortHandler, { once: true });
      }

      const configuredTimeout = resolveSubagentTimeoutMs(timeoutMs);
      hardTimeout = setTimeout(() => {
        if (didClose || settled) return;
        wasTimedOut = true;
        result.stopReason = "error";
        result.errorMessage = `Subagent timed out after ${configuredTimeout}ms.`;
        if (!result.stderr.trim()) result.stderr = result.errorMessage;
        terminateChild();
      }, Math.max(1, configuredTimeout));
      hardTimeout.unref();
    });

    result.exitCode = exitCode;
    if (wasTimedOut) result.exitCode = 124;
		if (planContext?.depth === 1 && branchReportPath) {
			const report = await readBranchReport(branchReportPath, planContext);
			if (report) result.branchReport = report;
			else result.branchReportFailure = fs.existsSync(branchReportPath) ? "invalid_report" : "missing_report";
		}
    return normalizeCompletedResult(result, wasAborted);
  } finally {
    cleanupTempDir(promptTmpDir);
    cleanupTempDir(forkSessionTmpDir);
		cleanupTempDir(planTmpDir);
  }
}

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

/**
 * Map over items with a bounded number of concurrent workers.
 */
export async function mapConcurrent<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
