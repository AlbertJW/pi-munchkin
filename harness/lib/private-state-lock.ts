import { randomUUID } from "node:crypto";
import { mkdir, readFile, rmdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

/** A lock cannot be safely stolen by read-then-unlink: another contender may
 * replace it between those operations. Abandoned/unknown owners therefore
 * require operator recovery with every writer stopped. No age-based stealing.
 * The caller owns creation and permission checks for the containing directory. */
export async function withPrivateStateLock<T>(
	path: string,
	fn: () => Promise<T>,
	options: { timeoutMs?: number } = {},
): Promise<T> {
	const lockPath = `${path}.lock`;
	const ownerPath = join(lockPath, "owner.json");
	const timeout = options.timeoutMs ?? 10_000;
	if (!Number.isFinite(timeout) || timeout < 0) throw new Error("invalid private state lock timeout");
	const deadline = performance.now() + timeout;
	const nonce = randomUUID();
	while (true) {
		try { await mkdir(lockPath, { mode: 0o700 }); break; }
		catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (performance.now() >= deadline) {
				throw new Error(`Private state is locked: ${lockPath}. Retry when the other writer finishes. If interrupted, stop all sessions using this scope, inspect and remove only this lock, then retry; preserve the ledger.`);
			}
			await new Promise(resolve => setTimeout(resolve, Math.min(25, Math.max(1, deadline - performance.now()))));
		}
	}
	try {
		await writeFile(ownerPath, JSON.stringify({ nonce, pid: process.pid, created_at: new Date().toISOString() }), { flag: "wx", mode: 0o600 });
	} catch (error) {
		// Only remove a directory still empty from our own failed acquisition.
		await rmdir(lockPath).catch(() => undefined);
		throw error;
	}
	try { return await fn(); }
	finally {
		// Ownership checks also protect against manual replacement. A cleanup
		// failure must not turn a committed write into an apparent failed write.
		try {
			const owner = JSON.parse(await readFile(ownerPath, "utf8"));
			if (owner?.nonce === nonce) {
				await unlink(ownerPath);
				await rmdir(lockPath);
			}
		} catch { /* Preserve an unknown/replaced lock for explicit recovery. */ }
	}
}
