export const ACTIVE_TOOL_PROMPTS_DEFAULT: "ambient" | "derived" = "derived";

export function activeToolPromptsEnabled(
	env: NodeJS.ProcessEnv = process.env,
	defaultMode: "ambient" | "derived" = ACTIVE_TOOL_PROMPTS_DEFAULT,
): boolean {
	if (env.ACTIVE_TOOL_PROMPTS === "active") return true;
	if (env.ACTIVE_TOOL_PROMPTS === "ambient") return false;
	return defaultMode === "derived" && env.MUNCHKIN_TOOL_ACTIVATION !== "ambient";
}

export const ACTIVE_TOOL_PROMPTS = activeToolPromptsEnabled();

export const AMBIENT_TOOL_GUIDANCE = `Context-overflow error (400 exceeds context) → compact_context, then retry.

## Plan workflow

/plan <req> → model writes TODO list (plan_write), stops. Review, then /plan-go to execute.
/plan <req> yolo → plan + run straight through. Pick by risk: confident + low-risk → yolo; risky/uncertain/destructive → lean.
Model owns the list: plan_write to add/remove/reorder/restatus. One item in_progress at a time.
/plan-status shows list. /plan-trace [n] shows recent trace.

## Delegation

Push noisy work into subagents — they return only a distilled result:
- context-heavy lookup → subagent(explorer, …) — read-only.
- risky claim or non-trivial change → subagent(verifier, …).
- one bounded, fully-specified edit → subagent(executor, …, spawn) — task self-contained.`;

export function stripAmbientToolGuidance(prompt: string): string {
	return prompt.replace(`\n\n${AMBIENT_TOOL_GUIDANCE}`, "").replace(AMBIENT_TOOL_GUIDANCE, "");
}
