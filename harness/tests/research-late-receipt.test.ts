import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createResearchAggregate, deadlineFor, mutateResearchAggregate, readResearchAggregate, researchAggregatePath, transitionAggregate, writeResearchAggregate } from "../lib/research-aggregate.ts";
import { readResearchRoundLedger, recordAuthorizedSearchReceipt, researchRoundPath, ResearchRoundLedger, type SearchReceiptV1 } from "../lib/research-round.ts";
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
/** Same barrier mock, plus an invocation counter and a `scrape` arm so the
 * web_read path can be held at the same deterministic barrier. */
function barrierKetchCounting(dir: string, barrier: string): string {
	const file = join(dir, "ketch-barrier-counting");
	writeFileSync(file, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  search)
    mkdir -p "$KETCH_BARRIER"
    printf 'started\\n' > "$KETCH_BARRIER/started"
    while [ ! -f "$KETCH_BARRIER/proceed" ]; do :; done
    printf 'x\\n' >> "$KETCH_BARRIER/invocations"
    printf '[{"title":"Primary result","url":"https://example.com/a","description":"bounded snippet"}]\\n' ;;
  scrape)
    mkdir -p "$KETCH_BARRIER"
    printf 'started\\n' > "$KETCH_BARRIER/started"
    while [ ! -f "$KETCH_BARRIER/proceed" ]; do :; done
    printf 'x\\n' >> "$KETCH_BARRIER/invocations"
    printf '[{"url":"https://example.com/a","title":"Primary result","markdown":"bounded page text","truncated":false}]\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(file, 0o755);
	return file;
}

const ENV_KEYS = ["KETCH", "KETCH_BIN", "KETCH_BACKEND", "KETCH_BARRIER", "RESEARCH_LEDGER", "DEEP_RESEARCH_PLANNING", "RESEARCH_WORKFLOW", "PI_CODING_AGENT_DIR", "TELEMETRY"];

/** Register ketch against a temp agent dir with a barrier mock and an
 * aggregate for `runId` in `phase`, with the global run context set to it. */
async function setupBarrierRun(runId: string, phase: "active" | "paused" | "awaiting_extension" | "blocked" | "settled", tag: string, counting = true) {
	const dir = mkdtempSync(join(tmpdir(), `late-receipt-${tag}-`));
	const barrier = join(dir, "barrier");
	const snapshot = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
	delete process.env.KETCH;
	Object.assign(process.env, { KETCH_BIN: counting ? barrierKetchCounting(dir, barrier) : barrierKetch(dir, barrier), KETCH_BACKEND: "exa", KETCH_BARRIER: barrier, RESEARCH_LEDGER: "on", DEEP_RESEARCH_PLANNING: "on", RESEARCH_WORKFLOW: "parent", PI_CODING_AGENT_DIR: join(dir, "agent"), TELEMETRY: "off" });
	const aggregatePath = researchAggregatePath(dir, runId, process.env);
	await writeResearchAggregate(aggregatePath, createResearchAggregate({ run_id: runId, phase, graph: { run_id: runId }, evidence_round: ledgerState(runId), budget: { searches: 3, reads: 5, validation_reads: 5 }, deadline: deadlineFor(Date.now()) }));
	const fp = makeFakePi();
	const mod = await import(`../extensions/ketch.ts?${tag}=${Date.now()}-${Math.random()}`);
	mod.registerKetch(fp.pi as never, { resolvePublicUrl: async (raw: string) => new URL(raw).toString() });
	await fp.handlers.get("session_start")?.[0]?.({}, { cwd: dir, ui: { notify() {} } });
	(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: runId, profile: "deep-research", settled: phase === "settled" };
	const ctx = { cwd: dir, model: { provider: "test-provider", id: "test-model" } };
	return { dir, barrier, snapshot, aggregatePath, fp, ctx, runId };
}

