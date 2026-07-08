// Steer-text templates: the injected correction messages (loop-breaker tiers,
// verify-gate nags) as an overridable surface. For a small local model the
// WORDING of a steer plausibly matters as much as the threshold it fires at —
// this makes the texts part of the munchkin search space (env PI_MSG_<NAME>,
// emitted by prompt-lab/config.py's `messages` dimension) without changing a
// byte of the defaults when no override is set.
//
// Template grammar: `{var}` placeholders. Unknown/unfilled `{var}` is left
// verbatim (visible in the transcript → debuggable, never silently dropped).

export function fill(template: string, vars: Record<string, string | number>): string {
	return template.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

export function steerText(name: string, defaultTemplate: string, vars: Record<string, string | number>): string {
	const override = process.env[`PI_MSG_${name}`];
	return fill(override || defaultTemplate, vars);
}
