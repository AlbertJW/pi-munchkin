export const ACTIVE_TOOL_PROMPTS_DEFAULT: "ambient" | "derived" = "derived";

export function activeToolPromptsEnabled(
	env: NodeJS.ProcessEnv = process.env,
	defaultMode: "ambient" | "derived" = ACTIVE_TOOL_PROMPTS_DEFAULT,
): boolean {
	if (env.ACTIVE_TOOL_PROMPTS === "active") return true;
	if (env.ACTIVE_TOOL_PROMPTS === "ambient") return false;
	return defaultMode === "derived" && (
		env.MUNCHKIN_TOOL_SURFACE === "minimal" || env.MUNCHKIN_TOOL_ACTIVATION !== "ambient"
	);
}

export const ACTIVE_TOOL_PROMPTS = activeToolPromptsEnabled();

export const AMBIENT_TOOL_GUIDANCE = `Context-overflow error (400 exceeds context) → compact_context, then retry.

## Plan workflow

/plan <req> → enter the read-only planning surface, write at most 24 short items with plan_write, then stop. Review, then /plan-go to execute.
Use plan_update with small stable-ID deltas for status and notes. Never resend the whole plan for routine progress. One item in_progress at a time.
/plan-status shows list. /plan-trace [n] shows recent trace.

## Delegation

Push noisy work into subagents — they return only a distilled result:
- context-heavy lookup → subagent(explorer, …) — read-only.
- risky claim or non-trivial change → subagent(verifier, …).
- one bounded, fully-specified edit → subagent(executor, …, spawn) — task self-contained.`;

export function stripAmbientToolGuidance(prompt: string): string {
	return prompt.replace(`\n\n${AMBIENT_TOOL_GUIDANCE}`, "").replace(AMBIENT_TOOL_GUIDANCE, "");
}
