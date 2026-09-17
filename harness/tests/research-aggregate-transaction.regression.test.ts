import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readResearchAggregate, researchAggregatePath } from "../lib/research-aggregate.ts";
import { researchRoundPath, readResearchRoundLedger, writeResearchRoundLedger, validateResearchRoundLedger } from "../lib/research-round.ts";
import { makeFakePi, callTool, resetPiGlobals } from "./integration-harness.ts";
import { claimIdForText } from "../lib/research-evidence.ts";

// ---------------------------------------------------------------------------
// Phase 3B.2 — interrupted compatibility-publication regression (production path).
//
// Defect under test (stale compatibility input overwrites newer aggregate
// state): in the parent-owned workflow the AUTHORITATIVE aggregate is the sole
// authority for a research transition, and the compatibility graph/ledger files
// are rebuildable views. A real `research_round` record drives the production
// projection callers. The parent ledger transition MUST start from the
// aggregate's evidence_round (the authority); it must never read the
// compatibility ledger file as the mutation base, and an interrupted
// compatibility publication must not drive the next round.
//
// This test drives the REAL registered tools (research_plan_start, research_round
// record) and the REAL production projection callers; it never calls
// mutateResearchAggregate with a hand-built patch. It restores ONLY the
// compatibility ledger to its earlier valid snapshot (L0), leaves the aggregate
// unchanged, and asserts the authoritative aggregate retains BOTH committed
// rounds and BOTH charged reads. Distinct round IDs and source identities keep
// deduplication from being the cause.
//
// Cleanup: environment, module import and creation all live inside the
// try/finally, so a setup failure restores env and process globals and deletes
// the disposable cwd + agent storage. PI_CODING_AGENT_DIR is a disposable dir
// even if it was already set, so no real agent storage is touched.
// ---------------------------------------------------------------------------

const tmp = () => mkdtempSync(join(tmpdir(), "pi-research-parent-ledger-"));

