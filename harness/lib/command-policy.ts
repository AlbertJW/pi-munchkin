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

// Command-position prefix: a token only counts when it starts a command — the
// string start or after ; & | ( sudo/xargs/env/do/then. Without this, bare-word
// matching misfires both ways: `echo pytest passed` counts as a verify (gate
// silently passed) and `grep cp file` counts as a mutation ("progress" that
// disarms the loop-breaker).
const CMD_POS = String.raw`(?:^|[;&|(]\s*|\b(?:sudo|xargs|env|do|then|timeout\s+\S+)\s+|-exec\s+)(?:\w+=\S+\s+)*`;

export const VERIFY_COMMAND_RE = new RegExp(
	CMD_POS +
		String.raw`(?:test\b|\[\s|just\s+(?:verify|check|test)|npm\s+(?:test|run\s+(?:test|check|lint|typecheck|verify))|yarn\s+(?:test|check|lint)|pnpm\s+(?:test|run\s+(?:test|check|lint|typecheck|verify))|pytest|python(?:3)?\s+-m\s+pytest|cargo\s+test|go\s+test|make\s+(?:test|check|verify)|tsc\s+--noEmit|bash\s+-n|ruff(?:\s+check)?|eslint|node\s+--test|(?:npx\s+(?:-y\s+)?)?tsx\s+--test|(?:npx\s+(?:-y\s+)?)?(?:vitest|jest))\b`,
	"i",
);

const MUTATION_RE = new RegExp(
	CMD_POS +
		String.raw`(?:tee|sed\s+(?:-[a-zA-Z]+\s+)*(?:-i|--in-place)|perl\s+-[a-zA-Z]*i\b|cp|mv|mkdir|touch|ln|dd|install|truncate|chmod|chown|git\s+(?:add|commit|mv|rm|apply|restore|checkout|reset)|(?:eslint|ruff)\b[^;&|\n]*\s--fix\b|find\b[^;&|\n]*\s-(?:exec|execdir|ok|okdir))\b`,
	"i",
);

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

const DESTRUCTIVE_RE = new RegExp(
	CMD_POS +
		String.raw`(?:rm|rmdir|shred|mkfs|diskutil|dd|kill(?:all)?|pkill|shutdown|reboot|halt|launchctl|find\b[^;&|\n]*\s-delete\b|brew\s+(?:install|uninstall|upgrade|reinstall)|npm\s+(?:install|i|uninstall|remove)|pnpm\s+(?:install|add|remove)|yarn\s+(?:add|remove|install)|pip(?:3)?\s+install|python(?:3)?\s+-m\s+pip\s+install|cargo\s+install|git\s+(?:reset|checkout|restore|clean|rm|push\s+[^;&|\n]*(?:--force(?:-with-lease)?|-f)\b)|docker\s+(?:compose\s+)?(?:down|rm|rmi|prune|kill|stop|restart)|kubectl\s+(?:delete|apply|replace|scale|rollout|cordon|drain)|terraform\s+(?:apply|destroy)|make\s+(?:deploy|release|migrate)|(?:deploy|release|migrate))\b`,
	"i",
);

function stripHarmlessRedirects(cmd: string): string {
	return cmd.replace(SAFE_REDIRECT_RE, " ");
}

// Shell is an execution language, not a list of trusted binaries. Anything we
// do not positively recognize as inspection/verification is a mutation risk.
// This closes the old fail-open class (`sh script`, `curl -o`, `ruby -e`, a
// project-local executable, aliases/functions, ...). It intentionally favors a
// clear false-positive over silently letting an unknown executable bypass plan
// mode and the verify gate.
const READ_ONLY_HEADS = new Set([
	"[", "basename", "cat", "cd", "cmp", "cut", "diff", "dirname", "du", "echo",
	"false", "file", "find", "git", "grep", "head", "jq", "ls", "man", "printf",
	"pwd", "readlink", "realpath", "rg", "sort", "stat", "tail", "test", "tr",
	"true", "uniq", "wc", "which",
]);
const SHELL_CONTROL_HEADS = new Set(["do", "done", "elif", "else", "fi", "if", "then", "while", "until"]);

