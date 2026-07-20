#!/usr/bin/env -S node --experimental-strip-types
// CLI: hash a live agent-dir's first-party extension/lib surface, plus the pinned
// lockfile identity of every active npm: package. Run BEFORE `pi` starts
// (real_gate.sh's launcher step) — the running session can't influence this number
// since it doesn't exist yet. Prints the hex digest to stdout; any failure (missing
// dir, unreadable file, malformed settings.json, or an active npm: package that
// can't be resolved against the lockfile) exits non-zero so the caller keeps its
// existing "hash unavailable" blocker text instead of printing a partial hash.

import { discoverEntryPoints, hashSurface, walkRelativeImports } from "../lib/surface-walk.ts";

async function main(): Promise<void> {
	const agentDir = process.argv[2];
	if (!agentDir) {
		console.error("usage: surface-hash.ts <agent-dir>");
		process.exitCode = 1;
		return;
	}
	const { entries, npmIdentities } = await discoverEntryPoints(agentDir);
	const files = await walkRelativeImports(entries);
	console.log(await hashSurface(agentDir, files, npmIdentities));
}

main().catch((err) => {
	console.error(`surface-hash: ${err instanceof Error ? err.message : String(err)}`);
	process.exitCode = 1;
});
