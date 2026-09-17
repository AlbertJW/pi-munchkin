import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResearchAggregate, readResearchAggregate, researchAggregatePath, writeResearchAggregate } from "../lib/research-aggregate.ts";
import { ResearchRoundLedger, researchRoundPath, readResearchRoundLedger, validateResearchRoundLedger, mutateParentResearchRoundLedger, type ResearchRoundProposalV1 } from "../lib/research-round.ts";
import { claimIdForText } from "../lib/research-evidence.ts";
import { makeFakePi, callTool, resetPiGlobals } from "./integration-harness.ts";

// ---------------------------------------------------------------------------
// Phase 3B.2 — bounded verification of the aggregate-locked parent ledger
// primitive. The parent transition reads its base from the authoritative
// aggregate (never the compatibility ledger file), commits evidence_round and
// its budget together under the aggregate lock, and publishes the compat ledger
// as a derived output.
// ---------------------------------------------------------------------------

const tmp = () => mkdtempSync(join(tmpdir(), "pi-parent-ledger-verify-"));
const obligation = (claim: string) => ({
	claim_id: claimIdForText(claim), text: claim, required: true, status: "open" as const,
	missing: "evidence", why: "required", next_action: "validate",
});
const proposal = (runId: string, roundId: string, url: string): ResearchRoundProposalV1 => ({
	schema: "pi.research-round/v1", run_id: runId, round_id: roundId,
	selected_gaps: [], queries: [], source_leads: [], reads: [{ url, phase: "discovery", method: "ketch", outcome: "completed", truncated: false, parent_validated: false }],
	evidence_cards: [], conflicts: [], gaps: [], proposed_next_action: "read",
});

async function createAggregate(cwd: string, runId: string, agentDir: string): Promise<{ aggPath: string; ledgerPath: string }> {
	const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
	const aggPath = researchAggregatePath(cwd, runId, env);
	const ledgerPath = researchRoundPath(cwd, runId, env);
	const seed = new ResearchRoundLedger({ run_id: runId, obligations: [obligation("seed claim")], budget: { searches: 3, reads: 5, validation_reads: 5 } });
	const aggregate = createResearchAggregate({ run_id: runId, phase: "active", graph: { run_id: runId, schema_version: 5, items: [] } as any, evidence_round: seed.state, budget: { searches: 0, reads: 0, validation_reads: 0 } });
	await writeResearchAggregate(aggPath, aggregate);
	return { aggPath, ledgerPath };
}