function teardownRun(snapshot: Record<string, string | undefined>, dir: string): void {
	restoreEnv(snapshot);
	rmSync(dir, { recursive: true, force: true });
	delete (globalThis as Record<string, unknown>).__pi_active_plan_context;
	delete (globalThis as Record<string, unknown>).__pi_research_state;
	resetPiGlobals();
}

function searchReceipts(state: { evidence_round: Record<string, unknown> }): SearchReceiptV1[] {
	return ((state.evidence_round as { search_receipts?: SearchReceiptV1[] }).search_receipts ?? []);
}

function consumedSearches(state: { evidence_round: Record<string, unknown> }): number {
	return (state.evidence_round as { budget?: { consumed?: { searches?: number } } }).budget?.consumed?.searches ?? 0;
}

/** The aggregate transaction the deadline boundary itself uses. */
async function transitionRun(aggregatePath: string, phase: "active" | "paused" | "awaiting_extension" | "blocked" | "settled"): Promise<void> {
	await mutateResearchAggregate(aggregatePath, (state) => ({ state: transitionAggregate(state, { phase }), result: undefined }));
}

test("a search authorized before a pause keeps its durable accounting when it completes after the pause", async () => {
	const { dir, barrier, snapshot, aggregatePath, fp, ctx, runId } = await setupBarrierRun("pause-run", "active", "pause");
	try {
		const tool = fp.tools.get("web_search")!;
		// Authorize before the lifecycle change; the mock blocks on the barrier.
		const pending = tool.execute("tc-pause-1", { query: "authorized before pause" }, undefined, undefined, ctx as never);
		await waitFor(join(barrier, "started"));
		await transitionRun(aggregatePath, "paused");
		// Complete the authorized retrieval.
		writeFileSync(join(barrier, "proceed"), "go\n");
		const result = await pending;
		assert.equal(result.details.result_count, 1, "the authorized retrieval must still return its result");
		const after = (await readResearchAggregate(aggregatePath))!;
		const receipts = searchReceipts(after);
		assert.equal(receipts.length, 1, "the outcome of authorized work must be recorded durably across the pause");
		assert.equal(receipts[0].outcome, "completed");
		assert.equal(receipts[0].charged, true);
		assert.equal(consumedSearches(after), 1, "the search must be charged exactly once");
		assert.equal(after.phase, "paused", "recording an authorized outcome is not a lifecycle boundary");
		// The compatibility view is published from the committed aggregate.
		const view = await readResearchRoundLedger(researchRoundPath(dir, runId, process.env));
		assert.equal(view?.budget.consumed.searches, 1);
		// New work after the boundary is refused before the adapter is invoked.
		const fresh = await tool.execute("tc-pause-2", { query: "new work after the pause" }, undefined, undefined, ctx as never);
		assert.equal(fresh.details.outcome, "paused");
		assert.equal(await readFileSync(join(barrier, "invocations"), "utf8"), "x\n", "a refused request must not invoke the adapter");
	} finally {
		teardownRun(snapshot, dir);
	}
});

test("in-flight lifecycle transitions preserve permitted accounting without reactivation", async () => {
	for (const [toPhase, receiptExpected] of [["awaiting_extension", true], ["blocked", true], ["settled", false]] as const) {
		const { dir, barrier, snapshot, aggregatePath, fp, ctx, runId } = await setupBarrierRun(`lifecycle-${toPhase}`, "active", `lifecycle-${toPhase}`);
		try {
			const tool = fp.tools.get("web_search")!;
			const pending = tool.execute(`tc-${toPhase}`, { query: `in flight into ${toPhase}` }, undefined, undefined, ctx as never);
			await waitFor(join(barrier, "started"));
			await transitionRun(aggregatePath, toPhase);
			writeFileSync(join(barrier, "proceed"), "go\n");
			const result = await pending;
			assert.equal(result.details.result_count, 1, `${toPhase}: the authorized retrieval still returns its result`);
			const after = (await readResearchAggregate(aggregatePath))!;
			const receipts = searchReceipts(after);
			if (receiptExpected) {
				assert.equal(receipts.length, 1, `${toPhase}: the authorized outcome is recorded durably`);
				assert.equal(receipts[0].charged, true);
				assert.equal(consumedSearches(after), 1, `${toPhase}: the search is charged exactly once`);
			} else {
				assert.equal(receipts.length, 0, `${toPhase}: settled evidence is not reopened`);
				assert.equal(consumedSearches(after), 0, `${toPhase}: no charge after settlement`);
			}
			assert.equal(after.phase, toPhase, `${toPhase}: the lifecycle is preserved`);
		} finally {
			teardownRun(snapshot, dir);
		}
	}
});

