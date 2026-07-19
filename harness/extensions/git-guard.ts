import { homedir } from "node:os";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { discardGitTargets } from "../lib/command-policy.ts";
import { record } from "../lib/telemetry.ts";

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

		// Only intervene if there's actually uncommitted work to lose — checked in
		// the repo the command actually targets (`cd X && …` / `git -C X …`), not
		// blindly in ctx.cwd.
		const analysis = discardGitTargets(command, ctx.cwd, homedir());
		if (!analysis.ok) {
			record("git-guard", "blocked-unresolved-target", { reason: analysis.reason });
			return { block: true, reason: `failure_class=safety_guard. Refusing destructive git command: ${analysis.reason}.` };
		}
		if (!analysis.targets.length) return;
		let dirty = "";
		for (const target of analysis.targets) {
			try {
				const r = await pi.exec("git", [...target.gitGlobals, "status", "--porcelain"], { cwd: target.cwd, timeout: 5000 });
				if (r.code !== 0) {
					return { block: true, reason: `failure_class=safety_guard. Could not verify destructive git target (status exit ${r.code}); refusing fail-closed.` };
				}
				dirty += (r.stdout || "").trim() + "\n";
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return { block: true, reason: `failure_class=safety_guard. Could not inspect destructive git target (${message}); refusing fail-closed.` };
			}
		}
		dirty = dirty.trim();
		if (!dirty) return; // every resolved target is clean

		const n = dirty.split("\n").filter(Boolean).length;
		const approved = await ctx.ui.confirm(
			"Discard uncommitted changes?",
			`\`${command}\` will discard ${n} uncommitted change(s). Commit or stash first?`,
		);
		record("git-guard", "confirm", { approved, changes: n });
		if (approved) return; // user said go ahead
		return {
			block: true,
			reason:
				`failure_class=user_action_required. \`${command}\` discards ${n} uncommitted change(s). ` +
				"Commit or `git stash` first, then retry. (GIT_GUARD=off disables this guard.)",
		};
	});
}
