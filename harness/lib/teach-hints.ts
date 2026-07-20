// Teaching error hints (Bojie Li's "error strings that teach"): a small model
// that hits a terse error tends to blind-retry; a one-line hint naming the
// likely cause and the next move converts the failure into a correction.
// Deterministic rules over tool_result errors, additive append only — the
// did-you-mean pattern. Rule choice: surfaces NOT already self-teaching
// (hashline's stale-tag errors already say "read the file again"; did-you-mean
// covers mistyped file paths). Re-rank once teach-hints/hint telemetry
// accumulates across gate rounds.

export type HintRule = {
	id: string;
	tools: ReadonlySet<string> | null; // null = any tool
	matches(text: string): boolean;
	hint(text: string, input: Record<string, unknown> | undefined): string;
};

// Which of a fixed probe set exist on PATH — computed once per process by the
// extension and injected here so the rule stays pure.
export type ToolProbe = (name: string) => boolean;

export function buildRules(probeAvailable: ToolProbe): HintRule[] {
	return [
		{
			id: "missing-cmd",
			tools: new Set(["bash"]),
			matches: (text) => /command not found|not recognized as an internal|No such file or directory: '?\w+'?: command/.test(text)
				|| /: command not found/.test(text),
			hint: (text) => {
				const missing = /([\w./-]+): command not found/.exec(text)?.[1];
				const present = ["node", "python3", "npm", "rg", "git"].filter((name) => probeAvailable(name));
				return `Hint: ${missing ? `'${missing}' is not on PATH.` : "that command is not on PATH."} Available here: ${present.join(", ") || "(none of node/python3/npm/rg/git)"}. Check pwd and use an available tool instead of retrying the same command.`;
			},
		},
		{
			id: "module-not-found",
			tools: null, // surfaces in bash test runs AND direct node invocations
			matches: (text) => /ERR_MODULE_NOT_FOUND|Cannot find module/.test(text),
			hint: (text) => {
				const spec = /Cannot find (?:module|package) '([^']+)'/.exec(text)?.[1];
				return `Hint: ${spec ? `the import specifier '${spec}'` : "an import specifier"} did not resolve. Check the RELATIVE path and file extension in the import statement against the actual on-disk layout (ls the directory) — do not re-run the same command unchanged.`;
			},
		},
		{
			id: "bad-patch",
			tools: new Set(["edit", "hashline_edit"]),
			matches: (text) => /bad patch/.test(text),
			hint: () =>
				"Hint: patch format is: a [path#TAG] header line, then one or more hunks (`@@ start..end` with `+` body rows to replace, `delete start..end`, or `insert N:`). Re-read the target span to get fresh line numbers and tags, then re-emit the WHOLE patch in that shape.",
		},
	];
}

// First matching enabled rule wins (one hint per result, never stacked).
export function hintFor(
	rules: readonly HintRule[],
	toolName: string,
	isError: boolean,
	text: string,
	input: Record<string, unknown> | undefined,
	ruleEnabled: (id: string) => boolean,
): { rule: string; hint: string } | null {
	if (!isError || !text) return null;
	for (const rule of rules) {
		if (!ruleEnabled(rule.id)) continue;
		if (rule.tools && !rule.tools.has(toolName)) continue;
		if (!rule.matches(text)) continue;
		return { rule: rule.id, hint: rule.hint(text, input) };
	}
	return null;
}
