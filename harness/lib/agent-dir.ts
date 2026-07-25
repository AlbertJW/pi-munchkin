import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve Pi's user agent directory without changing the unset default. */
export function agentDir(env: NodeJS.ProcessEnv = process.env): string {
	return env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
}