function shellCommandHeads(cmd: string): string[] {
	// Strip quoted strings so separators/words inside `echo "rm -rf"` do not
	// become fake commands. Unterminated/dynamic shell is deliberately unknown.
	let plain = "";
	let quote = "";
	let escaped = false;
	for (const ch of cmd) {
		if (escaped) { plain += quote ? " " : ch; escaped = false; continue; }
		if (ch === "\\") { escaped = true; plain += " "; continue; }
		if (quote) { if (ch === quote) quote = ""; plain += " "; continue; }
		if (ch === "'" || ch === '"') { quote = ch; plain += " "; continue; }
		plain += ch;
	}
	if (quote || escaped || /`|\$\(/.test(cmd)) return ["<dynamic-shell>"];
	const heads: string[] = [];
	for (const raw of plain.split(/(?:&&|\|\||[;|\n])/)) {
		let words = raw.trim().replace(/^\(+/, "").split(/\s+/).filter(Boolean);
		while (words.length && (/^[A-Za-z_]\w*=/.test(words[0]) || SHELL_CONTROL_HEADS.has(words[0]))) words.shift();
		while (words.length && ["command", "env", "exec", "nohup", "sudo", "time", "timeout", "xargs"].includes(words[0])) {
			const prefix = words.shift();
			if (prefix === "timeout" && words.length) words.shift();
			while (words.length && (words[0].startsWith("-") || /^[A-Za-z_]\w*=/.test(words[0]))) words.shift();
		}
		if (words[0]) heads.push(words[0].replace(/^.*\//, ""));
	}
	return heads;
}

function containsUnknownCommand(cmd: string): boolean {
	return shellCommandHeads(cmd).some((head) => {
		if (READ_ONLY_HEADS.has(head)) return false;
		if (["cargo", "eslint", "go", "jest", "just", "make", "npm", "npx", "pnpm", "pytest", "ruff", "tsc", "tsx", "vitest", "yarn"].includes(head) && VERIFY_COMMAND_RE.test(cmd)) return false;
		if (head === "bash" && /\bbash\s+-n\b/.test(cmd)) return false;
		if (/^python(?:3(?:\.\d+)?)?$/.test(head)) {
			return !(/\s-m\s+pytest\b/.test(cmd) || (/\s-c\b/.test(cmd) && !INTERP_WRITE_RE.test(cmd)));
		}
		if (head === "node") return !(/\s--test\b/.test(cmd) || (/\s(?:-e|--eval)\b/.test(cmd) && !INTERP_WRITE_RE.test(cmd)));
		return true;
	});
}

function isExplicitBashMutation(cmd: string): boolean {
	const c = stripHarmlessRedirects(cmd);
	if (/>>?\s*[^&\s]/.test(c)) return true;
	return MUTATION_RE.test(c) || inlineInterpreterWrites(c) || DESTRUCTIVE_RE.test(c);
}

export function isBashMutation(cmd: string): boolean {
	const c = stripHarmlessRedirects(cmd);
	return isExplicitBashMutation(c) || containsUnknownCommand(c);
}

export function isDestructiveCommand(cmd: string): boolean {
	return DESTRUCTIVE_RE.test(cmd);
}

// Ops/infra commands that change dependency / container / VCS / env state but NOT
// source code: package installs, docker/k8s, git, venv/service setup.
const OPS_COMMAND_RE =
	/\b(?:docker|podman|nerdctl|kubectl|helm|minikube|colima|npm|pnpm|yarn|bun|pip3?|uv|pdm|poetry|conda|mamba|cargo|rustup|brew|apt(?:-get)?|dnf|yum|apk|pacman|gem|bundle|corepack|virtualenv|systemctl|launchctl|service|git)\b|\bpython(?:3(?:\.\d+)?)?\s+-m\s+(?:pip|venv)\b|\bdocker[- ]compose\b/i;

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
	const verifyLike = isVerifyCommand(trimmed, extraVerifyCommands);
	const explicitlyAllowed = extraVerifyCommands.some((allowed) => allowed.trim() === trimmed);
	const mutates = explicitlyAllowed ? isExplicitBashMutation(trimmed) : isBashMutation(trimmed);
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
// `git checkout <branch>`, `git checkout -b`, `git restore --staged` (only
// unstages), `git clean` without -f (a no-op), or any non-git command.
// git-guard.ts uses this to confirm-before-discard only when the tree is dirty.
const DISCARD_GIT_RES: readonly RegExp[] = [
	/\bgit\s+reset\s+(?:[^\n]*\s)?--hard\b/i,
	/\bgit\s+checkout\s+(?:[^\n]*\s)?(?:-f\b|--force\b)/i, // checkout ... -f/--force anywhere (incl. `checkout <branch> --force`)
	/\bgit\s+checkout\s+(?:\S+\s+)?--(?:\s|$)/i, // checkout -- <paths> AND checkout <ref> -- <paths> (overwrites worktree)
	/\bgit\s+checkout\s+\.(?:\s|$)/i, // checkout .
	/\bgit\s+switch\s+(?:[^\n]*\s)?(?:-f\b|--force\b|--discard-changes\b)/i, // switch -f / --discard-changes
	/\bgit\s+clean\b[^\n]*\s-[a-eg-z]*f|\bgit\s+clean\b[^\n]*--force\b/i, // clean with -f/--force
];

// Strip git's global options between `git` and the subcommand (`git -C <dir>
// reset --hard`, `git -c k=v checkout -- .`, --git-dir/--work-tree) so the
// discard patterns above see a normalized `git <subcommand> …`.
function normalizeGitGlobals(cmd: string): string {
	const value = String.raw`(?:"[^"]*"|'[^']*'|\S+)`;
	return cmd.replace(new RegExp(String.raw`\bgit\s+(?:(?:-C\s+${value}|-c\s+${value}|--git-dir(?:=|\s+)${value}|--work-tree(?:=|\s+)${value})\s+)+`, "gi"), "git ");
}

export function discardsUncommittedWork(cmd: string): boolean {
	const c = normalizeGitGlobals(cmd.trim());
	// `git restore <path>` discards working-tree changes; `git restore --staged` only unstages (safe).
	if (/\bgit\s+restore\b/i.test(c) && !/\bgit\s+restore\s+--staged\b(?![^\n]*--worktree\b)/i.test(c)) return true;
	return DISCARD_GIT_RES.some((re) => re.test(c));
}

export type DiscardGitTarget = { cwd: string; gitGlobals: string[] };
export type DiscardTargetAnalysis =
	| { ok: true; targets: DiscardGitTarget[] }
	| { ok: false; reason: string };

function shellSegments(cmd: string): string[][] | null {
	const segments: string[][] = [[]];
	let word = "", quote = "", escaped = false;
	const pushWord = () => { if (word) { segments[segments.length - 1].push(word); word = ""; } };
	const pushSegment = () => { pushWord(); if (segments.at(-1)!.length) segments.push([]); };
	for (let i = 0; i < cmd.length; i++) {
		const ch = cmd[i];
		if (escaped) { word += ch; escaped = false; continue; }
		if (ch === "\\") { escaped = true; continue; }
		if (quote) { if (ch === quote) quote = ""; else word += ch; continue; }
		if (ch === "'" || ch === '"') { quote = ch; continue; }
		if (ch === "`" || (ch === "$" && cmd[i + 1] === "(")) return null;
		if (/\s/.test(ch)) { pushWord(); continue; }
		if (ch === ";" || ch === "|" || ch === "&" || ch === "\n") { pushSegment(); continue; }
		word += ch;
	}
	if (quote || escaped) return null;
	pushWord();
	return segments.filter((s) => s.length);
}

function resolveShellDir(base: string, raw: string, home: string): string | null {
	if (!raw || raw.includes("$") || raw.includes("*")) return null;
	let dir = raw;
	if (dir === "~") dir = home;
	else if (dir.startsWith("~/")) dir = home + dir.slice(1);
	if (dir.startsWith("/")) return dir;
	const parts = `${base.replace(/\/$/, "")}/${dir}`.split("/");
	const out: string[] = [];
	for (const part of parts) {
		if (!part || part === ".") continue;
		if (part === "..") out.pop(); else out.push(part);
	}
	return "/" + out.join("/");
}

/** Resolve every destructive git invocation, preserving git globals so the
 * guard executes `git <same target globals> status`. Ambiguous shell expansion
 * is rejected; a destructive guard must never guess the repository and pass.
 * A command with no `git` token anywhere has nothing for this guard to
 * protect against — checked BEFORE tokenization so a command substitution or
 * for-loop the tokenizer can't parse (shellSegments returns null on `` ` ``
 * or `$(`) doesn't fail closed on commands that were never git in the first
 * place (observed 2026-07-21: a plain `for … do status=$(cat … ); …` loop
 * with zero git anywhere was refused as a "destructive git command"). */
export function discardGitTargets(cmd: string, cwd: string, home: string): DiscardTargetAnalysis {
	if (!/\bgit\b/.test(cmd)) return { ok: true, targets: [] };
	const segments = shellSegments(cmd);
	if (!segments) return { ok: false, reason: "dynamic or malformed shell syntax prevents resolving the git target" };
	let activeCwd = cwd;
	const targets: DiscardGitTarget[] = [];
	for (const words of segments) {
		let start = 0;
		while (start < words.length && /^[A-Za-z_]\w*=/.test(words[start])) start++;
		if (words[start] === "cd") {
			const next = resolveShellDir(activeCwd, words[start + 1] ?? home, home);
			if (!next) return { ok: false, reason: "could not resolve cd target before destructive git command" };
			activeCwd = next;
			continue;
		}
		const gitIndex = words.indexOf("git", start);
		if (gitIndex < 0) continue;
		const globals: string[] = [];
		let i = gitIndex + 1;
		while (i < words.length) {
			const token = words[i];
			if (token === "-C" || token === "-c" || token === "--git-dir" || token === "--work-tree") {
				const value = words[i + 1];
				if (!value || value.includes("$") || value.includes("*")) return { ok: false, reason: `unresolved git ${token} target` };
				globals.push(token, value); i += 2; continue;
			}
			if (/^-(?:C|c).+/.test(token) || /^--(?:git-dir|work-tree)=/.test(token)) {
				if (token.includes("$") || token.includes("*")) return { ok: false, reason: "unresolved inline git target" };
				globals.push(token); i++; continue;
			}
			break;
		}
		if (!discardsUncommittedWork(`git ${words.slice(i).join(" ")}`)) continue;
		targets.push({ cwd: activeCwd, gitGlobals: globals });
	}
	if (!targets.length && discardsUncommittedWork(cmd)) {
		return { ok: false, reason: "destructive git command could not be isolated for target inspection" };
	}
	return { ok: true, targets };
}

// Compatibility helper for policy consumers that only need the first cwd.
export function discardWorkdir(cmd: string, cwd: string, home: string): string {
	const analysis = discardGitTargets(cmd, cwd, home);
	if (!analysis.ok || !analysis.targets[0]) return cwd;
	const dashC = analysis.targets[0].gitGlobals.findIndex((v) => v === "-C");
	if (dashC >= 0) return resolveShellDir(analysis.targets[0].cwd, analysis.targets[0].gitGlobals[dashC + 1], home) ?? cwd;
	const inlineC = analysis.targets[0].gitGlobals.find((v) => /^-C.+/.test(v));
	return inlineC ? resolveShellDir(analysis.targets[0].cwd, inlineC.slice(2), home) ?? cwd : analysis.targets[0].cwd;
}
