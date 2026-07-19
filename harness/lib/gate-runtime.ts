import { assertVerifyGateAllowed, looksFailingOutput } from "./command-policy.ts";

export type GateExec = (
	command: string,
	args: string[],
	options: { cwd: string; timeout: number; signal?: AbortSignal },
) => Promise<{ stdout: string; stderr: string; code: number; killed?: boolean }>;

export type GateResult = { pass: boolean; output: string; reason?: string };

/** Environment deliberately exposed to acceptance commands. Gates are arbitrary
 * executable code even when their command line looks read-only; do not leak API
 * keys, cloud credentials, SSH agents, npm tokens, or parent shell hooks. */
export function gateEnvironment(source: NodeJS.ProcessEnv = process.env): string[] {
	const keep = ["HOME", "LANG", "LC_ALL", "PATH", "SYSTEMROOT", "TEMP", "TMP", "TMPDIR", "WINDIR"];
	return keep.flatMap((key) => source[key] ? [`${key}=${source[key]}`] : []);
}

export async function runReadonlyGate(
	exec: GateExec,
	cwd: string,
	gate: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<GateResult> {
	const allowed = assertVerifyGateAllowed(gate);
	if (!allowed.ok) return { pass: false, output: allowed.reason, reason: "policy" };
	try {
		const args = ["-i", ...gateEnvironment(), "bash", "--noprofile", "--norc", "-c", "exec </dev/null; " + gate];
		const r = await exec("/usr/bin/env", args, { cwd, timeout: timeoutMs, signal });
		const output = `${r.stdout || ""}\n${r.stderr || ""}`.trim();
		if (r.killed) return { pass: false, output: output || `gate timed out after ${timeoutMs}ms`, reason: "timeout" };
		if (r.code !== 0) return { pass: false, output: output || `gate exited ${r.code}`, reason: "exit" };
		if (looksFailingOutput(output, false)) return { pass: false, output, reason: "failing-output" };
		return { pass: true, output };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { pass: false, output: `gate execution failed: ${message}`, reason: "execution" };
	}
}
