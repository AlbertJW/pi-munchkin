import { join } from "node:path";
import { agentDir } from "./agent-dir.ts";
import { runCapsuleDirectory } from "./run-capsule-store.ts";

export type PlanStorageMode = "legacy" | "capsule";

export function planStorageMode(env: NodeJS.ProcessEnv = process.env): PlanStorageMode {
	return env.PLAN_MODE === "adaptive" ? "capsule" : "legacy";
}

/** The run-capsule extension publishes this opaque identity after session start. */
export function privatePlanStatePath(cwd: string, env: NodeJS.ProcessEnv = process.env): string | null {
	if (planStorageMode(env) !== "capsule") return null;
	if (env.RUN_CAPSULE === "off") return null;
	const identity = (globalThis as Record<string, unknown>).__pi_run_capsule_identity;
	if (!identity || typeof identity !== "object") return null;
	const value = identity as { cwd?: unknown; capsuleId?: unknown };
	if (value.cwd !== cwd || typeof value.capsuleId !== "string") return null;
	try { return join(runCapsuleDirectory(agentDir(env), cwd, value.capsuleId), "plan-state.json"); }
	catch { return null; }
}
