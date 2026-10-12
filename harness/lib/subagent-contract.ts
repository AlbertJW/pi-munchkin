// Return-contract check for delegated reports (MASS: a contract is "the information and
// artifacts it must return, including any required checks"). The role file is the single
// source of truth: the field names listed under its "Return ONLY:" block. Deterministic,
// no model call; a broken contract is reported to the parent, never silently trusted.

/** Field names from the first "Return ONLY:" block, e.g. ["RESULT", "CHANGED", "VERIFY"]. */
export function contractFields(systemPrompt: string): string[] {
	const lines = systemPrompt.split("\n");
	const start = lines.findIndex((line) => /^Return ONLY:\s*$/.test(line.trim()));
	if (start < 0) return [];
	const fields: string[] = [];
	for (const line of lines.slice(start + 1)) {
		if (!line.trim()) break;
		const match = /^([A-Z][A-Z_]{1,31}):/.exec(line.trim());
		if (match && !fields.includes(match[1])) fields.push(match[1]);
	}
	return fields;
}

/** Fields the report does not contain at the start of a line. */
export function missingContractFields(fields: readonly string[], report: string): string[] {
	return fields.filter((field) => !new RegExp(`^\\s*${field}:`, "m").test(report));
}

export function contractNote(agent: string, missing: readonly string[]): string {
	return missing.length === 0 ? "" :
		`\n[contract] The ${agent} report is missing ${missing.join(", ")}. Treat its claims as unverified until you check them yourself.`;
}
