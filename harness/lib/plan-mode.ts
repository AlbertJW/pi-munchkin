export type PlanMode = "forced" | "adaptive" | "off";

export function planMode(env: NodeJS.ProcessEnv = process.env): PlanMode {
	return env.PLAN_MODE === "adaptive" || env.PLAN_MODE === "off" ? env.PLAN_MODE : "forced";
}
const RISKY = /\b(?:rm|rmdir|reset|rebase|push|deploy|publish|delete|destroy|credential|secret|token|password|drop|truncate)\b/i;

/** Direct mode is explicit, bounded, and fail-closed; it is never inferred from a prompt. */
export function boundedDirectRequest(args: string): string | null {
	const request = args.trim().replace(/\s+/g, " ");
	if (!request || request.length > 240 || RISKY.test(request) || /[\r\n]/.test(args)) return null;
	return request;
}
