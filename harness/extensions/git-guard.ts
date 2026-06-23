import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discardsUncommittedWork } from "../lib/command-policy.ts";

// Dangerous-git guard: confirm before a bash command DISCARDS uncommitted work.
//
// The real footgun (seen in the wild): an agent "cleaning up" with
// `git reset --hard` / `git checkout -- .` / `git clean -fd` and wiping
// uncommitted changes that were never recoverable. This guards ONLY those
// working-tree-destroying git forms (see discardsUncommittedWork) — NOT
// installs/builds/branch-switches — and ONLY when the tree is actually dirty.
//
// On a dirty tree it asks ctx.ui.confirm: interactively the user decides;
// headless/ralph auto-denies → blocked, so unattended runs can't silently lose
// work. Clean tree, non-repo, or any git-status error → allowed (nothing to
// lose / fail-open). Disable with GIT_GUARD=off.

const ENABLED = process.env.GIT_GUARD !== "off";

export default function (pi: ExtensionAPI) {
	if (!ENABLED) return;

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "bash") return;
		const command = String((event.input as Record<string, unknown> | undefined)?.command ?? "");
		if (!discardsUncommittedWork(command)) return;

		// Only intervene if there's actually uncommitted work to lose.
		let dirty: string;
		try {
			const r = await pi.exec("git", ["status", "--porcelain"], { cwd: ctx.cwd, timeout: 5000 });
			dirty = (r.stdout || "").trim();
		} catch {
			return; // not a repo / git unavailable → nothing to guard, fail open
		}
		if (!dirty) return; // clean tree → the command can't discard anything

		const n = dirty.split("\n").filter(Boolean).length;
		const approved = await ctx.ui.confirm(
			"Discard uncommitted changes?",
			`\`${command}\` will discard ${n} uncommitted change(s). Commit or stash first?`,
		);
		if (approved) return; // user said go ahead
		return {
			block: true,
			reason:
				`failure_class=user_action_required. \`${command}\` discards ${n} uncommitted change(s). ` +
				"Commit or `git stash` first, then retry. (GIT_GUARD=off disables this guard.)",
		};
	});
}
