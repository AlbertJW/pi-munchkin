// Shared command policy for pi's local-agent harness.
//
// Keep this file pure: extensions import it to make the same decision about
// bash progress, verify gates, and high-risk commands. The policy is deliberately
// conservative; a false positive blocks with a clear recovery path, while a false
// negative can give a small model too much agency.

export type CommandRisk = "read_only" | "verify" | "mutating" | "destructive";

export type CommandPolicy = {
	risk: CommandRisk;
	mutates: boolean;
	destructive: boolean;
	verifyLike: boolean;
	readOnly: boolean;
	reason: string;
};

const SAFE_REDIRECT_RE = /\d*>>?\s*(?:\/dev\/null|&\s*\d)/g;

export const VERIFY_COMMAND_RE =
	/\b(?:just\s+(?:verify|check|test)|npm\s+(?:test|run\s+(?:test|check|lint|typecheck|verify))|yarn\s+(?:test|check|lint)|pnpm\s+(?:test|run\s+(?:test|check|lint|typecheck|verify))|pytest|python(?:3)?\s+-m\s+pytest|cargo\s+test|go\s+test|make\s+(?:test|check|verify)|tsc(?:\s+--noEmit)?|bash\s+-n|ruff(?:\s+check)?|eslint|node\s+--test|(?:npx\s+(?:-y\s+)?)?tsx\s+--test|(?:npx\s+(?:-y\s+)?)?(?:vitest|jest))\b/i;

const MUTATION_RE =
	/\b(?:tee|sed\s+-i|cp|mv|mkdir|touch|ln|dd|install|git\s+(?:add|commit|mv|rm|apply|restore|checkout|reset))\b/i;

