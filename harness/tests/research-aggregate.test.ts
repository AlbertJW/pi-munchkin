import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	aggregateDigest, aggregatePath, createResearchAggregate, deadlineFor, deadlinePhase, extendDeadline, isExecutableResearchAggregate, migrateResearchPair, researchAggregatePath,
	mutateResearchAggregate, readResearchAggregate, transitionAggregate, validateResearchAggregate, writeResearchAggregate,
} from "../lib/research-aggregate.ts";
import { inspectResearchPage, renderCoverageDigest } from "../lib/research-view.ts";

function pair(run_id = "research-plan-test") {
	return {
		graph: { schema_version: 5, run_id, items: [{ id: "root", status: "pending" }] },
		evidence: { schema: "pi.research-round-ledger/v1", run_id, status: "active", budget: { searches: 3, reads: 5, validation_reads: 5 } },
	};
}

test("migration creates one revision-zero aggregate only for a matching valid pair", () => {
	const { graph, evidence } = pair();
	const aggregate = migrateResearchPair(graph, evidence, "2026-09-09T00:00:00.000Z");
	assert.equal(aggregate.schema, "pi.research-aggregate/v1");
	assert.equal(aggregate.revision, 0);
	assert.equal(isExecutableResearchAggregate(aggregate), true);
	assert.match(aggregateDigest(aggregate), /^[a-f0-9]{64}$/);
	assert.throws(() => migrateResearchPair(graph, { ...evidence, run_id: "other" }), /different research runs/);
	assert.throws(() => migrateResearchPair({ ...graph, run_id: "" }, evidence), /valid run identity/);
});

test("run-scoped aggregate paths stay private and contained", () => {
	const path = researchAggregatePath("/work/project", "research-plan-1", { PI_CODING_AGENT_DIR: "/private/agent" } as NodeJS.ProcessEnv);
	assert.match(path, /research-aggregates\/[^/]+-research-plan-1\.json$/);
	assert.doesNotMatch(path, /project/);
	assert.throws(() => researchAggregatePath("/work/project", "../escape"), /invalid/);
});

test("malformed aggregate is rejected and never executable", () => {
	assert.equal(validateResearchAggregate({ schema: "pi.research-aggregate/v1", run_id: "x", revision: 0, phase: "active", graph: {}, evidence_round: {}, budget: { searches: -1, reads: 0, validation_reads: 0 }, created_at: "now", updated_at: "now" }), false);
	assert.equal(isExecutableResearchAggregate(null), false);
});

test("deadline is persisted as one ten-minute interval with a seven-minute discovery phase", () => {
	const now = Date.parse("2026-09-09T00:00:00.000Z");
	const deadline = deadlineFor(now);
	const state = createResearchAggregate({ run_id: "run-deadline", phase: "active", graph: {}, evidence_round: {}, budget: { searches: 3, reads: 5, validation_reads: 5 }, deadline, now: new Date(now).toISOString() });
	assert.equal(deadlinePhase(state, now + 6 * 60_000), "discovery");
	assert.equal(deadlinePhase(state, now + 7 * 60_000), "validation");
	assert.equal(deadlinePhase(state, now + 10 * 60_000), "expired");
	const extended = extendDeadline(transitionAggregate(state, { phase: "awaiting_extension" }), now + 10 * 60_000);
	assert.equal(extended.deadline?.extension_count, 1);
	assert.equal(deadlinePhase(extended, now + 10 * 60_000), "discovery");
	assert.throws(() => extendDeadline(state, now), /only be extended/);
});

test("aggregate transitions are immutable, monotonic and atomic", async () => {
	const root = await mkdtemp(join(tmpdir(), "research-aggregate-"));
	const path = aggregatePath(root, "run-1");
	const initial = createResearchAggregate({ run_id: "run-1", phase: "active", graph: { items: [] }, evidence_round: { run_id: "run-1" }, budget: { searches: 3, reads: 5, validation_reads: 5 } });
	await writeResearchAggregate(path, initial);
	const changed = transitionAggregate(initial, { phase: "paused" });
	assert.equal(changed.revision, 1);
	assert.equal(initial.phase, "active");
	await writeResearchAggregate(path, changed);
	await assert.rejects(() => mutateResearchAggregate(path, (state) => ({ state: { ...state, phase: "active" } as any, result: null })), /increment revision/);
	const result = await mutateResearchAggregate(path, (state) => ({ state: transitionAggregate(state, { phase: "settled" }), result: state.revision }));
	assert.equal(result, 1);
	const loaded = await readResearchAggregate(path);
	assert.equal(loaded?.phase, "settled");
	assert.equal(loaded?.revision, 2);
	assert.equal((await stat(path)).mode & 0o777, 0o600);
	assert.match(await readFile(path, "utf8"), /pi\.research-aggregate\/v1/);
});

test("concurrent aggregate transitions serialize without lost revisions", async () => {
	const root = await mkdtemp(join(tmpdir(), "research-aggregate-concurrent-"));
	const path = aggregatePath(root, "run-2");
	await writeResearchAggregate(path, createResearchAggregate({ run_id: "run-2", phase: "active", graph: {}, evidence_round: {}, budget: { searches: 3, reads: 5, validation_reads: 5 } }));
	await Promise.all(Array.from({ length: 5 }, (_, index) => mutateResearchAggregate(path, (state) => ({ state: transitionAggregate(state, { graph: { last: index } }), result: index }))));
	const final = await readResearchAggregate(path);
	assert.equal(final?.revision, 5);
});

test("coverage digest is deterministic, bounded and progressively disclosed", () => {
	const state = createResearchAggregate({ run_id: "run-view", phase: "active", graph: {}, evidence_round: {
		run_id: "run-view", budget: { allocated: { searches: 3, reads: 5, validation_reads: 5 }, consumed: { searches: 1, reads: 2, validation_reads: 0 } },
		obligations: Array.from({ length: 10 }, (_, i) => ({ claim_id: `claim-${i}`, required: true, status: "open" })), evidence_cards: [], conflicts: [], rounds: [{ next_action: "read" }],
	}, budget: { searches: 1, reads: 2, validation_reads: 0 } });
	const view = renderCoverageDigest(state, 500);
	assert.ok(Buffer.byteLength(view.text) <= 500);
	assert.equal(view.digest.revision, 0);
	assert.ok(view.digest.omitted > 0);
	assert.match(view.digest.cursor!, /^r0:\d+$/);
	const page = inspectResearchPage(state, "r0:0", 400);
	assert.ok(Buffer.byteLength(page.text) <= 400);
	assert.throws(() => inspectResearchPage({ ...state, revision: 1 }, "r0:0"), /stale/);
	assert.throws(() => inspectResearchPage(state, "r0:0", 32), /cap is too small/);
});
