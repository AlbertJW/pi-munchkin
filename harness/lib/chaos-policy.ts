// chaos-policy: pure logic for the gauntlet's deterministic fault injection.
// One fault, once, at an exact call index — everything else passes through.
// The fault TEXTS mirror the real errors the harness/OS produce, so the model's
// recovery behavior is measured against realistic observations, not strawmen.

export type ChaosSpec = { tool: string; nth: number; fault: string };

// Realistic single-shot fault observations, keyed by fault id.
export const FAULTS: Record<string, string> = {
	"perm-denied": "EACCES: permission denied — the file is not writable by this process",
	// mirrors hashline-core.ts's real stale errors (drives the re-read -> retry protocol)
	"stale-tag": "stale tag: cannot uniquely relocate the edit — the file changed too much. Read the file again, then re-emit the patch with fresh numbers.",
	"missing-file": "ENOENT: no such file or directory",
	"disconnect": "connection reset by peer — transient backend failure, retry the call",
	"edit-noop": "no changes applied: the patch matched but produced identical content",
};

// CHAOS="<tool>:<nth>:<fault>" -> spec, or null when unset/invalid (inert).
export function parseChaos(env: string | undefined): ChaosSpec | null {
	if (!env) return null;
	const m = /^([a-z_]+):(\d+):([a-z-]+)$/.exec(env.trim());
	if (!m) return null;
	const nth = Number.parseInt(m[2], 10);
	if (nth < 1 || !(m[3] in FAULTS)) return null;
	return { tool: m[1], nth, fault: m[3] };
}

// Injection state: counts calls of the target tool, fires exactly once PER ROW —
// `alreadyFired` seeds from a workdir marker file, so a c18b-style fresh session
// in the SAME workdir cannot re-inject (audit-2: per-process state made the
// "one-shot" fault fire once per recovery session, confounding exactly the
// recovery experiments the gauntlet exists to measure).
export class ChaosState {
	private seen = 0;
	private fired: boolean;
	private spec: ChaosSpec;
	constructor(spec: ChaosSpec, alreadyFired = false) {
		this.spec = spec;
		this.fired = alreadyFired;
	}

	// Called for EVERY tool call; returns the fault text exactly when this call
	// is the nth call of the target tool, else null.
	observe(toolName: string): string | null {
		if (this.fired || toolName !== this.spec.tool) return null;
		this.seen += 1;
		if (this.seen !== this.spec.nth) return null;
		this.fired = true;
		return FAULTS[this.spec.fault];
	}

	get hasFired(): boolean {
		return this.fired;
	}
}

// Marker filename (in the session cwd) recording that this row's fault fired.
export const CHAOS_MARKER = ".chaos-fired";