test("an interrupted compatibility-ledger publication must not let a stale ledger drive the next round", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = {
		RESEARCH_WORKFLOW: process.env.RESEARCH_WORKFLOW,
		PLAN_GRAPH: process.env.PLAN_GRAPH,
		DEEP_RESEARCH_PLANNING: process.env.DEEP_RESEARCH_PLANNING,
		RESEARCH_LEDGER: process.env.RESEARCH_LEDGER,
		PLAN_STORAGE: process.env.PLAN_STORAGE,
		PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR,
	};
	const restore = () => {
		for (const [key, value] of Object.entries(previous)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	};
	Object.assign(process.env, {
		RESEARCH_WORKFLOW: "parent",
		PLAN_GRAPH: "on",
		DEEP_RESEARCH_PLANNING: "on",
		RESEARCH_LEDGER: "on",
		PLAN_STORAGE: "project",
		PI_CODING_AGENT_DIR: agentDir,
	});

	const claim = claimIdForText("interrupted view claim");
	try {
		const fp = makeFakePi();
		for (const name of ["read", "bash", "edit", "write", "capability", "plan_write", "plan_update", "plan_expand", "plan_settle", "research_plan_start", "research_round", "web_search", "web_read", "research_note", "research_finish", "subagent"]) {
			fp.pi.registerTool({ name, parameters: {} } as any);
		}
		await import(`../extensions/plan-runner.ts?parent-ledger=${Date.now()}-${Math.random()}`).then((module) => module.default(fp.pi as any));
		fp.pi.setActiveTools([...fp.tools.keys()]);

		const started = await callTool(fp, "research_plan_start", {
			request: "Interrupted compatibility publication", summary: "one branch",
			claim_obligations: [{ claim_id: claim, text: "interrupted view claim", required: true, missing: "evidence", why: "required", next_action: "validate" }],
			branches: [{ title: "Evidence", budget: { searches: 1, reads: 1 } }],
		}, cwd);
		assert.equal(started.isError, false, "research_plan_start must create the authoritative aggregate, graph and ledger");

		const runId: string = JSON.parse(readFileSync(join(cwd, ".pi", "plan-state.json"), "utf8")).run_id;
		const aggPath = researchAggregatePath(cwd, runId, process.env);
		const ledgerPath = researchRoundPath(cwd, runId, process.env);

		const agg0 = await readResearchAggregate(aggPath);
		assert.ok(agg0, "the authoritative aggregate must exist after creation");
		const L0 = agg0.evidence_round as any;
		assert.equal(L0.rounds.length, 0, "the initial ledger snapshot must carry no rounds");
		assert.equal(L0.budget.consumed.reads, 0, "the initial ledger snapshot must have no charged reads");
		assert.ok(validateResearchRoundLedger(L0), "the initial ledger snapshot must be a valid authoritative ledger");

		// Round 1 — a real record through the registered tool.
		const r1 = await callTool(fp, "research_round", {
			action: "record", round_id: "round-a",
			reads: [{ url: "https://example.test/source-a", phase: "discovery", method: "ketch", outcome: "completed", truncated: false, parent_validated: false }],
			proposed_next_action: "read",
		}, cwd);
		assert.equal(r1.isError, false, "the first research_round record must succeed");
		const agg1 = await readResearchAggregate(aggPath);
		assert.ok(agg1, "the authoritative aggregate must exist");
		const r1Ids = (agg1.evidence_round as any).rounds.map((item: any) => item.round_id);
		assert.ok(r1Ids.includes("round-a"), "the aggregate must retain the committed first round");
		assert.equal((agg1.evidence_round as any).rounds.length, 1, "the aggregate must contain exactly one committed round after record 1");
		assert.equal((agg1.evidence_round as any).budget.consumed.reads, 1, "the aggregate must retain the first round's charged discovery read");

		// Interrupted compatibility publication: restore ONLY the compatibility
		// ledger to its earlier valid snapshot (L0). The aggregate stays at L1.
		await writeResearchRoundLedger(ledgerPath, L0);
		const restored = await readResearchRoundLedger(ledgerPath);
		assert.equal(restored!.rounds.length, 0, "the compatibility ledger must now be the stale L0 snapshot");
		assert.equal(((await readResearchAggregate(aggPath)) as any).evidence_round.rounds.length, 1, "the aggregate must remain authoritative L1, unchanged");

		// Round 2 — a distinct record (distinct round_id + source identity).
		const r2 = await callTool(fp, "research_round", {
			action: "record", round_id: "round-b",
			reads: [{ url: "https://example.test/source-b", phase: "discovery", method: "ketch", outcome: "completed", truncated: false, parent_validated: false }],
			proposed_next_action: "read",
		}, cwd);
		assert.equal(r2.isError, false, "the second research_round record must succeed");

		const agg2 = await readResearchAggregate(aggPath);
		assert.ok(agg2, "the authoritative aggregate must exist");
		const rounds = (agg2.evidence_round as any).rounds;
		const roundIds = rounds.map((item: any) => item.round_id);

		// CORRECT behaviour: the authoritative aggregate must retain BOTH committed
		// rounds and BOTH charged reads. The ledger transition must start from the
		// aggregate, so the stale compatibility L0 never drives the next round.
		assert.equal(rounds.length, 2, "the authoritative aggregate must retain BOTH committed rounds; a stale compatibility-ledger read must not drive the next ledger transition");
		assert.equal((agg2.evidence_round as any).budget.consumed.reads, 2, "the authoritative aggregate must retain BOTH charged discovery reads");
		assert.ok(roundIds.includes("round-a") && roundIds.includes("round-b"), "both distinct round IDs must be present in the authoritative aggregate");
		assert.equal(agg2.graph.run_id, runId, "the authoritative aggregate must preserve run identity");
	} finally {
		restore();
		resetPiGlobals();
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});
