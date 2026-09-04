import { join } from "node:path";
import { agentDir } from "./agent-dir.ts";
import { sha256, type FailureClass, type FailureEpisode } from "./failure-episodes.ts";
import { atomicWriteFile } from "./private-artifact.ts";

export type LoopTier = 0 | 1 | 2 | 3;

export type LoopRecoveryReceipt = {
	v: 2;
	created_at: string;
	episode_hash: string;
	plan_item_hash: string;
	failure_class: FailureClass;
	tool_family: string;
	call_variant_hashes: string[];
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
	episode: Pick<FailureEpisode, "key" | "planItemHash" | "failureClass" | "toolFamily" | "callVariantHashes">,
	gate: { mutated?: unknown; verifiedOk?: unknown } | undefined,
	surfaceHash: string | undefined,
	now = new Date().toISOString(),
): LoopRecoveryReceipt {
	return {
		v: 2,
		created_at: now,
		episode_hash: sha256(`episode:${episode.key}`),
		plan_item_hash: episode.planItemHash,
		failure_class: episode.failureClass,
		tool_family: episode.toolFamily.slice(0, 48),
		call_variant_hashes: episode.callVariantHashes.slice(0, 16),
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
	await atomicWriteFile(path, `${JSON.stringify(receipt)}\n`, { mode: 0o600, directoryMode: 0o700 });
	return path;
}
