import { createHash, randomUUID } from "node:crypto";

export const PLAN_GRAPH_MAX_NODES = 24;
export const PLAN_GRAPH_MAX_DEPTH = 3;
export const DEEP_RESEARCH_MAX_DEPTH = 2;
export const DEEP_RESEARCH_MAX_ROOTS = 3;
export const DEEP_RESEARCH_MAX_CHILDREN = 2;

export type PlanStatus = "pending" | "in_progress" | "done" | "blocked" | "deferred";
export type PlanNodeKind = "work" | "research_branch" | "research_leaf";
export type ResearchBudget = { searches: number; reads: number };
export type BudgetAccount = { allocated: ResearchBudget; used: ResearchBudget };
export type Deferral = { value: string; risk: string; rationale: string };
export type RetrievalCoverage = {
	strategy: "direct" | "structural" | "hybrid";
	scope: "bounded" | "exhaustive";
	returned_count: number;
	total_count?: number;
	truncated: boolean;
	budget_exhausted: boolean;
	failed: boolean;
	complete: boolean;
};

export type GraphPlanItem = {
	id: string;
	title: string;
	note?: string;
	status: PlanStatus;
	parent_id?: string;
	kind?: PlanNodeKind;
	owner_ref?: string;
	budget?: BudgetAccount;
	evidence_gaps?: string[];
	source_leads?: string[];
	coverage?: RetrievalCoverage;
	defer?: Deferral;
};

export type ResearchProfile = {
	name: "deep-research";
	max_depth: 2;
	max_children: 2;
	discovery_budget: ResearchBudget;
	validation_reads: number;
};

export type GraphPlanState = {
	schema_version: 5;
	run_id: string;
	request: string;
	summary: string;
	autonomy: "lean" | "yolo";
	phase: "planned" | "executing";
	created_at: string;
	updated_at: string;
	items: GraphPlanItem[];
	profile?: ResearchProfile;
	settled_at?: string;
	writer?: string;
};

export type BranchChildInput = {
	item_id?: string;
	title: string;
	note?: string;
	budget?: ResearchBudget;
};

export function boundedInteger(value: unknown, max = 1_000): value is number {
	return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= max;
}

export function validBudget(value: unknown): value is ResearchBudget {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return Object.keys(item).length === 2 && boundedInteger(item.searches, 100) && boundedInteger(item.reads, 100);
}

export function validCoverage(value: unknown): value is RetrievalCoverage {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	const allowed = new Set(["strategy", "scope", "returned_count", "total_count", "truncated", "budget_exhausted", "failed", "complete"]);
	if (!Object.keys(item).every((key) => allowed.has(key))) return false;
	if (!["direct", "structural", "hybrid"].includes(String(item.strategy)) || !["bounded", "exhaustive"].includes(String(item.scope))) return false;
	if (!boundedInteger(item.returned_count, 100_000) || (item.total_count !== undefined && !boundedInteger(item.total_count, 100_000))) return false;
	if (typeof item.truncated !== "boolean" || typeof item.budget_exhausted !== "boolean" || typeof item.failed !== "boolean" || typeof item.complete !== "boolean") return false;
	if (item.total_count !== undefined && Number(item.returned_count) > Number(item.total_count)) return false;
	if (item.scope === "exhaustive" && item.total_count === undefined) return false;
	const countComplete = item.scope === "bounded" || item.returned_count === item.total_count;
	return item.complete === (!item.truncated && !item.budget_exhausted && !item.failed && countComplete);
}

export function validDeferral(value: unknown): value is Deferral {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	if (!Object.keys(item).every((key) => ["value", "risk", "rationale"].includes(key))) return false;
	return boundedText(item.value, 200) && boundedText(item.risk, 200) && boundedText(item.rationale, 300);
}

function boundedText(value: unknown, bytes: number): value is string {
	return typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= bytes && !/\r/.test(value);
}

function publicUrl(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 1_999) return false;
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
	} catch { return false; }
}

export function addBudget(a: ResearchBudget, b: ResearchBudget): ResearchBudget {
	return { searches: a.searches + b.searches, reads: a.reads + b.reads };
}

export function budgetWithin(value: ResearchBudget, ceiling: ResearchBudget): boolean {
	return value.searches <= ceiling.searches && value.reads <= ceiling.reads;
}

export function graphItemId(): string {
	return randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase();
}

export function ownerRef(runId: string, itemId: string): string {
	return createHash("sha256").update(`plan-owner:${runId}:${itemId}`).digest("hex").slice(0, 24);
}

export function childrenOf(items: GraphPlanItem[], parentId: string): GraphPlanItem[] {
	return items.filter((item) => item.parent_id === parentId);
}

export function depthOf(items: GraphPlanItem[], itemId: string): number | null {
	const byId = new Map(items.map((item) => [item.id, item]));
	let current = byId.get(itemId);
	if (!current) return null;
	let depth = 0;
	const seen = new Set<string>();
	while (current.parent_id) {
		if (seen.has(current.id)) return null;
		seen.add(current.id);
		current = byId.get(current.parent_id);
		if (!current) return null;
		depth += 1;
	}
	return depth;
}

