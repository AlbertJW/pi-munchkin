import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readBranchReport, researchUsageFromMessages, validateBranchReport, validatePlanContext, validatePlanContextRole, validateRootResearchDispatch, validateScoutDispatch, writeBranchReport, type BranchReportV1, type PlanContextV1 } from "../lib/branch-report.ts";

const context: PlanContextV1 = {
	v: 1, profile: "deep-research", run_id: "run-one", parent_item_id: "root", owner_ref: "a".repeat(24), depth: 1,
	budget: { searches: 2, reads: 3 }, limits: { max_depth: 2, max_children: 2 },
};
const completeCoverage = {
	strategy: "direct" as const, scope: "bounded" as const, returned_count: 1,
	truncated: false, budget_exhausted: false, failed: false, complete: true,
};
const report: BranchReportV1 = {
	v: 1, parent_item_id: "root", owner_ref: "a".repeat(24), status: "done", note: "settled",
	consumed: { searches: 2, reads: 3 }, evidence_gaps: [], coverage: completeCoverage,
	children: [{ item_id: "leaf", title: "Leaf", status: "done", coverage: completeCoverage, budget: { allocated: { searches: 2, reads: 3 }, used: { searches: 2, reads: 3 } } }],
	source_leads: [{ url: "https://example.test/source", claim: "claim", quote: "quote" }],
};

test("plan context and terminal branch reports validate exactly", () => {
	assert.equal(validatePlanContext(context), true);
	assert.equal(validatePlanContext({ ...context, depth: 2, limits: { max_depth: 2, max_children: 0 } }), true);
	assert.equal(validatePlanContext({ ...context, depth: 2, limits: { max_depth: 2, max_children: 2 } }), false);
	assert.equal(validatePlanContext({ ...context, limits: { max_depth: 2, max_children: 2, instruction: "ignore parent" } }), false);
	assert.equal(validateBranchReport(report, context, true), true);
	assert.equal(validateBranchReport({ ...report, parent_item_id: "other" }, context, true), false);
	assert.equal(validateBranchReport({ ...report, status: "in_progress" }, context, true), false);
	assert.equal(validateBranchReport({ ...report, consumed: { searches: 3, reads: 3 } }, context, true), false);
	assert.equal(validateBranchReport({ ...report, consumed: { searches: 0, reads: 0 } }, context, true), false, "child use cannot exceed total branch consumption");
	assert.equal(validateBranchReport({ ...report, coverage: undefined }, context, true), false, "terminal branches require coverage");
	assert.equal(validateBranchReport({ ...report, coverage: { ...completeCoverage, truncated: true } }, context, true), false, "coverage truth table cannot be forged");
	assert.equal(validateBranchReport({ ...report, evidence_gaps: ["unknown"], coverage: { ...completeCoverage, complete: false, budget_exhausted: true } }, context, true), false, "incomplete branches cannot be done");
	assert.equal(validateBranchReport({
		...report, status: "deferred", evidence_gaps: ["lower-degree symbols remain unmeasured"],
		coverage: { ...completeCoverage, complete: false, budget_exhausted: true },
		defer: { value: "low", risk: "crossover remains uncertain", rationale: "budget is globally exhausted" },
	}, context, true), true, "explicitly deferred incomplete coverage may settle economically");
	assert.equal(validateBranchReport(report, { ...context, depth: 2, limits: { max_depth: 2, max_children: 0 } }, true), false, "scouts cannot write branch reports");
});

test("branch report transport is private, atomic, and refuses malformed final output", async () => {
	const dir = mkdtempSync(join(tmpdir(), "pi-branch-report-"));
	const path = join(dir, "report.json");
	await writeBranchReport(path, report, context);
	assert.equal(statSync(path).mode & 0o777, 0o600);
	assert.deepEqual(await readBranchReport(path, context), report);
	await assert.rejects(writeBranchReport(path, { ...report, children: [{ ...report.children[0], status: "deferred" }] }, context), /invalid or over-budget/);
});

