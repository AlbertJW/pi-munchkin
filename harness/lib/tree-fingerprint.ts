import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";

export type FingerprintExec = (command: string, args: string[], options: { cwd: string; timeout?: number }) =>
	Promise<{ stdout: string; stderr?: string; code: number | null; killed?: boolean }>;

const MAX_UNTRACKED = 2_000;

/**
 * A fingerprint of everything git can see in the working tree: HEAD, the full
 * diff against HEAD (staged and unstaged, binary-safe), and the name, size and
 * mtime of every untracked file. Equal fingerprints mean no tracked or
 * untracked file changed. Files git ignores are not covered, so callers must
 * combine this with their own change tracking. Returns null when the
 * directory is not a git work tree or anything is uncertain.
 */
export async function workingTreeFingerprint(exec: FingerprintExec, cwd: string): Promise<string | null> {
	const git = (args: string[]) => exec("git", args, { cwd, timeout: 10_000 });
	try {
		const inside = await git(["rev-parse", "--is-inside-work-tree"]);
		if (inside.code !== 0 || inside.stdout.trim() !== "true") return null;
		const head = await git(["rev-parse", "HEAD"]);
		if (head.code !== 0) return null;
		const diff = await git(["diff", "--no-ext-diff", "--binary", "HEAD"]);
		const status = await git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
		if (diff.code !== 0 || status.code !== 0 || diff.killed || status.killed) return null;
		const untracked = status.stdout.split("\0").filter((entry) => entry.startsWith("?? ")).map((entry) => entry.slice(3));
		if (untracked.length > MAX_UNTRACKED) return null;
		const hash = createHash("sha256").update(head.stdout).update("\0").update(diff.stdout).update("\0").update(status.stdout);
		const top = (await git(["rev-parse", "--show-toplevel"])).stdout.trim() || cwd;
		for (const path of untracked.sort()) {
			const info = await stat(join(top, path));
			hash.update(`\0${path}\0${info.size}\0${info.mtimeMs}`);
		}
		return hash.digest("hex");
	} catch {
		return null;
	}
}
