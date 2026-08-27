// Process-local serialization for every pi-munchkin caller of ctx.compact().
// Pi aborts the active operation when compaction starts; overlapping requests
// can otherwise race callbacks, misattribute telemetry, or inject two resumes.
//
// State lives on globalThis, NOT module scope: pi loads each extension with its
// own jiti instance (moduleCache: false), so a module-scoped singleton here is
// silently per-extension — compact-tool's token was invisible to
// context-watcher for the extension's whole life, making the "compact-tool"
// requester attribution zero-by-construction (fixed 2026-07-29). Same idiom as
// telemetry.ts's cross-instance caches.

export type CompactionOwner = "compact-tool" | "context-watcher" | "model-handoff";
export type CompactionToken = Readonly<{ generation: number; request: number; owner: CompactionOwner }>;

type CoordinatorState = { generation: number; request: number; active: CompactionToken | null };

function state(): CoordinatorState {
	const g = globalThis as Record<string, unknown>;
	if (!g.__pi_compaction_v1) g.__pi_compaction_v1 = { generation: 0, request: 0, active: null };
	return g.__pi_compaction_v1 as CoordinatorState;
}

export function resetCompactionCoordinator(): void {
	const s = state();
	s.generation += 1;
	s.active = null;
}

export function beginCompaction(owner: CompactionOwner): CompactionToken | null {
	const s = state();
	if (s.active) return null;
	s.active = Object.freeze({ generation: s.generation, request: ++s.request, owner });
	return s.active;
}

export function currentCompactionOwner(): CompactionOwner | null {
	return state().active?.owner ?? null;
}

export function finishCompaction(token: CompactionToken): boolean {
	const s = state();
	if (s.active !== token || token.generation !== s.generation) return false;
	s.active = null;
	return true;
}
