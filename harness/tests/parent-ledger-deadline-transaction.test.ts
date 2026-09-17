import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResearchAggregate, deadlineFor, deadlinePhase, readResearchAggregate, researchAggregatePath, transitionAggregate, writeResearchAggregate } from "../lib/research-aggregate.ts";
import { ResearchRoundLedger, RESEARCH_SETTLE_ELIGIBLE_PHASES, researchRoundPath, mutateParentResearchRoundLedger, type ResearchRoundProposalV1 } from "../lib/research-round.ts";
import { claimIdForText } from "../lib/research-evidence.ts";

// ---------------------------------------------------------------------------
// Phase 3B.2 closeout — deadline and lifecycle rechecks inside the aggregate
// lock. The caller preflights (phase + deadline) OUTSIDE the lock; these tests
// pin that a lifecycle change or a deadline crossing between preflight and
// transaction is rechecked under the lock, fails closed before the reducer,
// and leaves aggregate revision, evidence, budget and the compatibility view
// unchanged. A legitimate settlement after expiry stays allowed: the deadline
// rule is per-operation, not a blanket rejection.
// ---------------------------------------------------------------------------

const tmp = () => mkdtempSync(join(tmpdir(), "pi-parent-ledger-deadline-"));
const obligation = (claim: string, required = true) => ({
	claim_id: claimIdForText(claim), text: claim, required, status: "open" as const,
	missing: "evidence", why: "required", next_action: "validate",
});
const proposal = (runId: string, roundId: string, url: string): ResearchRoundProposalV1 => ({
	schema: "pi.research-round/v1", run_id: runId, round_id: roundId,
	selected_gaps: [], queries: [], source_leads: [], reads: [{ url, phase: "discovery", method: "ketch", outcome: "completed", truncated: false, parent_validated: false }],
	evidence_cards: [], conflicts: [], gaps: [], proposed_next_action: "read",
});

async function createAggregate(cwd: string, runId: string, agentDir: string, deadline?: ReturnType<typeof deadlineFor>, obligations?: Array<ReturnType<typeof obligation>>): Promise<{ aggPath: string; ledgerPath: string }> {
	const env = { ...process.env, PI_CODING_AGENT_DIR: agentDir };
	const aggPath = researchAggregatePath(cwd, runId, env);
	const ledgerPath = researchRoundPath(cwd, runId, env);
	const seed = new ResearchRoundLedger({ run_id: runId, obligations: obligations ?? [obligation("seed claim")], budget: { searches: 3, reads: 5, validation_reads: 5 } });
	const aggregate = createResearchAggregate({ run_id: runId, phase: "active", graph: { run_id: runId, schema_version: 5, items: [] } as any, evidence_round: seed.state, budget: { searches: 0, reads: 0, validation_reads: 0 }, ...(deadline ? { deadline } : {}) });
	await writeResearchAggregate(aggPath, aggregate);
	return { aggPath, ledgerPath };
}

// The caller-side preflight for `research_round record`: phase active and the
// deadline not yet expired. Mirrors requireActiveParentResearch's decision.
function recordPreflightAllows(aggregate: NonNullable<Awaited<ReturnType<typeof readResearchAggregate>>>): boolean {
	return aggregate.phase === "active" && deadlinePhase(aggregate) !== "expired";
}

