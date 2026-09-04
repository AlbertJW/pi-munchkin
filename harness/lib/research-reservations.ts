import { createHash } from "node:crypto";
import { chmod, mkdir, open, readdir } from "node:fs/promises";
import { join } from "node:path";
import { agentDir } from "./agent-dir.ts";

/**
 * Cross-process retrieval reservations for one deep-research graph run.
 *
 * The evidence ledger remains parent-owned. These tiny hash-only marker files
 * are a coordination index, not evidence: they let sibling processes avoid
 * spending the same bounded search or returning the same canonical URL. A
 * marker is intentionally monotonic for the lifetime of a run; after a crash,
 * skipping one already-reserved key is safer than issuing an unbounded retry.
 */

export const MAX_RESERVATION_MARKERS = 512;
const HASH = /^[a-f0-9]{64}$/;

function digest(value: string): string {
	return createHash("sha256").update(value, "utf8").digest("hex");
}

function safeRunId(runId: string): string {
	return /^[A-Za-z0-9._:-]{1,200}$/.test(runId) ? runId : digest(runId);
}

export function researchReservationRoot(cwd: string, runId: string, env: NodeJS.ProcessEnv = process.env): string {
	return join(agentDir(env), "artifacts", "research-reservations", digest(cwd), safeRunId(runId));
}

export function normalizeResearchQuery(query: string): string {
	return query.replace(/\s+/g, " ").trim().toLocaleLowerCase();
}

function markerPath(root: string, kind: "query" | "url", key: string): string {
	return join(root, kind, `${digest(key)}.reserved`);
}

/**
 * Atomically reserve one normalized query or canonical URL. Returns false for
 * an existing reservation, including a marker left by an interrupted writer.
 */
export async function reserveResearchKey(
	root: string,
	kind: "query" | "url",
	key: string,
): Promise<boolean> {
	if (!root || !key || (kind !== "query" && kind !== "url")) return false;
	const directory = join(root, kind);
	try {
		await mkdir(directory, { recursive: true, mode: 0o700 });
		await chmod(directory, 0o700);
	} catch {
		// Coordination is an optimization around the authoritative budget. If a
		// private artifact root is temporarily unavailable, proceed with the
		// process-local guard rather than turning a research branch into an
		// infrastructure failure. No evidence or graph state is accepted here.
		return true;
	}
	const path = markerPath(root, kind, key);
	try {
		const entries = await readdir(directory);
		if (entries.length >= MAX_RESERVATION_MARKERS && !entries.includes(path.split("/").pop()!)) return false;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") return true;
	}
	let handle;
	try {
		handle = await open(path, "wx", 0o600);
		await handle.writeFile(`${digest(key)}\n`, "utf8");
		await handle.sync();
		return true;
	} catch (error) {
		if ((error as NodeJS.ErrnoException)?.code === "EEXIST") return false;
		return true;
	} finally {
		await handle?.close().catch(() => undefined);
	}
}

/** A bounded diagnostic used by offline tests and status tooling. */
export async function reservationCount(root: string, kind: "query" | "url"): Promise<number> {
	try {
		const entries = await readdir(join(root, kind));
		return entries.filter((entry) => HASH.test(entry.replace(/\.reserved$/, ""))).length;
	} catch {
		return 0;
	}
}
