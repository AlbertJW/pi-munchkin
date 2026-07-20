// Process-local serialization for every pi-munchkin caller of ctx.compact().
// Pi aborts the active operation when compaction starts; overlapping requests
// can otherwise race callbacks, misattribute telemetry, or inject two resumes.

export type CompactionOwner = "compact-tool" | "context-watcher";
export type CompactionToken = Readonly<{ generation: number; request: number; owner: CompactionOwner }>;

let generation = 0;
let request = 0;
let active: CompactionToken | null = null;

export function resetCompactionCoordinator(): void {
	generation += 1;
	active = null;
}

export function beginCompaction(owner: CompactionOwner): CompactionToken | null {
	if (active) return null;
	active = Object.freeze({ generation, request: ++request, owner });
	return active;
}

export function currentCompactionOwner(): CompactionOwner | null {
	return active?.owner ?? null;
}

export function finishCompaction(token: CompactionToken): boolean {
	if (active !== token || token.generation !== generation) return false;
	active = null;
	return true;
}