export function descendantCount(items: GraphPlanItem[], itemId: string): number {
	let count = 0;
	const queue = [itemId];
	const seen = new Set<string>(queue);
	while (queue.length) {
		const parent = queue.shift()!;
		for (const child of childrenOf(items, parent)) {
			if (seen.has(child.id)) continue;
			seen.add(child.id);
			queue.push(child.id);
			count += 1;
		}
	}
	return count;
}

export function validateGraph(state: GraphPlanState): string[] {
	const errors: string[] = [];
	if (state.schema_version !== 5) errors.push("graph state must use schema_version 5");
	if (!Array.isArray(state.items) || state.items.length < 1 || state.items.length > PLAN_GRAPH_MAX_NODES) {
		errors.push(`graph must contain 1-${PLAN_GRAPH_MAX_NODES} nodes`);
		return errors;
	}
	const byId = new Map<string, GraphPlanItem>();
	for (const item of state.items) {
		if (!/^[A-Za-z0-9._:-]{1,96}$/.test(item.id)) errors.push("invalid node id");
		if (byId.has(item.id)) errors.push(`duplicate node id: ${item.id}`);
		byId.set(item.id, item);
		if (!boundedText(item.title, 120)) errors.push(`invalid title: ${item.id}`);
		if (item.note !== undefined && !boundedText(item.note, 300)) errors.push(`invalid note: ${item.id}`);
		if (!new Set<PlanStatus>(["pending", "in_progress", "done", "blocked", "deferred"]).has(item.status)) errors.push(`invalid status: ${item.id}`);
		if (item.kind !== undefined && !["work", "research_branch", "research_leaf"].includes(item.kind)) errors.push(`invalid node kind: ${item.id}`);
		if (item.parent_id !== undefined && !/^[A-Za-z0-9._:-]{1,96}$/.test(item.parent_id)) errors.push(`invalid parent id: ${item.id}`);
		if (item.parent_id === item.id) errors.push(`node cannot parent itself: ${item.id}`);
		if (item.owner_ref !== undefined && !/^[a-f0-9]{24}$/.test(item.owner_ref)) errors.push(`invalid owner reference: ${item.id}`);
		if (item.budget && (!validBudget(item.budget.allocated) || !validBudget(item.budget.used) || !budgetWithin(item.budget.used, item.budget.allocated))) {
			errors.push(`invalid budget: ${item.id}`);
		}
		if (item.evidence_gaps !== undefined && (!Array.isArray(item.evidence_gaps) || item.evidence_gaps.length > 8 || item.evidence_gaps.some((gap) => !boundedText(gap, 300)))) errors.push(`invalid evidence gaps: ${item.id}`);
		if (item.source_leads !== undefined && (!Array.isArray(item.source_leads) || item.source_leads.length > 10 || item.source_leads.some((url) => !publicUrl(url)))) errors.push(`invalid source leads: ${item.id}`);
		if (item.coverage && !validCoverage(item.coverage)) errors.push(`invalid retrieval coverage: ${item.id}`);
		if (item.defer !== undefined && !validDeferral(item.defer)) errors.push(`invalid deferral: ${item.id}`);
		if (item.status === "deferred" && !validDeferral(item.defer)) {
			errors.push(`deferred node requires value, risk, and rationale: ${item.id}`);
		}
	}
	for (const item of state.items) {
		if (item.parent_id && !byId.has(item.parent_id)) errors.push(`missing parent for ${item.id}: ${item.parent_id}`);
		const depth = depthOf(state.items, item.id);
		if (depth === null) errors.push(`cycle or orphan detected at ${item.id}`);
		else {
			// Delegation calls the root planner depth 1 and its scout depth 2;
			// graph storage is zero-indexed, so that ceiling is structural depth 1.
			const maximumDepth = state.profile ? state.profile.max_depth - 1 : PLAN_GRAPH_MAX_DEPTH;
			if (depth > maximumDepth) errors.push(`maximum graph depth exceeded at ${item.id}`);
		}
		const children = childrenOf(state.items, item.id);
		if (state.profile && children.length > state.profile.max_children) errors.push(`maximum children exceeded at ${item.id}`);
		if (children.some((child) => !graphTerminal(child)) && graphTerminal(item)) errors.push(`terminal parent has open children: ${item.id}`);
		if (item.budget && children.length) {
			const allocated = children.reduce((sum, child) => addBudget(sum, child.budget?.allocated ?? { searches: 0, reads: 0 }), { searches: 0, reads: 0 });
			if (!budgetWithin(allocated, item.budget.allocated)) errors.push(`child budgets exceed parent allocation: ${item.id}`);
			const used = children.reduce((sum, child) => addBudget(sum, child.budget?.used ?? { searches: 0, reads: 0 }), { searches: 0, reads: 0 });
			if (!budgetWithin(used, item.budget.used)) errors.push(`child budget use exceeds parent consumption: ${item.id}`);
		}
	}
	if (state.profile) {
		if (state.profile.name !== "deep-research" || state.profile.max_depth !== DEEP_RESEARCH_MAX_DEPTH ||
			state.profile.max_children !== DEEP_RESEARCH_MAX_CHILDREN || !validBudget(state.profile.discovery_budget) ||
			state.profile.discovery_budget.searches !== 3 || state.profile.discovery_budget.reads !== 5 || state.profile.validation_reads !== 5) {
			errors.push("invalid deep-research profile constants");
		}
		const roots = state.items.filter((item) => !item.parent_id);
		if (roots.length > DEEP_RESEARCH_MAX_ROOTS) errors.push(`deep-research allows at most ${DEEP_RESEARCH_MAX_ROOTS} roots`);
		for (const item of state.items) {
			const depth = depthOf(state.items, item.id);
			if (depth === 0 && item.kind !== "research_branch") errors.push(`deep-research root must be a research_branch: ${item.id}`);
			if (depth === 1 && item.kind !== "research_leaf") errors.push(`deep-research child must be a research_leaf: ${item.id}`);
			if (!item.owner_ref || !item.budget) errors.push(`deep-research node requires owner and budget: ${item.id}`);
			else if (item.budget.allocated.searches + item.budget.allocated.reads < 1) errors.push(`deep-research node requires a non-zero allocation: ${item.id}`);
		}
		const allocated = roots.reduce((sum, item) => addBudget(sum, item.budget?.allocated ?? { searches: 0, reads: 0 }), { searches: 0, reads: 0 });
		if (!budgetWithin(allocated, state.profile.discovery_budget)) errors.push("root budgets exceed the deep-research discovery envelope");
	}
	return [...new Set(errors)].slice(0, 16);
}

