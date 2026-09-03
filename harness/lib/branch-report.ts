import { PLAN_NOTE_MAX_BYTES, PLAN_TITLE_MAX_BYTES } from "./plan-limits.ts";
import { chmod, mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { addBudget, boundedInteger, budgetWithin, ownerRef, validBudget, validCoverage, validDeferral, type Deferral, type PlanStatus, type ResearchBudget, type RetrievalCoverage } from "./plan-graph.ts";

export const PLAN_CONTEXT_ENV = "PI_MUNCHKIN_PLAN_CONTEXT_PATH";
export const BRANCH_REPORT_ENV = "PI_MUNCHKIN_BRANCH_REPORT_PATH";
export const RESEARCH_SCOUT_ENV = "PI_MUNCHKIN_RESEARCH_SCOUT";
export const RESEARCH_RESERVED_BUDGET_KEY = "__pi_research_reserved_budget";
/** Process-local, safe retrieval observations used to bind branch claims to
 * actual web-tool outcomes. It intentionally contains no query, URL, or page
 * content. The parent process owns the graph; child processes return this
 * bounded summary through the subagent result only. */
export const RESEARCH_COVERAGE_KEY = "__pi_research_coverage_observation_v1";
/** Shared parent-process ledger of scout identities already handed to pi.
 * Branch reports may be revised before dispatch, but once a scout is launched
 * its leaf must remain in every later report so its usage cannot disappear. */
export const RESEARCH_SCOUT_DISPATCHED_KEY = "__pi_research_scout_dispatched_v1";

export type PlanContextV1 = {
	v: 1;
	profile: "deep-research";
	run_id: string;
	parent_item_id: string;
	owner_ref: string;
	depth: 1 | 2;
	budget: ResearchBudget;
	limits: { max_depth: 2; max_children: 0 | 2 };
	/** Parent-issued dispatch credentials. Depth-two scouts never receive them. */
	lease_id?: string;
	dispatch_epoch?: number;
};

export type BranchReportChildV1 = {
	item_id: string;
	title: string;
	note?: string;
	status: PlanStatus;
	budget: { allocated: ResearchBudget; used: ResearchBudget };
	evidence_gaps?: string[];
	coverage?: RetrievalCoverage;
	defer?: Deferral;
};

export type SourceLeadV1 = { url: string; claim: string; quote: string };
export type ScoutReceiptV1 = { owner_ref: string; searches: number; reads: number; coverage?: ResearchCoverageObservation };

export type ResearchCoverageObservation = {
	calls: number;
	returned_count: number;
	incomplete: boolean;
	truncated: boolean;
	failed: boolean;
	budget_exhausted: boolean;
};

export function emptyResearchCoverageObservation(): ResearchCoverageObservation {
	return { calls: 0, returned_count: 0, incomplete: false, truncated: false, failed: false, budget_exhausted: false };
}

export function observeResearchCoverage(
	prior: ResearchCoverageObservation | undefined,
	coverage: RetrievalCoverage,
): ResearchCoverageObservation {
	const current = prior ?? emptyResearchCoverageObservation();
	return {
		calls: current.calls + 1,
		returned_count: current.returned_count + coverage.returned_count,
		incomplete: current.incomplete || !coverage.complete,
		truncated: current.truncated || coverage.truncated,
		failed: current.failed || coverage.failed,
		budget_exhausted: current.budget_exhausted || coverage.budget_exhausted,
	};
}

export function validResearchCoverageObservation(value: unknown): value is ResearchCoverageObservation {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, unknown>;
	return Object.keys(item).length === 6 &&
		boundedInteger(item.calls, 100) && boundedInteger(item.returned_count, 100_000) &&
		typeof item.incomplete === "boolean" && typeof item.truncated === "boolean" &&
		typeof item.failed === "boolean" && typeof item.budget_exhausted === "boolean" &&
		(!item.incomplete || item.truncated || item.failed || item.budget_exhausted);
}

export type BranchReportV1 = {
	v: 1;
	parent_item_id: string;
	owner_ref: string;
	status: PlanStatus;
	note: string;
	consumed: ResearchBudget;
	children: BranchReportChildV1[];
	source_leads: SourceLeadV1[];
	evidence_gaps: string[];
	coverage?: RetrievalCoverage;
	defer?: Deferral;
};

/**
 * A clean transport receipt is not, by itself, evidence. A terminal direct
 * branch must expose at least one usable source lead and a positive retrieval
 * yield; a terminal scout leaf must likewise report a positive yield. A split
 * parent may have no local yield because its children supply the evidence.
 * Blocked/deferred work is allowed to carry zero yield, but cannot masquerade
 * as done.
 */
export function branchEvidenceYieldError(report: Pick<BranchReportV1, "status" | "children" | "source_leads" | "coverage">): string | null {
	for (const child of report.children) {
		if (child.status === "done" && (child.coverage?.returned_count ?? 0) < 1) {
			return `done child ${child.item_id} requires at least one usable source lead (positive retrieval yield)`;
		}
	}
	if (report.status === "done" && report.children.length === 0 &&
		((report.coverage?.returned_count ?? 0) < 1 || report.source_leads.length < 1)) {
		return "a direct done branch requires at least one usable source lead and a positive retrieval yield";
	}
	return null;
}

const ID = /^[A-Za-z0-9._:-]{1,96}$/;
const OWNER = /^[a-f0-9]{24}$/;
const LEASE = /^[A-Za-z0-9._:-]{8,96}$/;
const httpUrl = (value: unknown): value is string => {
	if (typeof value !== "string" || value.length > 1_999) return false;
	try {
		const url = new URL(value);
		return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
	} catch { return false; }
};
const boundedText = (value: unknown, bytes: number): value is string => typeof value === "string" && value.trim().length > 0 && Buffer.byteLength(value, "utf8") <= bytes && !/\r/.test(value);
export function validatePlanContext(value: unknown): value is PlanContextV1 {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, any>;
	return Object.keys(item).every((key) => ["v", "profile", "run_id", "parent_item_id", "owner_ref", "depth", "budget", "limits", "lease_id", "dispatch_epoch"].includes(key)) &&
		item.v === 1 && item.profile === "deep-research" && boundedText(item.run_id, 200) && ID.test(String(item.parent_item_id)) &&
		OWNER.test(String(item.owner_ref)) && (item.depth === 1 || item.depth === 2) && validBudget(item.budget) && item.limits?.max_depth === 2 &&
		Object.keys(item.limits ?? {}).length === 2 && Object.keys(item.limits ?? {}).every((key) => ["max_depth", "max_children"].includes(key)) &&
		((item.depth === 1 && item.limits?.max_children === 2) || (item.depth === 2 && item.limits?.max_children === 0)) &&
		(item.lease_id === undefined || (item.depth === 1 && typeof item.lease_id === "string" && LEASE.test(item.lease_id))) &&
		(item.dispatch_epoch === undefined || (item.depth === 1 && boundedInteger(item.dispatch_epoch, 1_000_000))) &&
		(item.lease_id === undefined || item.dispatch_epoch !== undefined);
}

export function validatePlanContextRole(agentName: string, context: unknown): context is PlanContextV1 | undefined {
	if (agentName === "research-planner") return validatePlanContext(context) && context.depth === 1;
	if (agentName === "research-scout") return validatePlanContext(context) && context.depth === 2;
	return context === undefined;
}

export function validateScoutDispatch(
	currentCount: number,
	requested: Array<{ agent: string; plan_context?: unknown }>,
	dispatchedParents: ReadonlySet<string> = new Set(),
	dispatchedOwners: ReadonlySet<string> = new Set(),
	branchBinding?: PlanContextV1,
	availableBudget?: ResearchBudget,
): boolean {
	if (!boundedInteger(currentCount, 2) || requested.length < 1 || currentCount + requested.length > 2) return false;
	if (!branchBinding || !validatePlanContext(branchBinding as PlanContextV1) || branchBinding.depth !== 1 ||
		branchBinding.owner_ref !== ownerRef(branchBinding.run_id, branchBinding.parent_item_id)) return false;
	// The count alone is not enough: two sequential calls could dispatch the same
	// leaf twice while still staying under the two-leaf ceiling. Validate against
	// the branch's already-dispatched identities as well as duplicates in this
	// request, without mutating the caller's sets on a rejected request.
	const owners = new Set(dispatchedOwners);
	const nodes = new Set(dispatchedParents);
	let allocated: ResearchBudget = { searches: 0, reads: 0 };
	for (const entry of requested) {
		if (entry.agent !== "research-scout" || !validatePlanContext(entry.plan_context) || entry.plan_context.depth !== 2 ||
			entry.plan_context.run_id !== branchBinding.run_id || entry.plan_context.parent_item_id === branchBinding.parent_item_id ||
			entry.plan_context.owner_ref !== ownerRef(entry.plan_context.run_id, entry.plan_context.parent_item_id)) return false;
		if (owners.has(entry.plan_context.owner_ref) || nodes.has(entry.plan_context.parent_item_id)) return false;
		allocated = addBudget(allocated, entry.plan_context.budget);
		if (!budgetWithin(allocated, availableBudget ?? branchBinding.budget)) return false;
		owners.add(entry.plan_context.owner_ref);
		nodes.add(entry.plan_context.parent_item_id);
	}
	return true;
}

export function validateRootResearchDispatch(
	activeRunId: string | undefined,
	dispatchedParents: ReadonlySet<string>,
	dispatchedOwners: ReadonlySet<string>,
	requested: Array<{ agent: string; plan_context?: unknown }>,
	activeBranches?: ReadonlySet<string>,
): boolean {
	if (!activeRunId || requested.length < 1 || requested.length > 3) return false;
	const parents = new Set<string>();
	const owners = new Set<string>();
	for (const entry of requested) {
		if (entry.agent !== "research-planner" || !validatePlanContext(entry.plan_context) || entry.plan_context.depth !== 1 || entry.plan_context.run_id !== activeRunId ||
			entry.plan_context.owner_ref !== ownerRef(entry.plan_context.run_id, entry.plan_context.parent_item_id)) return false;
		if (activeBranches && !activeBranches.has(`${entry.plan_context.run_id}:${entry.plan_context.parent_item_id}:${entry.plan_context.owner_ref}`)) return false;
		if (parents.has(entry.plan_context.parent_item_id) || owners.has(entry.plan_context.owner_ref) ||
			dispatchedParents.has(entry.plan_context.parent_item_id) || dispatchedOwners.has(entry.plan_context.owner_ref)) return false;
		parents.add(entry.plan_context.parent_item_id);
		owners.add(entry.plan_context.owner_ref);
	}
	return true;
}

export function researchUsageFromMessages(messages: unknown): ResearchBudget {
	const usage: ResearchBudget = { searches: 0, reads: 0 };
	if (!Array.isArray(messages)) return usage;
	for (const message of messages) {
		if (!message || typeof message !== "object" || !Array.isArray((message as { content?: unknown }).content)) continue;
		for (const block of (message as { content: unknown[] }).content) {
			if (!block || typeof block !== "object" || (block as { type?: unknown }).type !== "toolCall") continue;
			const name = (block as { name?: unknown }).name;
			if (name === "web_search") usage.searches += 1;
			if (name === "web_read") {
				const args = (block as { arguments?: unknown }).arguments;
				const urls = args && typeof args === "object" && Array.isArray((args as { urls?: unknown }).urls)
					? (args as { urls: unknown[] }).urls.filter((url): url is string => typeof url === "string") : [];
				usage.reads += new Set(urls).size || 1;
			}
		}
	}
	return usage;
}

export function validateBranchReport(value: unknown, context: PlanContextV1, terminal = true): value is BranchReportV1 {
	if (context.depth !== 1) return false;
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const item = value as Record<string, any>;
	if (!Object.keys(item).every((key) => ["v", "parent_item_id", "owner_ref", "status", "note", "consumed", "children", "source_leads", "evidence_gaps", "coverage", "defer"].includes(key))) return false;
	if (item.v !== 1 || item.parent_item_id !== context.parent_item_id || item.owner_ref !== context.owner_ref ||
		!(["pending", "in_progress", "done", "blocked", "deferred"] as unknown[]).includes(item.status) || !boundedText(item.note, 500) || !validBudget(item.consumed) || !budgetWithin(item.consumed, context.budget)) return false;
	if (terminal && !["done", "blocked", "deferred"].includes(item.status)) return false;
	if (item.coverage !== undefined && !validCoverage(item.coverage)) return false;
	if (terminal && !item.coverage) return false;
	if (!Array.isArray(item.children) || item.children.length > context.limits.max_children || !Array.isArray(item.source_leads) || item.source_leads.length > 10 || !Array.isArray(item.evidence_gaps) || item.evidence_gaps.length > 8) return false;
	if (item.status === "deferred" && !validDeferral(item.defer)) return false;
	if (item.status === "done" && (!item.coverage?.complete || item.evidence_gaps.length > 0)) return false;
	if (terminal && item.coverage && !item.coverage.complete && item.evidence_gaps.length === 0) return false;
	const ids = new Set<string>();
	let allocated: ResearchBudget = { searches: 0, reads: 0 };
	let childUsed: ResearchBudget = { searches: 0, reads: 0 };
	for (const child of item.children as Record<string, any>[]) {
		if (!child || !Object.keys(child).every((key) => ["item_id", "title", "note", "status", "budget", "evidence_gaps", "coverage", "defer"].includes(key)) ||
			!ID.test(String(child.item_id)) || ids.has(child.item_id) || !boundedText(child.title, PLAN_TITLE_MAX_BYTES) ||
			!(["pending", "in_progress", "done", "blocked", "deferred"] as unknown[]).includes(child.status) ||
			!child.budget || !validBudget(child.budget.allocated) || !validBudget(child.budget.used) || !budgetWithin(child.budget.used, child.budget.allocated)) return false;
		if (terminal && !["done", "blocked", "deferred"].includes(child.status)) return false;
		if (child.coverage !== undefined && !validCoverage(child.coverage)) return false;
		if (terminal && !child.coverage) return false;
		if (child.status === "deferred" && !validDeferral(child.defer)) return false;
		if (child.note !== undefined && !boundedText(child.note, PLAN_NOTE_MAX_BYTES)) return false;
		if (child.evidence_gaps !== undefined && (!Array.isArray(child.evidence_gaps) || child.evidence_gaps.length > 8 || child.evidence_gaps.some((gap: unknown) => !boundedText(gap, 300)))) return false;
		if (child.status === "done" && (!child.coverage?.complete || (child.evidence_gaps?.length ?? 0) > 0)) return false;
		if (terminal && child.coverage && !child.coverage.complete && (child.evidence_gaps?.length ?? 0) === 0) return false;
		ids.add(child.item_id);
		allocated = { searches: allocated.searches + child.budget.allocated.searches, reads: allocated.reads + child.budget.allocated.reads };
		childUsed = { searches: childUsed.searches + child.budget.used.searches, reads: childUsed.reads + child.budget.used.reads };
	}
	if (!budgetWithin(allocated, context.budget)) return false;
	if (!budgetWithin(childUsed, item.consumed)) return false;
	for (const lead of item.source_leads as Record<string, unknown>[]) if (!lead || !Object.keys(lead).every((key) => ["url", "claim", "quote"].includes(key)) || !httpUrl(lead.url) || !boundedText(lead.claim, 500) || !boundedText(lead.quote, 800)) return false;
	if ((item.evidence_gaps as unknown[]).some((gap) => !boundedText(gap, 300))) return false;
	if (branchEvidenceYieldError(item as BranchReportV1)) return false;
	return boundedInteger(item.consumed.searches, context.budget.searches) && boundedInteger(item.consumed.reads, context.budget.reads);
}

export async function readPlanContext(path: string | undefined): Promise<PlanContextV1 | null> {
	if (!path) return null;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return validatePlanContext(parsed) ? parsed : null;
	} catch { return null; }
}

