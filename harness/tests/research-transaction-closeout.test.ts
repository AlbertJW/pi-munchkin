import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createResearchAggregate, expireResearchDeadline, extendDeadline, mutateResearchAggregate, readResearchAggregate, transitionAggregate, writeResearchAggregate } from "../lib/research-aggregate.ts";
import { ResearchRoundLedger } from "../lib/research-round.ts";

function ledger() {
 return new ResearchRoundLedger({ run_id: "closeout", obligations: [{ claim_id: "c", text: "claim", required: false, status: "open", missing: "evidence", why: "test", next_action: "read" }], budget: { searches: 2, reads: 1, validation_reads: 1 } });
}

test("read authorization reserves the complete batch before dispatch", () => {
 const state = ledger();
 assert.throws(() => state.authorizeOperation("read", "batch", JSON.stringify(["https://example.com/A", "https://example.com/B"])), /budget/);
 assert.equal(state.state.budget.reserved.reads, 0);
});

test("nested graph and ledger changes roll back together when final validation fails", async () => {
 const dir = await mkdtemp(join(tmpdir(), "research-atomic-"));
 const path = join(dir, "aggregate.json");
 const initial = createResearchAggregate({ run_id: "atomic", graph: {}, evidence_round: {}, phase: "active", budget: { searches: 0, reads: 0, validation_reads: 0 } });
 try {
  await writeResearchAggregate(path, initial);
  await assert.rejects(mutateResearchAggregate(path, async state => {
   await mutateResearchAggregate(path, current => ({ state: transitionAggregate(current, { graph: { changed: true } }), result: undefined }));
   throw new Error("final validation rejected");
  }), /final validation rejected/);
  assert.deepEqual(await readResearchAggregate(path), initial);
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test("a caught nested failure restores its transaction savepoint", async () => {
 const dir = await mkdtemp(join(tmpdir(), "research-savepoint-"));
 const path = join(dir, "aggregate.json");
 const initial = createResearchAggregate({ run_id: "savepoint", graph: {}, evidence_round: {}, phase: "active", budget: { searches: 0, reads: 0, validation_reads: 0 } });
 try {
  await writeResearchAggregate(path, initial);
  await mutateResearchAggregate(path, async state => {
   await assert.rejects(mutateResearchAggregate(path, async () => {
    await mutateResearchAggregate(path, nested => ({ state: transitionAggregate(nested, { graph: { leaked: true } }), result: undefined }));
    throw new Error("nested rejected");
   }), /nested rejected/);
   return { state: transitionAggregate(state, { graph: { committed: true } }), result: undefined };
  });
  const final = await readResearchAggregate(path);
  assert.deepEqual(final?.graph, { committed: true });
  assert.equal(final?.revision, 1);
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test("dead dispatcher recovery charges its reserved batch once", () => {
 const state = ledger();
 const op = state.authorizeOperation("read", "dead-process-read", JSON.stringify(["https://example.com/A"]));
 assert.equal(state.state.budget.reserved.reads, 1);
 const recovered = state.recoverAbandonedOperations(pid => pid !== op.owner_pid);
 assert.equal(recovered, 1);
 assert.equal(state.state.budget.reserved.reads, 0);
 assert.equal(state.state.budget.consumed.reads, 1);
 assert.equal(state.state.read_receipts?.[0]?.outcome, "failed");
 assert.equal(state.recoverAbandonedOperations(() => false), 0);
 assert.equal(state.state.budget.consumed.reads, 1);
});

test("restart recovery also closes ownerless authorizations from the prior schema", () => {
 const created = ledger();
 created.authorizeOperation("search", "legacy-search", "legacy query");
 const persisted = created.state;
 delete persisted.operation_authorizations?.[0]?.owner_pid;
 const restored = ResearchRoundLedger.fromState(persisted);
 assert.equal(restored.recoverAbandonedOperations(() => true), 1);
 assert.equal(restored.state.budget.reserved.searches, 0);
 assert.equal(restored.state.budget.consumed.searches, 1);
});

test("settlement cannot overtake an authorized provider operation", () => {
 const state = ledger();
 state.authorizeOperation("search", "pending-search", "bounded query");
 assert.ok(state.settlementCheck({ graph_terminal: true, optional_deferrals: [{ claim_id: "c", value: "none", risk: "none", rationale: "optional test claim" }] }).reasons.includes("retrieval_in_flight"));
});

test("deadline expiry is fake-clock deterministic and stale timers cannot pause an extension", async () => {
 const dir = await mkdtemp(join(tmpdir(), "research-deadline-"));
 const path = join(dir, "aggregate.json");
 const started = Date.parse("2026-01-01T00:00:00.000Z");
 const initial = createResearchAggregate({ run_id: "deadline", graph: {}, evidence_round: {}, phase: "active", budget: { searches: 0, reads: 0, validation_reads: 0 }, deadline: { started_at: new Date(started).toISOString(), discovery_deadline_at: new Date(started + 420_000).toISOString(), deadline_at: new Date(started + 600_000).toISOString(), paused_ms: 0, extension_count: 0 } });
 try {
  await writeResearchAggregate(path, initial);
  assert.equal(await expireResearchDeadline(path, started + 599_999), false);
  assert.equal((await readResearchAggregate(path))?.revision, 0);
  assert.equal(await expireResearchDeadline(path, started + 600_000), true);
  assert.equal((await readResearchAggregate(path))?.phase, "awaiting_extension");
  assert.equal(await expireResearchDeadline(path, started + 600_001), false);
  await mutateResearchAggregate(path, state => ({ state: extendDeadline(state, started + 600_002), result: undefined }));
  assert.equal(await expireResearchDeadline(path, started + 600_003), false);
  assert.equal((await readResearchAggregate(path))?.phase, "active");
 } finally { await rm(dir, { recursive: true, force: true }); }
});

test("authorization from an exited real process is recovered from its durable state", () => {
 const moduleUrl = new URL("../lib/research-round.ts", import.meta.url).href;
 const state = ledger().state;
 const source = `import { ResearchRoundLedger } from ${JSON.stringify(moduleUrl)}; const ledger = ResearchRoundLedger.fromState(${JSON.stringify(state)}); ledger.authorizeOperation("read", "process-read", '["https://example.com/A"]'); console.log(JSON.stringify(ledger.state));`;
 const persisted = JSON.parse(execFileSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e", source], { encoding: "utf8" }));
 const restored = ResearchRoundLedger.fromState(persisted);
 assert.notEqual(persisted.operation_authorizations[0].owner_pid, process.pid);
 assert.equal(restored.recoverAbandonedOperations(pid => { try { process.kill(pid, 0); return true; } catch { return false; } }), 1);
 assert.equal(restored.state.budget.consumed.reads, 1);
 assert.equal(restored.state.budget.reserved.reads, 0);
 assert.equal(restored.state.evidence_cards.length, 0);
 assert.equal(restored.recoverAbandonedOperations(() => false), 0);
});
