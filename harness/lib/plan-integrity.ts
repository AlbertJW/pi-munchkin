// Plan-integrity diff for plan_write's whole-list rewrites.
//
// plan_write replaces the entire stored list each call; identity is keyed on
// exact title. A model that fails to re-emit the full list (small/quantized
// local models do this) silently drops items — including completed work. This
// computes what a rewrite dropped so the caller can preserve done work and
// surface/trace the rest. Pure + generic so it unit-tests without the SDK.

export type IntegrityItem = { title: string; status: string };

// Identity is title-keyed, so a cosmetic rewrite of an item (backticks, case,
// spacing) would otherwise read as "different item" → false omission → re-attach
// → duplicate. Normalize before matching so a renamed item maps to its prior self.
// Conservative: backticks + whitespace + case only — no punctuation stripping that
// could merge genuinely-distinct items.
export function normalizeTitle(title: string): string {
	return title.replace(/`/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function planIntegrity<T extends IntegrityItem>(
	prev: T[],
	reconciled: T[],
): { reattached: T[]; droppedOpen: T[] } {
	const titles = new Set(reconciled.map((i) => normalizeTitle(i.title)));
	const reattached = prev.filter((i) => i.status === "done" && !titles.has(normalizeTitle(i.title)));
	const droppedOpen = prev.filter(
		(i) => (i.status === "pending" || i.status === "in_progress") && !titles.has(normalizeTitle(i.title)),
	);
	return { reattached, droppedOpen };
}

// Has execution begun? Defined by the unambiguous signal — at least one item is
// done or in_progress — so it's robust to the phase label (which is buggy for
// pure /plan-yolo). Once work exists, an omitted open item is almost certainly a
// reproduction failure, not a deliberate prune, so the caller preserves it
// (omission ≠ deletion; to drop an item, restatus it). While still all-pending
// (drafting), the model keeps free full-replace.
export function executionUnderway(prev: IntegrityItem[]): boolean {
	return prev.some((i) => i.status === "done" || i.status === "in_progress");
}

// B (omission-safe execution) protects against ACCIDENTAL loss but must defer to
// PERSISTENT intent: an open item the model keeps omitting (e.g. a parent it
// replaced with sub-items) is deliberately gone. Preserve omitted open items, but
// yield one after K consecutive preserves. Count is per-item (preserve_count),
// incremented here and reset elsewhere when the model re-includes the item — NOT
// the action fingerprint, which churns as the plan grows. R1 (done-preserve) never
// reaches this path: completed work is never yielded.
export function preserveDecision<T extends { preserve_count?: number }>(
	droppedOpen: T[],
	max: number,
): { preserve: T[]; yielded: T[] } {
	const preserve: T[] = [];
	const yielded: T[] = [];
	for (const it of droppedOpen) {
		const n = (it.preserve_count ?? 0) + 1;
		if (n >= max) yielded.push(it);
		else preserve.push({ ...it, preserve_count: n });
	}
	return { preserve, yielded };
}