export function expandGraph(state: GraphPlanState, parentId: string, incoming: BranchChildInput[]): GraphPlanState {
	const parent = state.items.find((item) => item.id === parentId);
	if (!parent) throw new Error(`unknown parent_item_id: ${parentId}`);
	if (["done", "blocked", "deferred"].includes(parent.status)) throw new Error(`terminal node cannot be expanded: ${parentId}`);
	if (state.profile && (parent.parent_id || parent.kind === "research_leaf")) throw new Error(`deep-research branches may expand only once: ${parentId}`);
	const maximum = state.profile?.max_children ?? 8;
	if (incoming.length < 1 || incoming.length > maximum) throw new Error(`provide 1-${maximum} child nodes`);
	if (childrenOf(state.items, parentId).length > 0) throw new Error(`parent already has children: ${parentId}`);
	const nextChildren: GraphPlanItem[] = incoming.map((item) => {
		const id = item.item_id ?? graphItemId();
		return {
			id, parent_id: parentId, kind: state.profile ? "research_leaf" : "work",
			title: item.title.trim(), note: item.note?.trim() || undefined, status: "pending",
			...(state.profile ? { owner_ref: ownerRef(state.run_id, id) } : {}),
			...(item.budget ? { budget: { allocated: item.budget, used: { searches: 0, reads: 0 } } } : {}),
		};
	});
	const next = { ...state, items: [...state.items, ...nextChildren] };
	const errors = validateGraph(next);
	if (errors.length) throw new Error(errors.join("; "));
	return next;
}

export function graphTerminal(item: GraphPlanItem): boolean {
	return item.status === "done" || item.status === "blocked" || item.status === "deferred";
}

export function settleErrors(state: GraphPlanState, verifiedUrls: ReadonlySet<string>): string[] {
	const errors: string[] = [];
	for (const item of state.items) if (!graphTerminal(item)) errors.push(`open node: ${item.id}`);
	for (const item of state.items) {
		if (item.status === "blocked") errors.push(`blocked node: ${item.id}`);
		if (item.status === "deferred" && !item.defer) errors.push(`unexplained deferral: ${item.id}`);
	}
	if (state.profile) {
		for (const item of state.items) {
			if (item.status === "done" && (!item.coverage?.complete || (item.evidence_gaps?.length ?? 0) > 0)) {
				errors.push(`done research node lacks complete gap-free coverage: ${item.id}`);
			}
			if (item.status === "deferred" && !item.coverage) errors.push(`deferred research node lacks a coverage receipt: ${item.id}`);
		}
		const leads = [...new Set(state.items.flatMap((item) => item.source_leads ?? []))];
		if (verifiedUrls.size < 2) errors.push("deep-research settlement requires at least two parent-verified sources");
		if (verifiedUrls.size > state.profile.validation_reads) errors.push(`parent validation-read budget exceeded: ${verifiedUrls.size}/${state.profile.validation_reads}`);
		for (const url of leads) {
			if (!verifiedUrls.has(url)) errors.push(`delegated source not parent-verified: ${url}`);
		}
	}
	return [...new Set(errors)].slice(0, 16);
}
