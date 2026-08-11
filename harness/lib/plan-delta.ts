export type DeltaStatus = "pending" | "in_progress" | "done" | "blocked";
export type PlanDelta = {
	item_id: string;
	status: DeltaStatus;
	note?: string;
	failure_class?: string;
};
export type DeltaItem = { id: string; status: DeltaStatus; note?: string; failure_class?: string };

export type DeltaResult =
	| { ok: true; items: DeltaItem[]; changed: number; idempotent: number }
	| { ok: false; errors: string[] };

const FAILURE_CLASSES = new Set(["blocked_needs_input", "blocked_other", "user_action_required", "unknown"]);

/** Apply stable-ID status changes without allowing title, order, dependency, or membership edits. */
export function applyPlanDeltas(items: DeltaItem[], deltas: PlanDelta[]): DeltaResult {
	if (!Array.isArray(deltas) || deltas.length === 0) return { ok: false, errors: ["at least one delta is required"] };
	const byId = new Map(items.map((item) => [item.id, item]));
	const seen = new Map<string, PlanDelta>();
	const errors: string[] = [];
	for (const delta of deltas) {
		if (!delta || typeof delta.item_id !== "string" || !/^[A-Za-z0-9._:-]{1,96}$/.test(delta.item_id)) {
			errors.push("item_id must be a bounded stable identifier");
			continue;
		}
		if (!byId.has(delta.item_id)) errors.push(`unknown item_id: ${delta.item_id}`);
		if (!new Set(["pending", "in_progress", "done", "blocked"]).has(delta.status)) errors.push(`invalid status for ${delta.item_id}`);
		if (delta.note !== undefined && (typeof delta.note !== "string" || delta.note.length > 300 || /[\r\n]/.test(delta.note))) errors.push(`note must be one bounded line for ${delta.item_id}`);
		if (delta.failure_class !== undefined && (typeof delta.failure_class !== "string" || !FAILURE_CLASSES.has(delta.failure_class))) errors.push(`invalid failure class for ${delta.item_id}`);
		const previous = seen.get(delta.item_id);
		if (previous && JSON.stringify(previous) !== JSON.stringify(delta)) errors.push(`conflicting duplicate delta: ${delta.item_id}`);
		seen.set(delta.item_id, delta);
	}
	if (errors.length) return { ok: false, errors: [...new Set(errors)].slice(0, 16) };
	let changed = 0;
	let idempotent = 0;
	const next = items.map((item) => {
		const delta = seen.get(item.id);
		if (!delta) return { ...item };
		const same = item.status === delta.status && (delta.note === undefined || item.note === delta.note) &&
			(delta.failure_class === undefined || item.failure_class === delta.failure_class);
		if (same) { idempotent += 1; return { ...item }; }
		changed += 1;
		const updated = { ...item, status: delta.status };
		if (delta.note !== undefined) updated.note = delta.note;
		if (delta.failure_class !== undefined) updated.failure_class = delta.failure_class;
		return updated;
	});
	return { ok: true, items: next, changed, idempotent };
}
