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

// Reconcile a whole-list rewrite against the prior items: preserve ids across a
// cosmetic rename (normalized-title match), and — critically — preserve each
// item's gate + gate_fails when the model omits the optional `gate` on rewrite.
// gate_fails is keyed off the RESOLVED gate (omitted ⇒ preserved), so a rewrite
// that simply drops the field can't wipe the failure counter and defeat
// GATE_MAX escalation. Pure + generic (id factory injected) so it unit-tests
// without the SDK.
export type ReconciledItem = {
	id: string;
	title: string;
	status: string;
	note?: string;
	failure_class?: string;
	gate?: string;
	gate_fails?: number;
};
export type IncomingItem = { title: string; status: string; note?: string; failure_class?: string; gate?: string };

export function reconcileItems(
	prev: ReconciledItem[] | undefined,
	incoming: IncomingItem[],
	makeId: () => string,
): ReconciledItem[] {
	const byTitle = new Map((prev ?? []).map((p) => [normalizeTitle(p.title), p]));
	return incoming.map((inc) => {
		const p = byTitle.get(normalizeTitle(inc.title));
		const gate = inc.gate === "" ? undefined : (inc.gate ?? p?.gate); // model can set/update/clear
		return {
			id: p?.id ?? makeId(),
			title: inc.title,
			status: inc.status,
			note: inc.note,
			failure_class: inc.status === "blocked" ? (inc.failure_class ?? "unknown") : undefined,
			gate,
			gate_fails: gate === p?.gate ? p?.gate_fails : 0, // preserved while the resolved gate is unchanged
		};
	});
}

export function planIntegrity<T extends IntegrityItem>(
	prev: T[],
	reconciled: T[],
): { reattached: T[]; droppedOpen: T[] } {
	const titles = new Set(reconciled.map((i) => normalizeTitle(i.title)));
	const reattached = prev.filter((i) => i.status === "done" && !titles.has(normalizeTitle(i.title)));
	// "blocked" carries an open question (e.g. blocked_needs_input) that must not be
	// silently discarded — it needs the SAME omission-safety net as pending/in_progress,
	// not none at all (a dropped blocked item deletes a parked user question and can
	// flip derivedStatus to "completed" while it was never answered).
	const droppedOpen = prev.filter(
		(i) => (i.status === "pending" || i.status === "in_progress" || i.status === "blocked") && !titles.has(normalizeTitle(i.title)),
	);
	return { reattached, droppedOpen };
}

// Has execution begun? Defined by the unambiguous signal — at least one item is
// done, in_progress, or blocked (a blocked item implies an attempt was made) — so
// it's robust to the phase label (which is buggy for pure /plan-yolo). Once work
// exists, an omitted open item is almost certainly a reproduction failure, not a
// deliberate prune, so the caller preserves it (omission ≠ deletion; to drop an
// item, restatus it). While still all-pending (drafting), the model keeps free
// full-replace.
export function executionUnderway(prev: IntegrityItem[]): boolean {
	return prev.some((i) => i.status === "done" || i.status === "in_progress" || i.status === "blocked");
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
