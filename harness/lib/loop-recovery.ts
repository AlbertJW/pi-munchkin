import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { agentDir } from "./agent-dir.ts";
import { sha256, type FailureClass, type FailureEpisode } from "./failure-episodes.ts";

export type LoopTier = 0 | 1 | 2 | 3;

export type LoopRecoveryReceipt = {
	v: 1;
	created_at: string;
	episode_hash: string;
	plan_item_hash: string;
	failure_class: FailureClass;
	tool_family: string;
	strategy_family_hashes: string[];
	last_source_mutated: boolean;
	exact_gate_passed: boolean;
	harness_surface_hash: string | null;
};

export function tierForCount(count: number, t1: number, t2: number, t3: number): LoopTier {
	if (count >= t3) return 3;
	if (count >= t2) return 2;
	if (count >= t1) return 1;
	return 0;
}

export function recoveryReceipt(
	episode: Pick<FailureEpisode, "key" | "planItemHash" | "failureClass" | "toolFamily" | "strategyHashes">,
	gate: { mutated?: unknown; verifiedOk?: unknown } | undefined,
	surfaceHash: string | undefined,
	now = new Date().toISOString(),
): LoopRecoveryReceipt {
	return {
		v: 1,
		created_at: now,
		episode_hash: sha256(`episode:${episode.key}`),
		plan_item_hash: episode.planItemHash,
		failure_class: episode.failureClass,
		tool_family: episode.toolFamily.slice(0, 48),
		strategy_family_hashes: episode.strategyHashes.slice(0, 16),
		last_source_mutated: gate?.mutated === true,
		exact_gate_passed: gate?.verifiedOk === true,
		harness_surface_hash: surfaceHash && /^[a-f0-9]{64}$/i.test(surfaceHash) ? surfaceHash.toLowerCase() : null,
	};
}

export function loopRecoveryPath(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(agentDir(env), "artifacts", "loop-recovery", `${sha256(cwd)}.json`);
}

export async function writeLoopRecoveryReceipt(
	cwd: string,
	receipt: LoopRecoveryReceipt,
	env: NodeJS.ProcessEnv = process.env,
): Promise<string> {
	const path = loopRecoveryPath(cwd, env);
	const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	await chmod(dirname(path), 0o700);
	try {
		await writeFile(tmp, `${JSON.stringify(receipt)}\n`, { encoding: "utf8", mode: 0o600 });
		await rename(tmp, path);
		await chmod(path, 0o600);
		return path;
	} catch (error) {
		await unlink(tmp).catch(() => {});
		throw error;
	}
}