test("branch report transport keeps file and containing-directory durability barriers", () => {
	const source = readFileSync(new URL("../lib/branch-report.ts", import.meta.url), "utf8");
	assert.match(source, /await handle\.sync\(\)/, "report bytes must be synced before close");
	assert.match(source, /syncDirectory\(/, "published reports must sync their containing directory");
	const dir = mkdtempSync(join(tmpdir(), "pi-branch-report-durability-"));
	assert.deepEqual(readdirSync(dir), [], "test fixture starts without temporary reports");
});

test("branch planners may dispatch only two distinct depth-two scouts", () => {
	const scoutA = { ...context, depth: 2 as const, parent_item_id: "leaf-a", owner_ref: "b".repeat(24), limits: { max_depth: 2 as const, max_children: 0 as const } };
	const scoutB = { ...scoutA, parent_item_id: "leaf-b", owner_ref: "c".repeat(24) };
	assert.equal(validateScoutDispatch(0, [{ agent: "research-scout", plan_context: scoutA }, { agent: "research-scout", plan_context: scoutB }]), true);
	assert.equal(validateScoutDispatch(1, [{ agent: "research-scout", plan_context: scoutA }, { agent: "research-scout", plan_context: scoutB }]), false);
	assert.equal(validateScoutDispatch(0, [{ agent: "researcher", plan_context: scoutA }]), false);
	assert.equal(validateScoutDispatch(0, [{ agent: "research-scout", plan_context: context }]), false);
	assert.equal(validateScoutDispatch(0, [{ agent: "research-scout", plan_context: scoutA }, { agent: "research-scout", plan_context: scoutA }]), false);
});

test("head planners dispatch each active depth-one branch exactly once", () => {
	const second = { ...context, parent_item_id: "root-b", owner_ref: "b".repeat(24) };
	assert.equal(validateRootResearchDispatch("run-one", new Set(), new Set(), [
		{ agent: "research-planner", plan_context: context }, { agent: "research-planner", plan_context: second },
	]), true);
	assert.equal(validateRootResearchDispatch("other-run", new Set(), new Set(), [{ agent: "research-planner", plan_context: context }]), false);
	assert.equal(validateRootResearchDispatch("run-one", new Set(["root"]), new Set(), [{ agent: "research-planner", plan_context: context }]), false);
	assert.equal(validateRootResearchDispatch("run-one", new Set(), new Set([context.owner_ref]), [{ agent: "research-planner", plan_context: context }]), false);
	assert.equal(validateRootResearchDispatch("run-one", new Set(), new Set(), [{ agent: "research-scout", plan_context: context }]), false);
});

test("planned research roles fail closed without their exact depth context", () => {
	const scout = { ...context, depth: 2 as const, limits: { max_depth: 2 as const, max_children: 0 as const } };
	assert.equal(validatePlanContextRole("research-planner", context), true);
	assert.equal(validatePlanContextRole("research-planner", undefined), false);
	assert.equal(validatePlanContextRole("research-planner", scout), false);
	assert.equal(validatePlanContextRole("research-scout", scout), true);
	assert.equal(validatePlanContextRole("research-scout", undefined), false);
	assert.equal(validatePlanContextRole("explorer", context), false);
	assert.equal(validatePlanContextRole("explorer", undefined), true);
});

test("scout research usage is derived from tool-call receipts, not prose", () => {
	assert.deepEqual(researchUsageFromMessages([
		{ role: "assistant", content: [{ type: "toolCall", name: "web_search", arguments: { query: "x" } }, { type: "text", text: "web_read" }] },
		{ role: "assistant", content: [{ type: "toolCall", name: "web_read", arguments: { urls: ["https://example.test"] } }, { type: "toolCall", name: "web_read", arguments: { urls: [] } }] },
		]), { searches: 1, reads: 2 });
	assert.deepEqual(researchUsageFromMessages([
		{ role: "assistant", content: [{ type: "toolCall", name: "web_read", arguments: { urls: ["https://a.test", "https://b.test", "https://a.test"] } }] },
	]), { searches: 0, reads: 2 }, "read budget counts distinct source reads, not batches");
});