test("a lifecycle change between preflight and transaction is rechecked under the lock", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-lifecycle-race";
		const { aggPath, ledgerPath } = await createAggregate(cwd, runId, agentDir);
		const preflight = await readResearchAggregate(aggPath);
		assert.ok(preflight && recordPreflightAllows(preflight), "the caller preflight must pass before the race");

		// A pause lands between preflight and the locked transaction.
		const paused = transitionAggregate(preflight, { phase: "paused" });
		await writeResearchAggregate(aggPath, paused);

		let invoked = false;
		await assert.rejects(
			async () => mutateParentResearchRoundLedger(cwd, runId, (ledger) => { invoked = true; ledger.recordRound(proposal(runId, "round-race", "https://example.test/race")); return { state: ledger.state, result: undefined }; }),
			/not eligible \(phase: paused\)/,
			"a paused aggregate must be refused under the lock even when the preflight saw active",
		);
		assert.equal(invoked, false, "the reducer must never run on a rejected transition");
		assert.deepEqual(await readResearchAggregate(aggPath), paused, "revision, evidence and budget must be unchanged by the rejection");
		assert.equal(existsSync(ledgerPath), false, "a rejected transition must not publish the compatibility view");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("a deadline crossing between preflight and transaction is rechecked under the lock", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-deadline-race";
		const { aggPath, ledgerPath } = await createAggregate(cwd, runId, agentDir, deadlineFor());
		const preflight = await readResearchAggregate(aggPath);
		assert.ok(preflight && recordPreflightAllows(preflight), "the caller preflight must pass before the crossing");

		// Wall clock crosses the discovery boundary between preflight and the
		// locked transaction: the same aggregate now reports expired.
		const expired = transitionAggregate(preflight, { deadline: { ...preflight.deadline!, deadline_at: new Date(Date.now() - 60_000).toISOString(), discovery_deadline_at: new Date(Date.now() - 60_000).toISOString() } });
		assert.equal(deadlinePhase(expired), "expired", "the simulated crossing must read as expired");
		await writeResearchAggregate(aggPath, expired);

		let invoked = false;
		await assert.rejects(
			async () => mutateParentResearchRoundLedger(cwd, runId, (ledger) => { invoked = true; ledger.recordRound(proposal(runId, "round-deadline", "https://example.test/deadline")); return { state: ledger.state, result: undefined }; }, ["active"], { rejectExpired: true }),
			/expired/,
			"an expired aggregate must refuse a record under the lock even when the preflight saw discovery",
		);
		assert.equal(invoked, false, "the reducer must never run on a rejected transition");
		assert.deepEqual(await readResearchAggregate(aggPath), expired, "revision, evidence and budget must be unchanged by the rejection");
		assert.equal(existsSync(ledgerPath), false, "a rejected transition must not publish the compatibility view");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});

test("a legitimate settlement after expiry stays allowed (no blanket deadline rejection)", async () => {
	const cwd = tmp();
	const agentDir = tmp();
	const previous = { PI_CODING_AGENT_DIR: process.env.PI_CODING_AGENT_DIR };
	Object.assign(process.env, { PI_CODING_AGENT_DIR: agentDir });
	try {
		const runId = "research-plan-settle-expired";
		const base = deadlineFor();
		const { aggPath } = await createAggregate(cwd, runId, agentDir, { ...base, deadline_at: new Date(Date.now() - 60_000).toISOString(), discovery_deadline_at: new Date(Date.now() - 60_000).toISOString() }, [obligation("optional claim", false)]);
		const expired = await readResearchAggregate(aggPath);
		assert.ok(expired && deadlinePhase(expired) === "expired" && expired.phase === "active", "the aggregate must start expired but active");

		const settled = await mutateParentResearchRoundLedger(cwd, runId, (latest) => {
			const state = latest.settle({ graph_terminal: true, optional_deferrals: [{ claim_id: claimIdForText("optional claim"), value: "not material", risk: "low", rationale: "out of scope" }], reason: "Expired run finishing with evidence complete." });
			return { state, summary: state.status };
		}, RESEARCH_SETTLE_ELIGIBLE_PHASES);
		assert.equal(settled.summary, "settled", "settlement must succeed after the deadline has crossed");

		const after = await readResearchAggregate(aggPath);
		assert.ok(after, "the aggregate must exist");
		assert.equal(after.phase, "settled", "the aggregate phase must advance to settled");
		assert.equal((after.evidence_round as { status?: string }).status, "settled", "the evidence round must be settled");
		assert.ok(after.deadline, "the deadline record must be preserved");
	} finally {
		if (previous.PI_CODING_AGENT_DIR === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = previous.PI_CODING_AGENT_DIR;
		rmSync(cwd, { recursive: true, force: true });
		rmSync(agentDir, { recursive: true, force: true });
	}
});
