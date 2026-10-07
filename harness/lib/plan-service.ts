import { childrenOf, depthOf, descendantCount, graphItemId, graphTerminal, validateGraph, type GraphPlanItem, type GraphPlanState } from './plan-graph.ts';
import { PLAN_MAX_ITEMS as MAX_ITEMS, PLAN_NOTE_MAX_BYTES as MAX_NOTE_BYTES, PLAN_STATE_MAX_BYTES as MAX_PLAN_BYTES, PLAN_TITLE_MAX_BYTES as MAX_TITLE_BYTES } from './plan-limits.ts';
export type Autonomy = 'lean' | 'yolo';
export type Phase = 'planned' | 'executing';
export type PlanItem = GraphPlanItem;
export type PlanState = {
    schema_version: 4 | 5;
    run_id: string;
    request: string;
    summary: string;
    autonomy: Autonomy;
    phase: Phase;
    created_at: string;
    updated_at: string;
    items: PlanItem[];
    profile?: GraphPlanState["profile"];
    research_round_contract?: GraphPlanState["research_round_contract"];
    head_terminal_at?: string;
    settled_at?: string;
    final_answer?: string;
    writer?: string;
};
export type MutatePlanOptions = {
    newRun?: boolean;
    /** Prepare dependent durable views while the plan lock is still held. If
     * preparation fails, the executable compatibility graph is not published. */
    beforePersist?: (state: PlanState) => Promise<void> | void;
};
export function truncateBytes(value: string, maxBytes: number): string {
    if (Buffer.byteLength(value, "utf8") <= maxBytes)
        return value;
    // Drop whole CODE POINTS, not code units. `.slice(0, -1)` removes one UTF-16 unit,
    // so trimming a string ending in a non-BMP character strips the low surrogate and
    // leaves the high one — at which point the byte budget is satisfied and the loop
    // stops. That lone surrogate survives JSON.stringify into plan-state.json but
    // becomes U+FFFD when the Markdown projection is written as UTF-8, so the
    // authoritative file and its projection disagree byte-for-byte. Measured:
    // truncateBytes("界".repeat(39) + "😀", 120) ended on 0xD83D.
    let out = value;
    while (out.length > 0 && Buffer.byteLength(out, "utf8") > maxBytes) {
        const last = out.charCodeAt(out.length - 1);
        const lowSurrogate = last >= 0xDC00 && last <= 0xDFFF;
        out = out.slice(0, lowSurrogate ? -2 : -1);
    }
    const tail = out.charCodeAt(out.length - 1);
    if (tail >= 0xD800 && tail <= 0xDBFF)
        out = out.slice(0, -1);
    return out;
}
export function itemId(): string { return graphItemId(); }
export function utf8Bytes(value: string): number { return Buffer.byteLength(value, "utf8"); }
export function cleanText(value: unknown): string {
    return String(value ?? "")
        .replace(/\r\n?/g, "\n")
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/gu, "")
        .trim();
}
export function currentItem(state: PlanState): PlanItem | undefined {
    return state.items.find((item) => item.status === "in_progress") ?? state.items.find((item) => item.status === "pending");
}
export function openItemCount(state: PlanState): number { return state.items.filter((item) => !graphTerminal(item)).length; }
export function blockedItemCount(state: PlanState): number { return state.items.filter((item) => item.status === "blocked").length; }
export function derivedStatus(state: PlanState): string {
    if (state.items.length === 0)
        return "empty";
    if (state.settled_at)
        return "completed";
    const requiresSettlement = state.schema_version === 5 && Boolean(state.profile || state.items.some((item) => item.parent_id));
    if (!requiresSettlement && state.items.every((item) => item.status === "done"))
        return "completed";
    if (state.items.every((item) => graphTerminal(item)) && state.items.some((item) => item.status === "blocked"))
        return "blocked";
    if (requiresSettlement && state.items.every((item) => graphTerminal(item)))
        return "ready for settlement";
    return state.phase === "planned" ? "planned (awaiting /plan-go)" : "executing";
}
export function renderItems(state: PlanState, selectedId?: string, includeDescendants = false): string {
    const selected = selectedId ? state.items.find((item) => item.id === selectedId) : undefined;
    const subtree = new Set<string>();
    if (selected) {
        const queue = [selected.id];
        while (queue.length) {
            const id = queue.shift()!;
            if (subtree.has(id))
                continue;
            subtree.add(id);
            for (const child of childrenOf(state.items, id))
                queue.push(child.id);
        }
    }
    const visible = selected ? state.items.filter((item) => subtree.has(item.id)) : includeDescendants ? state.items : state.items.filter((item) => !item.parent_id);
    const selectedDepth = selected && state.schema_version === 5 ? (depthOf(state.items, selected.id) ?? 0) : 0;
    return visible.flatMap((item) => {
        const itemDepth = state.schema_version === 5 ? (depthOf(state.items, item.id) ?? 0) : 0;
        const indent = "  ".repeat(selected || includeDescendants ? Math.max(0, itemDepth - selectedDepth) : 0);
        const descendants = state.schema_version === 5 ? descendantCount(state.items, item.id) : 0;
        // Ambient status intentionally exposes only a bounded count, never the gap
        // text. Source-validation gaps are still evidence gaps and must not vanish
        // from the compact view merely because their internal label uses `source:`.
        const gaps = item.evidence_gaps?.length ?? 0;
        const budget = item.budget ? ` budget=${item.budget.used.searches}/${item.budget.allocated.searches}s ${item.budget.used.reads}/${item.budget.allocated.reads}r` : "";
        const lease = item.lease ? " dispatch=in-flight" : "";
        const coverage = item.coverage ? ` coverage=${item.coverage.complete ? "complete" : "incomplete"}:${item.coverage.strategy}` : "";
        const graph = descendants || gaps || lease ? ` descendants=${descendants} gaps=${gaps}${budget}${lease}${coverage}` : `${budget}${coverage}`;
        const first = `${indent}${item.id}  [${item.status.replace("_", " ")}] ${item.title}`;
        if (!item.note)
            return [`${first}${graph}`];
        return [`${first}${graph}`, ...item.note.split("\n").filter(Boolean).map((line) => `${indent}  - ${line.replace(/^[-*]\s*/, "")}`)];
    }).join("\n");
}
export function renderTodo(state: PlanState, selectedId?: string, includeDescendants = false): string {
    const lines = renderItems(state, selectedId, includeDescendants);
    return [
        "# Active Request", state.request, "", "# Status", derivedStatus(state), "",
        "# Plan Summary", state.summary || "(none)", "", selectedId ? `# Subtree ${selectedId}` : "# Todo", lines || "(none)", "",
        "# Meta", `Phase: ${state.phase}`, `Head terminal: ${state.head_terminal_at ? "yes" : "no"}`, `Updated: ${state.updated_at}`, `Run ID: ${state.run_id}`, "",
    ].join("\n");
}
export function validateStateSize(state: PlanState): void {
    if (state.schema_version === 5 && !(state.phase === "planned" && state.items.length === 0)) {
        const errors = validateGraph(state as GraphPlanState);
        if (errors.length)
            rejectPlanTool(`plan graph rejected: ${errors.join("; ")}`);
    }
    const bytes = utf8Bytes(`${JSON.stringify(state)}\n`);
    if (bytes > MAX_PLAN_BYTES)
        rejectPlanTool(`plan rejected: authoritative state would be ${bytes} bytes; maximum is ${MAX_PLAN_BYTES}`);
}
export function rejectPlanTool(text: string): never { throw new Error(text); }
export function validateIncoming(items: Array<{
    item_id?: string;
    title: string;
    note?: string;
}>): void {
    if (items.length < 1 || items.length > MAX_ITEMS)
        rejectPlanTool(`plan_write rejected: provide 1-${MAX_ITEMS} top-level items`);
    const ids = new Set<string>();
    for (const [index, item] of items.entries()) {
        const title = cleanText(item.title);
        const note = item.note === undefined ? undefined : cleanText(item.note);
        if (!title)
            rejectPlanTool(`plan_write rejected: item ${index + 1} has an empty title`);
        if (utf8Bytes(title) > MAX_TITLE_BYTES)
            rejectPlanTool(`plan_write rejected: item ${index + 1} title exceeds ${MAX_TITLE_BYTES} UTF-8 bytes`);
        if (note !== undefined && utf8Bytes(note) > MAX_NOTE_BYTES)
            rejectPlanTool(`plan_write rejected: item ${index + 1} note exceeds ${MAX_NOTE_BYTES} UTF-8 bytes`);
        if (item.item_id !== undefined) {
            if (!/^[A-Za-z0-9._:-]{1,96}$/.test(item.item_id))
                rejectPlanTool(`plan_write rejected: item ${index + 1} has an invalid item_id`);
            if (ids.has(item.item_id))
                rejectPlanTool(`plan_write rejected: duplicate item_id ${item.item_id}`);
            ids.add(item.item_id);
        }
    }
}
export function structuralItems(previous: PlanState | undefined, incoming: Array<{
    item_id?: string;
    title: string;
    note?: string;
}>): PlanItem[] {
    validateIncoming(incoming);
    const byId = new Map((previous?.items ?? []).map((item) => [item.id, item]));
    const retained = new Set<string>();
    const next = incoming.map((item) => {
        const prior = item.item_id ? byId.get(item.item_id) : undefined;
        if (item.item_id && !prior)
            rejectPlanTool(`plan_write rejected: unknown item_id ${item.item_id}. Valid ids: ${[...byId.keys()].join(", ") || "(none)"}`);
        if (prior)
            retained.add(prior.id);
        return {
            id: prior?.id ?? itemId(), title: cleanText(item.title),
            note: item.note === undefined ? prior?.note : (cleanText(item.note) || undefined),
            status: prior?.status ?? "pending",
        } satisfies PlanItem;
    });
    // Unresolved work may not silently disappear from an EXECUTING plan. During
    // pre-go review (phase "planned") a structural rewrite that drops items is
    // legitimate revision — and the old unconditional rule was a trap there: the
    // rejection named plan_update, which planning mode blocks (audit A4, 2026-08-25).
    const omitted = previous?.phase === "executing" ? previous.items.filter((item) => (item.status === "pending" || item.status === "in_progress") && !retained.has(item.id)) : [];
    if (omitted.length)
        rejectPlanTool(`plan_write rejected: unresolved item_id(s) omitted: ${omitted.map((item) => item.id).join(", ")}. Mark them done or blocked with plan_update first, or retain them (with their item_id) in the revised items.`);
    return next;
}