test("a read authorized before a pause keeps its durable accounting when it completes after the pause", async () => {
	const { dir, barrier, snapshot, aggregatePath, fp, ctx, runId } = await setupBarrierRun("read-pause-run", "active", "read-pause");
	try {
		const tool = fp.tools.get("web_read")!;
		const pending = tool.execute("tc-read-1", { urls: ["https://example.com/a"] }, undefined, undefined, ctx as never);
		await waitFor(join(barrier, "started"));
		await transitionRun(aggregatePath, "paused");
		writeFileSync(join(barrier, "proceed"), "go\n");
		const result = await pending;
		assert.equal(result.details.source_count, 1, "the authorized read must still return its page");
		const after = (await readResearchAggregate(aggregatePath))!;
		const rounds = (after.evidence_round as { rounds?: Array<{ reads: Array<{ url: string; outcome: string; disposition: string }> }> }).rounds ?? [];
		const reads = rounds.flatMap((round) => round.reads);
		assert.equal(reads.length, 1, "the authorized read outcome is recorded durably across the pause");
		assert.equal(reads[0].outcome, "completed");
		assert.equal(reads[0].disposition, "accepted");
		assert.equal((after.evidence_round as { budget: { consumed: { reads: number } } }).budget.consumed.reads, 1, "the read must be charged exactly once");
		assert.equal(after.phase, "paused", "recording an authorized outcome is not a lifecycle boundary");
		const view = await readResearchRoundLedger(researchRoundPath(dir, runId, process.env));
		assert.equal(view?.budget.consumed.reads, 1);
		const fresh = await tool.execute("tc-read-2", { urls: ["https://example.com/b"] }, undefined, undefined, ctx as never);
		assert.equal(fresh.details.outcome, "paused");
		assert.equal(await readFileSync(join(barrier, "invocations"), "utf8"), "x\n", "a refused request must not invoke the adapter");
	} finally {
		teardownRun(snapshot, dir);
	}
});

test("switching the global run context while A is pending records the completion only against A", async () => {
	const { dir, barrier, snapshot, aggregatePath, fp, ctx, runId } = await setupBarrierRun("switch-a", "active", "switch");
	try {
		const runB = "switch-b";
		const aggregatePathB = researchAggregatePath(dir, runB, process.env);
		await writeResearchAggregate(aggregatePathB, createResearchAggregate({ run_id: runB, phase: "active", graph: { run_id: runB }, evidence_round: ledgerState(runB), budget: { searches: 3, reads: 5, validation_reads: 5 }, deadline: deadlineFor(Date.now()) }));
		const beforeB = (await readResearchAggregate(aggregatePathB))!;
		const tool = fp.tools.get("web_search")!;
		const pending = tool.execute("tc-switch-1", { query: "authorized on A" }, undefined, undefined, ctx as never);
		await waitFor(join(barrier, "started"));
		// The global context moves to B while A's retrieval is in flight.
		(globalThis as Record<string, unknown>).__pi_active_plan_context = { run_id: runB, profile: "deep-research", settled: false };
		writeFileSync(join(barrier, "proceed"), "go\n");
		const result = await pending;
		assert.equal(result.details.result_count, 1);
		const afterA = (await readResearchAggregate(aggregatePath))!;
		const receiptsA = searchReceipts(afterA);
		assert.equal(receiptsA.length, 1, "the completion is recorded against the run that authorized it");
		assert.equal(receiptsA[0].charged, true);
		assert.equal(consumedSearches(afterA), 1);
		assert.equal(afterA.phase, "active");
		const afterB = (await readResearchAggregate(aggregatePathB))!;
		assert.equal(searchReceipts(afterB).length, 0, "the current global context is not charged for A's completion");
		assert.equal(consumedSearches(afterB), 0);
		assert.equal(afterB.revision, beforeB.revision, "B's aggregate is untouched");
	} finally {
		teardownRun(snapshot, dir);
	}
});

