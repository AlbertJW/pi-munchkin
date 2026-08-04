import { createReadStream } from "node:fs";
import { createHash } from "node:crypto";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";

export type MirrorEntry = { source: string; destination: string };
export type MirrorDrift = MirrorEntry & { reason: "missing" | "content" };

type PackageManifest = {
  files?: string[];
  pi?: { extensions?: string[]; skills?: string[] };
};

async function filesBelow(root: string, relativeDir: string): Promise<string[]> {
  const absolute = resolve(root, relativeDir);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = `${relativeDir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await filesBelow(root, child));
    else if (entry.isFile()) files.push(child);
  }
  return files;
}

export async function buildLiveMirrorManifest(root: string, manifest: PackageManifest): Promise<MirrorEntry[]> {
  const sourcePaths = new Set<string>();
  for (const extension of manifest.pi?.extensions ?? []) sourcePaths.add(extension);
  for (const file of manifest.files ?? []) {
    if (file.startsWith("harness/lib/") || file === "harness/APPEND_SYSTEM.md") sourcePaths.add(file);
  }
  for (const dir of ["harness/vendor", "harness/agents", "examples", ...(manifest.pi?.skills ?? [])]) {
    for (const file of await filesBelow(root, dir)) sourcePaths.add(file);
  }
  return [...sourcePaths].sort().map((source) => ({
    source,
    destination: source.startsWith("harness/") ? source.slice("harness/".length) : source,
  }));
}

async function hashFile(path: string): Promise<string | null> {
  return await new Promise((resolveHash, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") resolveHash(null);
      else reject(error);
    });
    stream.on("end", () => resolveHash(hash.digest("hex")));
  });
}

export async function compareLiveMirror(root: string, agentDir: string, entries: MirrorEntry[]): Promise<MirrorDrift[]> {
  const drift: MirrorDrift[] = [];
  for (const entry of entries) {
    const [sourceHash, destinationHash] = await Promise.all([
      hashFile(resolve(root, entry.source)),
      hashFile(resolve(agentDir, entry.destination)),
    ]);
    if (destinationHash === null) drift.push({ ...entry, reason: "missing" });
    else if (sourceHash !== destinationHash) drift.push({ ...entry, reason: "content" });
  }
  return drift;
}
