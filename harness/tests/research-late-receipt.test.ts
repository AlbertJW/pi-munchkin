import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResearchAggregate, deadlineFor, readResearchAggregate, researchAggregatePath, writeResearchAggregate } from "../lib/research-aggregate.ts";
import { readResearchRoundLedger, researchRoundPath, ResearchRoundLedger } from "../lib/research-round.ts";
import { callTool, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

function restoreEnv(snapshot: Record<string, string | undefined>): void {
	for (const [key, value] of Object.entries(snapshot)) {
		if (value === undefined) delete process.env[key];
		else process.env[key] = value;
	}
}

/** A production-shaped evidence round: the aggregate always carries a full
 * validated ledger state, never a bare run identity. */
function ledgerState(runId: string) {
	return new ResearchRoundLedger({
		run_id: runId,
		obligations: [{ claim_id: "c1", text: "A bounded claim.", required: true, status: "open", missing: "evidence", why: "the claim needs a source", next_action: "search" }],
		budget: { searches: 3, reads: 5, validation_reads: 5 },
	}).state;
}

/** Mock ketch whose `search` blocks on a synchronization barrier file until the
 * test releases it. This models a retrieval that is authorized before the
 * deadline and completes after it, with no sleep in the test itself. */
function barrierKetch(dir: string, barrier: string): string {
	const file = join(dir, "ketch-barrier-mock");
	writeFileSync(file, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  search)
    mkdir -p "$KETCH_BARRIER"
    printf 'started\\n' > "$KETCH_BARRIER/started"
    while [ ! -f "$KETCH_BARRIER/proceed" ]; do :; done
    printf '[{"title":"Primary result","url":"https://example.com/a","description":"bounded snippet"}]\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(file, 0o755);
	return file;
}

async function waitFor(file: string, timeoutMs = 10_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (!existsSync(file)) {
		if (Date.now() > deadline) throw new Error(`barrier timed out waiting for ${file}`);
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

test("a search authorized before the deadline records its receipt durably when it completes after the deadline", async () => {
	const dir = mkdtempSync(join(tmpdir(), "late-receipt-"));
	const barrier = join(dir, "barrier");
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "KETCH_BARRIER", "RESEARCH_LEDGER", "DEEP_RESEARCH_PLANNING", "RESEARCH_WORKFLOW", "PI_CODING_AGENT_DIR", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		Object.assign(process.env, { KETCH_BIN: barrierKetch(dir, barrier), KETCH_BACKEND: "exa", KETCH_BARRIER: barrier, RESEARCH_LEDGER: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_WORKFLOW: "parent", PI_CODING_AGENT_DIR: join(dir, "agent"), TELEMETRY: "off" });
		const runId = "late-run";
		const aggregatePath = researchAggregatePath(dir, runId, process.env);
		await writeResearchAggregate(aggregatePath, createResearchAggregate({ run_id: runId, phase: "active", graph: { run_id: runId }, evidence_round: ledgerState(runId), budget: { searches: 3, reads: 5, validation_reads: 5 }, deadline: deadlineFor(Date.now()) }));
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?late-receipt=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: runId, profile: "deep-research", settled: false };
		const tool = fp.tools.get("web_search")!;
		const ctx = { cwd: dir, model: { provider: "test-provider", id: "test-model" } };
		// Authorize before expiry; the mock blocks on the barrier while pending.
		const pending = tool.execute("tc-late-1", { query: "late receipt query" }, undefined, undefined, ctx as never);
		await waitFor(join(barrier, "started"));
		// Cross the deadline while the retrieval is pending (controlled state
		// rewrite, not a sleep): the run is now expired but still active.
		const current = (await readResearchAggregate(aggregatePath))!;
		const past = new Date(Date.now() - 1_000).toISOString();
		await writeResearchAggregate(aggregatePath, { ...current, deadline: { ...current.deadline!, deadline_at: past, discovery_deadline_at: past } });
		// Complete the authorized retrieval.
		writeFileSync(join(barrier, "proceed"), "go\n");
		const result = await pending;
		assert.equal(result.details.result_count, 1, "the authorized retrieval must still return its result");
		assert.equal(result.details.coverage.complete, true);
		// Durable accounting: the outcome of authorized work survives in the
		// authoritative aggregate even though the deadline crossed mid-flight.
		const after = (await readResearchAggregate(aggregatePath))!;
		const receipts = (after.evidence_round as { search_receipts?: Array<{ receipt_id: string; charged: boolean; outcome: string }> }).search_receipts ?? [];
		assert.equal(receipts.length, 1, "the late receipt must be recorded durably");
		assert.equal(receipts[0].outcome, "completed");
		assert.equal(receipts[0].charged, true);
		assert.equal((after.evidence_round as { budget: { consumed: { searches: number } } }).budget.consumed.searches, 1, "the search must be charged exactly once");
		assert.equal(after.phase, "active", "recording an authorized outcome is not a lifecycle boundary");
		// The compatibility view is published from the committed aggregate.
		const view = await readResearchRoundLedger(researchRoundPath(dir, runId, process.env));
		assert.equal(view?.budget.consumed.searches, 1);
		// Replay of the same completion: the run has now crossed its boundary,
		// so the replay is refused and cannot double-charge.
		const replay = await tool.execute("tc-late-1", { query: "late receipt query" }, undefined, undefined, ctx as never);
		assert.equal(replay.details.outcome, "awaiting_extension");
		const afterReplay = (await readResearchAggregate(aggregatePath))!;
		assert.equal((afterReplay.evidence_round as { budget: { consumed: { searches: number } } }).budget.consumed.searches, 1, "a replayed completion must not double-charge");
		assert.equal(afterReplay.phase, "awaiting_extension");
		// A genuinely new request after expiry is refused.
		const fresh = await tool.execute("tc-late-2", { query: "a genuinely new query" }, undefined, undefined, ctx as never);
		assert.equal(fresh.details.outcome, "awaiting_extension");
		const afterFresh = (await readResearchAggregate(aggregatePath))!;
		assert.equal((afterFresh.evidence_round as { budget: { consumed: { searches: number } } }).budget.consumed.searches, 1);
		assert.equal(afterFresh.phase, "awaiting_extension");
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		resetPiGlobals();
	}
});

test("a late completion cannot reactivate a paused or terminal run", async () => {
	const dir = mkdtempSync(join(tmpdir(), "late-receipt-paused-"));
	const snapshot = Object.fromEntries(["KETCH", "KETCH_BIN", "KETCH_BACKEND", "RESEARCH_LEDGER", "DEEP_RESEARCH_PLANNING", "RESEARCH_WORKFLOW", "PI_CODING_AGENT_DIR", "TELEMETRY"].map((key) => [key, process.env[key]]));
	try {
		delete process.env.KETCH;
		Object.assign(process.env, { KETCH_BIN: barrierKetch(dir, join(dir, "barrier")), KETCH_BACKEND: "exa", RESEARCH_LEDGER: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_WORKFLOW: "parent", PI_CODING_AGENT_DIR: join(dir, "agent"), TELEMETRY: "off" });
		const fp = makeFakePi();
		const mod = await import(`../extensions/ketch.ts?late-receipt-paused=${Date.now()}-${Math.random()}`);
		mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
		await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
		for (const phase of ["paused", "settled"] as const) {
			const runId = `late-${phase}`;
			const aggregatePath = researchAggregatePath(dir, runId, process.env);
			await writeResearchAggregate(aggregatePath, createResearchAggregate({ run_id: runId, phase, graph: { run_id: runId }, evidence_round: ledgerState(runId), budget: { searches: 3, reads: 5, validation_reads: 5 }, deadline: deadlineFor(Date.now()) }));
			(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: runId, profile: "deep-research", settled: phase === "settled" };
			const result = await callTool(fp, "web_search", { query: `late completion into ${phase}` }, dir);
			assert.equal(result.details.outcome, phase, `a ${phase} run must refuse new retrieval`);
			const after = (await readResearchAggregate(aggregatePath))!;
			assert.equal(after.phase, phase, `a late completion must not reactivate a ${phase} run`);
			assert.equal((after.evidence_round as { budget?: { consumed?: { searches?: number } } }).budget?.consumed?.searches ?? 0, 0);
		}
	} finally {
		restoreEnv(snapshot);
		rmSync(dir, { recursive: true, force: true });
		delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
		delete (globalThis as Record<string, unknown>).__pi_research_state;
		resetPiGlobals();
	}
});