// `python -c` / `node -e` are dual-use: a read-only one-liner (json.load, print)
// must NOT be treated as a mutation, or plan-mode and the verify-gate block the
// legitimate inspection a model needs while planning. Flag these as mutating
// only when the inline payload actually writes (file open-for-write, fs/os/shutil
// writes, subprocess, serializers that dump to disk, …).
const INLINE_INTERP_RE = /\b(?:python(?:3)?\s+(?:-[A-Za-z]\s+)*-c|node\s+(?:-e|--eval))\b/i;
const INTERP_WRITE_RE =
	/\.write(?:lines|_text|_bytes)?\s*\(|\bopen\s*\([^)]*,\s*['"][rbt]*[wax+]|\bos\.(?:remove|unlink|rename|replace|rmdir|removedirs|mkdir|makedirs|truncate|system)\b|\bshutil\.(?:move|copy|copy2|copytree|copyfile|rmtree)\b|\.(?:mkdir|unlink|rename|replace|rmdir|touch)\s*\(|\b(?:json|pickle)\.dump\s*\(|\.to_(?:csv|parquet|json|excel|pickle|feather)\s*\(|\bsubprocess\.|\bfs\.(?:write|append|unlink|rm|mkdir|rename|copy|truncate)|writeFileSync|appendFileSync|\bchild_process\b|\bexecSync\b/i;

function inlineInterpreterWrites(cmd: string): boolean {
	return INLINE_INTERP_RE.test(cmd) && INTERP_WRITE_RE.test(cmd);
}

const DESTRUCTIVE_RE =
	/\b(?:rm|rmdir|shred|mkfs|diskutil|dd|kill(?:all)?|pkill|shutdown|reboot|halt|launchctl|brew\s+(?:install|uninstall|upgrade|reinstall)|npm\s+(?:install|i|uninstall|remove)|pnpm\s+(?:install|add|remove)|yarn\s+(?:add|remove|install)|pip(?:3)?\s+install|python(?:3)?\s+-m\s+pip\s+install|cargo\s+install|git\s+(?:reset|checkout|restore|clean|rm)|docker\s+(?:compose\s+)?(?:down|rm|rmi|prune|kill|stop|restart)|kubectl\s+(?:delete|apply|replace|scale|rollout|cordon|drain)|terraform\s+(?:apply|destroy)|make\s+(?:deploy|release|migrate)|(?:deploy|release|migrate)\b)/i;

function stripHarmlessRedirects(cmd: string): string {
	return cmd.replace(SAFE_REDIRECT_RE, " ");
}

export function isBashMutation(cmd: string): boolean {
	const c = stripHarmlessRedirects(cmd);
	if (/>>?\s*[^&\s]/.test(c)) return true;
	return MUTATION_RE.test(c) || inlineInterpreterWrites(c) || DESTRUCTIVE_RE.test(c);
}

export function isDestructiveCommand(cmd: string): boolean {
	return DESTRUCTIVE_RE.test(cmd);
}

// Ops/infra commands that change dependency / container / VCS / env state but NOT
// source code: package installs, docker/k8s, git, venv/service setup.
const OPS_COMMAND_RE =
	/\b(?:docker|podman|nerdctl|kubectl|helm|minikube|colima|npm|pnpm|yarn|bun|pip3?|uv|pdm|poetry|conda|mamba|cargo|rustup|brew|apt(?:-get)?|dnf|yum|apk|pacman|gem|bundle|corepack|virtualenv|systemctl|launchctl|service|git)\b|\bpython3?\s+-m\s+(?:pip|venv)\b|\bdocker[- ]compose\b/i;

// Commands that write file CONTENT (so they touch source even inside a compound
// that also looks like ops, e.g. `git commit && sed -i ... src.py`).
const SOURCE_WRITE_RE = /\bsed\s+-i\b|>>?\s*[^&\s]|\btee\b/;

// Does this bash command mutate SOURCE (so the verify gate should arm), vs. pure
// ops/infra (installs, containers, git, venv) that should NOT re-arm it? Used by
// verify-gate so bringing up a stack / installing deps / committing doesn't keep
// re-triggering "verify before handoff" — only real source edits do.
export function isSourceMutation(cmd: string): boolean {
	if (!isBashMutation(cmd)) return false;
	const c = stripHarmlessRedirects(cmd);
	return SOURCE_WRITE_RE.test(c) || !OPS_COMMAND_RE.test(c);
}

export function isVerifyCommand(cmd: string, extraAllowed: readonly string[] = []): boolean {
	const normalized = cmd.trim();
	if (!normalized) return false;
	if (extraAllowed.some((allowed) => allowed.trim() === normalized)) return true;
	return VERIFY_COMMAND_RE.test(normalized);
}

export function classifyBashCommand(cmd: string, extraVerifyCommands: readonly string[] = []): CommandPolicy {
	const trimmed = cmd.trim();
	if (!trimmed) {
		return {
			risk: "read_only",
			mutates: false,
			destructive: false,
			verifyLike: false,
			readOnly: true,
			reason: "empty command",
		};
	}
	const destructive = isDestructiveCommand(trimmed);
	const mutates = isBashMutation(trimmed);
	const verifyLike = isVerifyCommand(trimmed, extraVerifyCommands);
	if (destructive) {
		return { risk: "destructive", mutates: true, destructive: true, verifyLike, readOnly: false, reason: "destructive/high-risk command" };
	}
	if (mutates) {
		return { risk: "mutating", mutates: true, destructive: false, verifyLike, readOnly: false, reason: "mutates files or system state" };
	}
	if (verifyLike) {
		return { risk: "verify", mutates: false, destructive: false, verifyLike: true, readOnly: true, reason: "recognized verify command" };
	}
	return { risk: "read_only", mutates: false, destructive: false, verifyLike: false, readOnly: true, reason: "read-only/unknown-safe command" };
}

// Text heuristic for test/build tools that print failures but return exit 0.
export function looksFailingOutput(text: string, isError: boolean): boolean {
	if (isError) return true;
	const t = text.slice(0, 4000);
	if (/\bfail(?:ed|s|ures?|ing)?\b\D{0,3}0\b/i.test(t) || /\b0\s+fail(?:ed|s|ures?)?\b/i.test(t)) return false;
	return /\bFAIL(?:ED|URE)?\b/.test(t) || /\b[1-9]\d*\s+fail(?:ed|s|ures?)?\b/i.test(t) || /\bfail(?:ed|ures?)?\b\D{0,3}[1-9]/i.test(t);
}

export function assertVerifyGateAllowed(cmd: string, extraVerifyCommands: readonly string[] = []): { ok: true } | { ok: false; reason: string } {
	const policy = classifyBashCommand(cmd, extraVerifyCommands);
	if (policy.destructive) return { ok: false, reason: "gate rejected: destructive/high-risk commands require user approval and cannot be plan gates" };
	if (policy.mutates) return { ok: false, reason: "gate rejected: plan gates must be read-only verification commands" };
	if (!policy.verifyLike) return { ok: false, reason: "gate rejected: command is not a recognized verify/test/check command" };
	return { ok: true };
}

// Git commands that DISCARD uncommitted working-tree changes (the real footgun:
// an agent "cleaning up" with `git reset --hard` and wiping your work). Narrow
// on purpose — must NOT match safe forms: `git reset --soft/--mixed`,
// `git checkout <branch>`, `git restore --staged` (only unstages), `git clean`
// without -f (a no-op), or any non-git command. git-guard.ts uses this to
// confirm-before-discard only when the tree is actually dirty.
const DISCARD_GIT_RES: readonly RegExp[] = [
	/\bgit\s+reset\s+(?:[^\n]*\s)?--hard\b/i,
	/\bgit\s+checkout\s+(?:-f\b|--force\b|--(?:\s|$)|\.(?:\s|$))/i, // checkout -- / checkout . / -f  (NOT `checkout <branch>`)
	/\bgit\s+clean\b[^\n]*\s-[a-eg-z]*f|\bgit\s+clean\b[^\n]*--force\b/i, // clean with -f/--force
];

export function discardsUncommittedWork(cmd: string): boolean {
	const c = cmd.trim();
	// `git restore <path>` discards working-tree changes; `git restore --staged` only unstages (safe).
	if (/\bgit\s+restore\b/i.test(c) && !/\bgit\s+restore\s+--staged\b(?![^\n]*--worktree\b)/i.test(c)) return true;
	return DISCARD_GIT_RES.some((re) => re.test(c));
}