test("replaying the same completion through the production accounting function cannot duplicate receipts or charges", async () => {
	const { dir, barrier, snapshot, aggregatePath, fp, ctx, runId } = await setupBarrierRun("replay-run", "active", "replay");
	try {
		const tool = fp.tools.get("web_search")!;
		const pending = tool.execute("tc-replay-1", { query: "replay query" }, undefined, undefined, ctx as never);
		await waitFor(join(barrier, "started"));
		writeFileSync(join(barrier, "proceed"), "go\n");
		await pending;
		const before = (await readResearchAggregate(aggregatePath))!;
		const recorded = searchReceipts(before)[0];
		const { charged: _charged, ...replayInput } = recorded;
		const replay = await recordAuthorizedSearchReceipt(dir, runId, replayInput);
		assert.equal(replay.receipt_id, replayInput.receipt_id);
		const after = (await readResearchAggregate(aggregatePath))!;
		assert.equal(searchReceipts(after).length, 1, "the replay must not duplicate the receipt");
		assert.equal(consumedSearches(after), 1, "the replay must not double-charge");
		assert.equal(after.revision, before.revision, "an idempotent duplicate must not mint a revision");
	} finally {
		teardownRun(snapshot, dir);
	}
});

test("wrong-run, unauthorized, and conflicting completions fail without mutation", async () => {
	const { dir, barrier, snapshot, aggregatePath, fp, ctx, runId } = await setupBarrierRun("reject-run", "active", "reject");
	try {
		const tool = fp.tools.get("web_search")!;
		const pending = tool.execute("tc-reject-1", { query: "reject query" }, undefined, undefined, ctx as never);
		await waitFor(join(barrier, "started"));
		writeFileSync(join(barrier, "proceed"), "go\n");
		await pending;
		const base = (await readResearchAggregate(aggregatePath))!;
		const { charged: _charged, ...recorded } = searchReceipts(base)[0];
		// Wrong run: the completion names a run that owns no aggregate here.
		await assert.rejects(recordAuthorizedSearchReceipt(dir, "reject-other", recorded), /missing|identity/);
		let after = (await readResearchAggregate(aggregatePath))!;
		assert.equal(after.revision, base.revision, "wrong-run: no revision minted");
		assert.equal(JSON.stringify(after.evidence_round), JSON.stringify(base.evidence_round), "wrong-run: evidence round unchanged");
		// Conflicting: the same receipt identity with different outcome content.
		await assert.rejects(recordAuthorizedSearchReceipt(dir, runId, { ...recorded, outcome: "failed" }), /conflicts/);
		after = (await readResearchAggregate(aggregatePath))!;
		assert.equal(after.revision, base.revision, "conflicting: no revision minted");
		assert.equal(JSON.stringify(after.evidence_round), JSON.stringify(base.evidence_round), "conflicting: evidence round unchanged");
		// Unauthorized: the run is settled, so the outcome gate refuses.
		await transitionRun(aggregatePath, "settled");
		const settledBase = (await readResearchAggregate(aggregatePath))!;
		await assert.rejects(recordAuthorizedSearchReceipt(dir, runId, recorded), /not eligible/);
		after = (await readResearchAggregate(aggregatePath))!;
		assert.equal(after.revision, settledBase.revision, "settled: no revision minted");
		assert.equal(after.phase, "settled", "settled: the lifecycle is preserved");
		assert.equal(JSON.stringify(after.evidence_round), JSON.stringify(settledBase.evidence_round), "settled: evidence round unchanged");
	} finally {
		teardownRun(snapshot, dir);
	}
});

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