test("a malformed compatibility ledger cannot replace valid aggregate authority (parent)", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { RESEARCH_WORKFLOW: process.env.RESEARCH_WORKFLOW, PLAN_GRAPH: process.env.PLAN_GRAPH, DEEP_RESEARCH_PLANNING: process.env.DEEP_RESEARCH_PLANNING, RESEARCH_LEDGER: process.env.RESEARCH_LEDGER, PLAN_STORAGE: process.env.PLAN_STORAGE, PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	const restore = () => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } };
	Object.assign(process.env, { RESEARCH_WORKFLOW: "parent", PLAN_GRAPH: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_LEDGER: "on", PLAN_STORAGE: "project", PI_CODING_AGENT_DIR: agentDir });
	try {
		const fp = makeFakePi();
		for (const name of ["read", "bash", "edit", "write", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "research_round", "web_search", "web_read", "research_note", "research_finish", "subagent"]) {
			fp.pi.registerTool({ name, parameters: {} } as any);
		}
		await import(`../extensions/plan-runner.ts?malformed-view=${Date.now()}-${Math.random()}`).then((module) => module.default(fp.pi as any));
		fp.pi.setActiveTools([...fp.tools.keys()]);

		const claim = obligation("malformed view claim");
		const started = await callTool(fp, "research_plan_start", {
			request: "Malformed compatibility view", summary: "one branch",
			claim_obligations: [claim],
			branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }],
		}, cwd);
		assert.equal(started.isError, false, "research_plan_start must create the authoritative aggregate, graph and ledger");

		const runId: string = JSON.parse((await import("node:fs")).default.readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8")).run_id;
		const aggPath = researchAggregatePath(cwd, runId, process.env);
		const ledgerPath = researchRoundPath(cwd, runId, process.env);

		const r1 = await callTool(fp, "research_round", { action: "record", round_id: "round-a", reads: [{ url: "https://example.test/source-a", phase: "discovery", method: "ketch", outcome: "completed", truncated: false, parent_validated: false }], proposed_next_action: "read" }, cwd);
		assert.equal(r1.isError, false, "the first research_round record must succeed");
		assert.equal(((await readResearchAggregate(aggPath)) as any).evidence_round.rounds.length, 1, "the aggregate must retain round-a");

		// Malformed compatibility ledger: the parent path must never treat this as
		// the mutation base; the authoritative aggregate stays authoritative.
		writeFileSync(ledgerPath, "not-json-{", "utf8");
		assert.equal(await readResearchRoundLedger(ledgerPath), null, "the compatibility ledger must now be malformed");

		const r2 = await callTool(fp, "research_round", { action: "record", round_id: "round-b", reads: [{ url: "https://example.test/source-b", phase: "discovery", method: "ketch", outcome: "completed", truncated: false, parent_validated: false }], proposed_next_action: "read" }, cwd);
		assert.equal(r2.isError, false, "the second research_round record must succeed from the aggregate authority");

		const agg = await readResearchAggregate(aggPath);
		assert.ok(agg, "the authoritative aggregate must exist");
		const roundIds = (agg.evidence_round as any).rounds.map((item: any) => item.round_id);
		assert.equal((agg.evidence_round as any).rounds.length, 2, "a malformed compatibility ledger must not replace valid aggregate authority");
		assert.equal((agg.evidence_round as any).budget.consumed.reads, 2, "the authoritative aggregate must retain BOTH charged reads");
		assert.ok(roundIds.includes("round-a") && roundIds.includes("round-b"), "both distinct round IDs must be retained in the authoritative aggregate");
		assert.ok(validateResearchRoundLedger(await readResearchRoundLedger(ledgerPath)), "the derived compatibility ledger must be rebuilt as a valid view");
	} finally {
		restore();
		resetPiGlobals();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("a missing aggregate fails closed in parent mode", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-missing";
		const aggPath = researchAggregatePath(cwd, runId, process.env);
		await assert.rejects(
			async () => mutateParentResearchRoundLedger(cwd, runId, (ledger) => { ledger.state; return { state: ledger.state, result: undefined }; }),
			/(missing|malformed)/,
			"a parent ledger transition must fail closed when the authoritative aggregate is absent",
		);
		assert.equal(await readResearchAggregate(aggPath), null, "no aggregate must be created by a failed transition");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("an aggregate whose run_id differs from the requested runId fails closed before the reducer", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-mismatch";
		const { aggPath, ledgerPath } = await createAggregate(cwd, runId, agentDir);
		// Write the fixture AT THE REQUESTED aggregate path, but with the aggregate's
		// own run identity differing from the requested run identity.
		const otherLedger = new ResearchRoundLedger({ run_id: "research-plan-other", obligations: [obligation("mismatch claim")], budget: { searches: 3, reads: 5, validation_reads: 5 } });
		const mismatched = createResearchAggregate({ run_id: "research-plan-other", phase: "active", graph: { run_id: "research-plan-other", schema_version: 5, items: [] } as any, evidence_round: otherLedger.state, budget: { searches: 0, reads: 0, validation_reads: 0 } });
		await writeResearchAggregate(aggPath, mismatched);
		const beforeBytes = readFileSync(aggPath, "utf8");
		const beforeRevision = (await readResearchAggregate(aggPath))!.revision;
		let invoked = false;
		const reducer = (ledger: ResearchRoundLedger) => { invoked = true; return { state: ledger.state, result: undefined }; };
		await assert.rejects(
			async () => mutateParentResearchRoundLedger(cwd, runId, reducer),
			/identity mismatch/,
			"a parent ledger transition must identify an identity mismatch, not missing storage",
		);
		assert.equal(invoked, false, "the reducer callback must never be invoked on an identity mismatch");
		assert.equal(readFileSync(aggPath, "utf8"), beforeBytes, "the authoritative aggregate bytes must remain unchanged");
		assert.equal((await readResearchAggregate(aggPath))!.revision, beforeRevision, "the authoritative aggregate revision must remain unchanged");
		assert.equal(existsSync(ledgerPath), false, "no compatibility view may be published on an identity mismatch");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("an aggregate whose evidence_round run_id differs from its own run_id fails closed before the reducer", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-mismatch";
		const { aggPath, ledgerPath } = await createAggregate(cwd, runId, agentDir);
		// Write the fixture AT THE REQUESTED aggregate path, with the aggregate's own
		// run identity matching the requested run, but its evidence round naming a
		// different run.
		const otherLedger = new ResearchRoundLedger({ run_id: "research-plan-other", obligations: [obligation("evidence mismatch claim")], budget: { searches: 3, reads: 5, validation_reads: 5 } });
		const mismatched = createResearchAggregate({ run_id: runId, phase: "active", graph: { run_id: runId, schema_version: 5, items: [] } as any, evidence_round: otherLedger.state, budget: { searches: 0, reads: 0, validation_reads: 0 } });
		await writeResearchAggregate(aggPath, mismatched);
		const beforeBytes = readFileSync(aggPath, "utf8");
		const beforeRevision = (await readResearchAggregate(aggPath))!.revision;
		let invoked = false;
		const reducer = (ledger: ResearchRoundLedger) => { invoked = true; return { state: ledger.state, result: undefined }; };
		await assert.rejects(
			async () => mutateParentResearchRoundLedger(cwd, runId, reducer),
			/identity mismatch/,
			"a parent ledger transition must identify an identity mismatch, not missing storage",
		);
		assert.equal(invoked, false, "the reducer callback must never be invoked on an evidence-round identity mismatch");
		assert.equal(readFileSync(aggPath, "utf8"), beforeBytes, "the authoritative aggregate bytes must remain unchanged");
		assert.equal((await readResearchAggregate(aggPath))!.revision, beforeRevision, "the authoritative aggregate revision must remain unchanged");
		assert.equal(existsSync(ledgerPath), false, "no compatibility view may be published on an identity mismatch");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("concurrent distinct parent ledger operations retain both updates and charges", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-concurrent";
		const { aggPath } = await createAggregate(cwd, runId, agentDir);
		const opA = async () => mutateParentResearchRoundLedger(cwd, runId, (ledger) => { ledger.recordRound(proposal(runId, "round-a", "https://example.test/source-a")); return { state: ledger.state, result: undefined }; });
		const opB = async () => mutateParentResearchRoundLedger(cwd, runId, (ledger) => { ledger.recordRound(proposal(runId, "round-b", "https://example.test/source-b")); return { state: ledger.state, result: undefined }; });
		await Promise.all([opA(), opB()]);
		const agg = await readResearchAggregate(aggPath);
		assert.ok(agg, "the authoritative aggregate must exist");
		const roundIds = (agg.evidence_round as any).rounds.map((item: any) => item.round_id);
		assert.equal((agg.evidence_round as any).rounds.length, 2, "concurrent distinct operations must retain both rounds");
		assert.equal((agg.evidence_round as any).budget.consumed.reads, 2, "concurrent distinct operations must retain both charged reads");
		assert.ok(roundIds.includes("round-a") && roundIds.includes("round-b"), "both distinct round IDs must be retained");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("a duplicate parent ledger operation is idempotent (no double charge)", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-duplicate";
		const { aggPath } = await createAggregate(cwd, runId, agentDir);
		const p = proposal(runId, "round-x", "https://example.test/source-x");
		await mutateParentResearchRoundLedger(cwd, runId, (ledger) => { ledger.recordRound(p); return { state: ledger.state, result: undefined }; });
		await mutateParentResearchRoundLedger(cwd, runId, (ledger) => { ledger.recordRound(p); return { state: ledger.state, result: undefined }; });
		const agg = await readResearchAggregate(aggPath);
		assert.ok(agg, "the authoritative aggregate must exist");
		assert.equal((agg.evidence_round as any).rounds.length, 1, "a duplicate round must not add a second round");
		assert.equal((agg.evidence_round as any).budget.consumed.reads, 1, "a duplicate round must not double-charge its read");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});
