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

// The live agent dir gets ONE ordered entry point instead of loose files.
//
// Pi discovers `<agentDir>/extensions/*.ts` by readdir (loader.js
// discoverExtensionsInDir), i.e. in directory order — alphabetical on this
// machine — so a flat mirror silently DISCARDS the causal order the package
// manifest declares. That is not cosmetic: control-arbiter would decide before
// its producers propose, run-capsule would arm before the kernel disarms it,
// and telemetry-flush would no longer be last. Same files, same hashes,
// different architecture.
//
// The loader's own rule 3 is the remedy: a SUBDIRECTORY containing a
// package.json with `pi.extensions` loads exactly what it declares, in order.
// So everything the extensions import moves under one package directory,
// preserving harness-relative structure (`../lib/x.ts` must keep resolving),
// while the artifacts pi reads from the agent ROOT — APPEND_SYSTEM.md, agents/,
// skills/ — stay where pi looks for them.
export const LIVE_PACKAGE_DIR = "extensions/pi-munchkin";

function mirrorDestination(source: string): string {
  if (source.startsWith("harness/extensions/") || source.startsWith("harness/lib/") || source.startsWith("harness/vendor/")) {
    return `${LIVE_PACKAGE_DIR}/${source.slice("harness/".length)}`;
  }
  return source.startsWith("harness/") ? source.slice("harness/".length) : source;
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
  return [...sourcePaths].sort().map((source) => ({ source, destination: mirrorDestination(source) }));
}

/** The ordered entry manifest written into the live package directory. */
export function liveOrderedManifest(manifest: PackageManifest): { extensions: string[] } {
  return {
    extensions: (manifest.pi?.extensions ?? []).map((extension) => `./${extension.slice("harness/".length)}`),
  };
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
