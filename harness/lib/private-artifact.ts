import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export type PrivateArtifactFile = { path: string; text: string };

/** Create only harness-owned directories and enforce private directory modes. */
export async function ensurePrivateDirectories(paths: string[]): Promise<void> {
	for (const path of paths) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
}

async function writeExclusivePrivate(path: string, text: string): Promise<void> {
	const handle = await open(path, "wx", 0o600);
	try {
		await handle.writeFile(text, "utf8");
		await handle.chmod(0o600);
	} finally {
		await handle.close();
	}
}

/**
 * Atomically replace a bounded set of private files.
 *
 * Files are published in caller order. Put human projections first and the
 * authoritative JSON last, so a crash can leave an older authority beside a
 * newer projection but never publish a new authority before its projection.
 */
export async function atomicWritePrivateFiles(files: PrivateArtifactFile[]): Promise<void> {
	const temporary = files.map(({ path, text }) => ({
		path: `${path}.${process.pid}.${randomUUID()}.tmp`,
		finalPath: path,
		text,
	}));
	try {
		await ensurePrivateDirectories([...new Set(files.map(({ path }) => dirname(path)))]);
		for (const file of temporary) await writeExclusivePrivate(file.path, file.text);
		for (const file of temporary) {
			await rename(file.path, file.finalPath);
			await chmod(file.finalPath, 0o600);
		}
	} catch (error) {
		await Promise.all(temporary.map(({ path }) => unlink(path).catch(() => {})));
		throw error;
	}
}
