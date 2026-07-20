// Context-watcher pure decision logic (zero imports — unit-testable without the
// SDK, like hashline-core). The extension feeds it pi's estimated context
// `percent`; this decides whether to fire a proactive compaction, with
// hysteresis so we don't compact-thrash near the threshold.

export type WatchDecision = { compact: boolean; armed: boolean };
export type WatcherConfig = { enabled: boolean; thresholdPct: number; rearmPct: number };

export function readWatcherConfig(env: NodeJS.ProcessEnv = process.env): WatcherConfig {
	const raw = env.CTX_WATCH_PCT || "70";
	const thresholdPct = /^(60|70|80)$/.test(raw) ? Number(raw) : 70;
	const enabled = env.CONTEXT_WATCHER === "off" ? false : true; // invalid values fail to the safe on-default
	return { enabled, thresholdPct, rearmPct: thresholdPct - 15 };
}

export function usageDetail(usage?: { tokens: number | null; contextWindow: number; percent: number | null }): {
	contextTokens: number | null;
	contextWindow: number | null;
	contextPct: number | null;
} {
	return {
		contextTokens: usage?.tokens ?? null,
		contextWindow: usage?.contextWindow ?? null,
		contextPct: usage?.percent == null ? null : Math.round(usage.percent * 100) / 100,
	};
}

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
