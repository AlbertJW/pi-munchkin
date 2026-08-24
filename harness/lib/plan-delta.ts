export type DeltaStatus = "pending" | "in_progress" | "done" | "blocked";
export type PlanDelta = {
	item_id: string;
	status?: DeltaStatus;
	note?: string;
};
export type DeltaItem = { id: string; status: DeltaStatus; note?: string };

export type DeltaResult =
	| { ok: true; items: DeltaItem[]; changed: number; idempotent: number }
	| { ok: false; errors: string[] };

/** Apply bounded stable-ID status/note changes without changing plan structure. */
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
		if (delta.status !== undefined && !new Set(["pending", "in_progress", "done", "blocked"]).has(delta.status)) errors.push(`invalid status for ${delta.item_id}`);
		if (delta.status === undefined && delta.note === undefined) errors.push(`status or note is required for ${delta.item_id}`);
		if (delta.note !== undefined && (typeof delta.note !== "string" || Buffer.byteLength(delta.note, "utf8") > 300 || /\r/.test(delta.note))) errors.push(`note must be at most 300 UTF-8 bytes for ${delta.item_id}`);
		if (delta.status === "blocked" && (!delta.note || !delta.note.trim())) errors.push(`blocked status requires a note for ${delta.item_id}`);
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
		const status = delta.status ?? item.status;
		const same = item.status === status && (delta.note === undefined || item.note === delta.note);
		if (same) { idempotent += 1; return { ...item }; }
		changed += 1;
		const updated = { ...item, status };
		if (delta.note !== undefined) updated.note = delta.note;
		return updated;
	});
	if (next.filter((item) => item.status === "in_progress").length > 1) {
		return { ok: false, errors: ["at most one item may be in_progress"] };
	}
	return { ok: true, items: next, changed, idempotent };
}