export async function readBranchReport(path: string | undefined, context: PlanContextV1): Promise<BranchReportV1 | null> {
	if (!path) return null;
	try {
		const parsed = JSON.parse(await readFile(path, "utf8"));
		return validateBranchReport(parsed, context, true) ? parsed : null;
	} catch { return null; }
}

async function syncDirectory(path: string): Promise<void> {
	const handle = await open(path, "r");
	try { await handle.sync(); }
	finally { await handle.close(); }
}

export async function writeBranchReport(path: string, report: BranchReportV1, context: PlanContextV1): Promise<void> {
	if (!validateBranchReport(report, context, false)) throw new Error("branch_report rejected: invalid or over-budget report");
	await mkdir(dirname(path), { recursive: true, mode: 0o700 });
	// mkdir's mode is ignored for an existing directory. Tighten it explicitly
	// before creating the temporary report so a caller cannot place this private
	// artifact in a world-readable pre-existing directory.
	await chmod(dirname(path), 0o700);
	const temporary = `${path}.tmp-${process.pid}-${randomUUID().slice(0, 8)}`;
	let published = false;
	try {
		const handle = await open(temporary, "wx", 0o600);
		try {
			await handle.writeFile(`${JSON.stringify(report)}\n`, "utf8");
			await handle.chmod(0o600);
			await handle.sync();
		} finally { await handle.close(); }
		await rename(temporary, path);
		await chmod(path, 0o600);
		await syncDirectory(dirname(path));
		published = true;
	} finally {
		if (!published) await unlink(temporary).catch(() => undefined);
	}
}
