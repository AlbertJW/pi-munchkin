import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";

export type PrivateArtifactFile = { path: string; text: string };

export type AtomicWriteOptions = {
	/** File mode applied both before and after publication. */
	mode?: number;
	/** Optional containing-directory mode, tightened before publication. */
	directoryMode?: number;
};

/** Create only harness-owned directories and enforce private directory modes. */
export async function ensurePrivateDirectories(paths: string[]): Promise<void> {
	for (const path of paths) {
		await mkdir(path, { recursive: true, mode: 0o700 });
		await chmod(path, 0o700);
	}
}

async function writeAndSync(path: string, text: string, mode: number): Promise<void> {
	const handle = await open(path, "wx", mode);
	try {
		await handle.writeFile(text, "utf8");
		await handle.chmod(mode);
		await handle.sync();
	} finally {
		await handle.close();
	}
}

/**
 * Atomically replace one file and make both the bytes and directory entry
 * durable. All harness-owned single-file artifacts use this path so a new
 * writer cannot silently omit the fsync barriers required by private state.
 */
export async function atomicWriteFile(path: string, text: string, options: AtomicWriteOptions = {}): Promise<void> {
	const mode = options.mode ?? 0o600;
	const directory = dirname(path);
	await mkdir(directory, { recursive: true, ...(options.directoryMode === undefined ? {} : { mode: options.directoryMode }) });
	if (options.directoryMode !== undefined) await chmod(directory, options.directoryMode);
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	let published = false;
	try {
		await writeAndSync(temporary, text, mode);
		await rename(temporary, path);
		await chmod(path, mode);
		await syncDirectory(directory);
		published = true;
	} finally {
		if (!published) await unlink(temporary).catch(() => undefined);
	}
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try { await handle.sync(); }
	finally { await handle.close(); }
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
		for (const file of temporary) await writeAndSync(file.path, file.text, 0o600);
		for (const file of temporary) {
			await rename(file.path, file.finalPath);
			await chmod(file.finalPath, 0o600);
		}
		for (const directory of new Set(files.map(({ path }) => dirname(path)))) await syncDirectory(directory);
	} catch (error) {
		await Promise.all(temporary.map(({ path }) => unlink(path).catch(() => {})));
		throw error;
	}
}
