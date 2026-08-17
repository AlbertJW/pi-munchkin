import { dirname, join } from "node:path";
import { agentDir } from "./agent-dir.ts";
import { runCapsuleDirectory } from "./run-capsule-store.ts";

export type PlanStorageMode = "project" | "capsule";

export function planStorageMode(env: NodeJS.ProcessEnv = process.env): PlanStorageMode {
	// Plans contain the user's request, implementation notes, and verification
	// history. Keep them out of the repository unless the user explicitly asks
	// for the historical project-local behaviour. RUN_CAPSULE=off remains a
	// complete persistence kill switch, so it necessarily selects the project
	// rollback rather than inventing a second session-identity mechanism.
	if (env.PLAN_STORAGE === "project" || env.RUN_CAPSULE === "off") return "project";
	return "capsule";
}

/** The run-capsule extension publishes this opaque identity after session start. */
export function privatePlanStatePath(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	if (planStorageMode(env) !== "capsule") return null;
	const identity = (globalThis as Record<string, unknown>).__pi_run_capsule_identity;
	if (!identity || typeof identity !== "object") return null;
	const value = identity as { cwd?: unknown; capsuleId?: unknown };
	if (value.cwd !== cwd || typeof value.capsuleId !== "string") return null;
	try { return join(runCapsuleDirectory(agentDir(env), cwd, value.capsuleId), "plan-state.json"); }
	catch { return null; }
}

export function privatePlanProjectionPath(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const state = privatePlanStatePath(cwd, env);
	return state ? join(dirname(state), "plan.md") : null;
}

export function privatePlanTracePath(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	const state = privatePlanStatePath(cwd, env);
	return state ? join(dirname(state), "plan-trace.jsonl") : null;
}
