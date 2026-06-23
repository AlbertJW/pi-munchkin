// Context-watcher pure decision logic (zero imports — unit-testable without the
// SDK, like hashline-core). The extension feeds it pi's estimated context
// `percent`; this decides whether to fire a proactive compaction, with
// hysteresis so we don't compact-thrash near the threshold.

export type WatchDecision = { compact: boolean; armed: boolean };

// armed: true once usage has dropped below rearmPct (or at session start), so a
// single crossing fires exactly once. Fires when armed && percent >= threshold;
// disarms on fire; re-arms only when percent falls back under rearmPct.
export function decide(
	percent: number | null,
	armed: boolean,
	thresholdPct: number,
	rearmPct: number,
): WatchDecision {
	if (percent === null || !Number.isFinite(percent)) return { compact: false, armed };
	if (armed && percent >= thresholdPct) return { compact: true, armed: false };
	if (!armed && percent < rearmPct) return { compact: false, armed: true };
	return { compact: false, armed };
}
