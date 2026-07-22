// Bash tool results are unbounded — unlike `read` (which context-inlet-guard
// checks via stat() BEFORE the file even opens), there is no way to predict a
// bash command's output size before it runs. This module only decides what to
// do with the result AFTER execution: withhold an oversized result entirely
// (matching context-inlet-guard's block-not-truncate philosophy — a partial
// view of `find`/`grep` output risks the model drawing wrong conclusions from
// an arbitrary cutoff) and, heuristically, name the likely cause.

export function totalContentChars(content: Array<{ type?: string; text?: string }> | undefined): number {
	return (content ?? []).reduce((sum, c) => sum + (c?.type === "text" ? (c.text ?? "").length : 0), 0);
}

// Heuristic only — feeds the steer WORDING, never the size decision itself.
// A command referencing $HOME, a bare `~`, or an absolute path outside cwd is
// very likely the CWD_ANCHOR violation (governor: "Never cd to $HOME or into
// other projects") rather than a legitimately large in-scope result. False
// positives/negatives just make the message slightly less specific.
const HOME_REF_RE = /\$HOME\b|(?:^|[\s;&|(])~(?:\/|$)/;
const ABS_PATH_RE = /(?:^|[\s;&|(=])(\/[^\s;&|]+)/g;

export function looksLikeCwdEscape(command: string, cwd: string): boolean {
	if (HOME_REF_RE.test(command)) return true;
	for (const m of command.matchAll(ABS_PATH_RE)) {
		const path = m[1];
		if (!path.startsWith(cwd)) return true;
	}
	return false;
}

export function outputGuardMessage(chars: number, maxChars: number, cwdEscapeSuspected: boolean): string {
	const base = `failure_class=context_intake_risk. This command produced ${chars} characters of output — too large to use directly (limit ${maxChars}). Re-run narrower: pipe through head/wc -l/grep for just what you need, or scope the command to a specific subdirectory.`;
	if (!cwdEscapeSuspected) return base;
	return `${base}\nThis looks like it searched outside your working directory. Do all work in the directory you started in — never search $HOME or other projects; if a file seems missing, run \`pwd\` and \`ls\` first.`;
}
