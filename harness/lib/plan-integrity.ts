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
	depends_on?: string[];
};
export type IncomingItem = { title: string; status: string; note?: string; failure_class?: string; gate?: string; depends_on?: string[] };

export function reconcileItems(
	prev: ReconciledItem[] | undefined,
	incoming: IncomingItem[],
	makeId: () => string,
): ReconciledItem[] {
	const byTitle = new Map((prev ?? []).map((p) => [normalizeTitle(p.title), p]));
	return incoming.map((inc) => {
		const p = byTitle.get(normalizeTitle(inc.title));
		const gate = inc.gate === "" ? undefined : (inc.gate ?? p?.gate); // model can set/update/clear
		// Same omission-safety rule as gate: a rewrite that drops the field keeps
		// the prior ordering; an explicit [] clears it.
		const depends_on = inc.depends_on?.length === 0 ? undefined : (inc.depends_on ?? p?.depends_on);
		return {
			id: p?.id ?? makeId(),
			title: inc.title,
			status: inc.status,
			note: inc.note,
			failure_class: inc.status === "blocked" ? (inc.failure_class ?? "unknown") : undefined,
			gate,
			gate_fails: gate === p?.gate ? p?.gate_fails : 0, // preserved while the resolved gate is unchanged
			depends_on,
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
// depends_on validation for a submitted whole list. Entries reference OTHER
// items' titles in the same list (normalized-title matched — the model never
// sees engine-assigned ids). Advisory ordering, but a structurally broken graph
// (unknown ref, self-dep, cycle) is a plan-authoring error worth rejecting
// before any state is written.
export function validateDeps(items: Array<{ title: string; depends_on?: string[] }>): string[] {
	const errors: string[] = [];
	const titles = new Set<string>();
	const titleOwners = new Map<string, string>();
	for (const item of items) {
		const normalized = normalizeTitle(item.title);
		const prior = titleOwners.get(normalized);
		if (prior !== undefined) {
			errors.push(`duplicate normalized title "${item.title}" collides with "${prior}"`);
		} else {
			titleOwners.set(normalized, item.title);
			titles.add(normalized);
		}
	}
	const deps = new Map<string, string[]>();
	for (const it of items) {
		const key = normalizeTitle(it.title);
		const resolved: string[] = [];
		const seen = new Set<string>();
		for (const dep of it.depends_on ?? []) {
			const depKey = normalizeTitle(dep);
			if (seen.has(depKey)) errors.push(`"${it.title}" repeats dependency "${dep}"`);
			else if (!titles.has(depKey)) errors.push(`"${it.title}" depends on unknown item "${dep}"`);
			else if (depKey === key) errors.push(`"${it.title}" depends on itself`);
			else resolved.push(depKey);
			seen.add(depKey);
		}
		deps.set(key, resolved);
	}
	// Cycle check via DFS with colors (0 unvisited, 1 in-stack, 2 done).
	const color = new Map<string, number>();
	const inCycle = (key: string): boolean => {
		if (color.get(key) === 2) return false;
		if (color.get(key) === 1) return true;
		color.set(key, 1);
		for (const dep of deps.get(key) ?? []) if (inCycle(dep)) return true;
		color.set(key, 2);
		return false;
	};
	for (const key of deps.keys()) {
		if (color.get(key) === undefined && inCycle(key)) {
			errors.push(`dependency cycle involving "${key}"`);
			break; // one cycle report is enough to demand a rewrite
		}
	}
	return errors;
}

// Titles of an item's unmet deps: dep present in the list with status ≠ done.
// A dep whose target vanished (preserved item from a prior rewrite) counts as
// satisfied — fail-open, ordering is advisory.
export function unmetDeps(
	item: { depends_on?: string[] },
	items: Array<{ title: string; status: string }>,
): string[] {
	const byTitle = new Map(items.map((i) => [normalizeTitle(i.title), i]));
	return (item.depends_on ?? []).filter((dep) => {
		const target = byTitle.get(normalizeTitle(dep));
		return target !== undefined && target.status !== "done";
	});
}

// c32 (confabulated-SHA guard): hex tokens in model-written text that look
// like git commit references. Two admission routes: (a) 7-40 hex chars within
// ~40 chars after a commit-context word, (b) a bare exactly-40-hex token
// anywhere (sha1-shaped; 64-hex content hashes are deliberately excluded —
// this codebase is full of legitimate sha256 strings). Pure so it unit-tests
// without git; the caller does the actual `git cat-file -e` existence check.
const SHA_CONTEXT_RE = /(?:commit(?:ted)?|sha|push(?:ed)?|merged?|\brev\b|HEAD)[^\n]{0,40}?\b([0-9a-f]{7,40})\b/gi;
const BARE_SHA1_RE = /\b[0-9a-f]{40}\b/g;

export function shaCandidates(text: string, cap = 4): string[] {
	const found = new Set<string>();
	for (const match of text.matchAll(SHA_CONTEXT_RE)) {
		if (match[1].length !== 64) found.add(match[1].toLowerCase());
	}
	for (const match of text.matchAll(BARE_SHA1_RE)) {
		found.add(match[0].toLowerCase());
	}
	return [...found].slice(0, cap);
}

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
