import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	ResearchRoundError, ResearchRoundLedger, evidenceCardRef, readResearchRoundLedger, researchRoundPath,
	validateResearchRoundLedger, validateResearchRoundProposal, writeResearchRoundLedger,
} from "../lib/research-round.ts";
import { makeEvidenceCard } from "../lib/research-evidence.ts";

const obligation = (claim_id: string, required = true) => ({
	claim_id, text: `Answer ${claim_id}`, required, status: "open" as const,
	missing: "A parent-read source is missing.", why: "The final answer depends on this claim.", next_action: "Search for an authoritative source.",
});

const gap = (claim_id: string, status: "open" | "resolved" | "blocked" | "deferred" = "open") => ({
	gap_id: `gap-${claim_id}`, claim_id, missing: "A parent-read source is missing.", why: "The final answer depends on this claim.", next_action: "Search for an authoritative source.", status,
});
const baseProposal = (run_id: string, round_id: string, claim_id: string, url = "https://example.test/source") => ({
	schema: "pi.research-round/v1" as const, run_id, round_id, selected_gaps: [`gap-${claim_id}`],
	queries: [{ query_id: `query-${round_id}`, claim_id, query: `authoritative ${claim_id}` }],
	source_leads: [{ lead_id: `lead-${round_id}`, url, claim_ids: [claim_id], triage: "selected" as const }],
	reads: [{ url, phase: "discovery" as const, method: "ketch" as const, outcome: "completed" as const, truncated: false, parent_validated: false }],
	evidence_cards: [], conflicts: [], gaps: [gap(claim_id)], proposed_next_action: "read" as const,
});
const parentCard = (claim_id: string, url = "https://example.test/source", overrides: Record<string, unknown> = {}) => ({
	card_id: "a".repeat(32), original_url: url, content_sha256: "a".repeat(64), claim_ids: [claim_id], truncated: false, parent_validated: true, retrieval_method: "ketch" as const, ...overrides,
});

test("research round proposal validation rejects executable text and accepts bounded typed data", () => {
	const proposal = baseProposal("run-a", "round-1", "claim-a");
	assert.equal(validateResearchRoundProposal(proposal), true);
	const forged = structuredClone(proposal) as Record<string, unknown>;
	(forged.source_leads as Array<Record<string, unknown>>)[0].quote = "fabricated quote";
	assert.equal(validateResearchRoundProposal(forged), false, "quotes are not accepted in model source leads");
});

test("parent rounds derive usage, resolve only parent cards, and expose the next action", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-a", obligations: [obligation("claim-a")] });
	const round = ledger.recordRound(baseProposal("run-a", "round-1", "claim-a"));
	assert.deepEqual(round.consumed, { searches: 1, reads: 1, validation_reads: 0 });
	assert.equal(round.next_action, "read");
	assert.deepEqual(ledger.validatedClaimIds(), []);
	const validation = ledger.recordRound({
		schema: "pi.research-round/v1", run_id: "run-a", round_id: "round-2", selected_gaps: ["gap-claim-a"], queries: [],
		source_leads: [], reads: [{ url: "https://example.test/source", phase: "parent_validation", method: "ketch", outcome: "completed", truncated: false, parent_validated: true }],
		evidence_cards: [parentCard("claim-a")], conflicts: [], gaps: [gap("claim-a")], proposed_next_action: "synthesize",
	});
	assert.deepEqual(validation.consumed, { searches: 0, reads: 0, validation_reads: 1 });
	assert.deepEqual(ledger.validatedClaimIds(), ["claim-a"]);
	const check = ledger.settlementCheck({ graph_terminal: true });
	assert.equal(check.ready, true);
});

test("duplicate queries, URLs, and reports cannot buy another allowance", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-b", obligations: [obligation("claim-a"), obligation("claim-b")] });
	const first = ledger.recordRound(baseProposal("run-b", "round-1", "claim-a"));
	assert.deepEqual(first.consumed, { searches: 1, reads: 1, validation_reads: 0 });
	const second = ledger.recordRound({ ...baseProposal("run-b", "round-2", "claim-a", "https://example.test/source"), queries: [{ query_id: "query-round-2", claim_id: "claim-a", query: "authoritative claim-a" }] });
	assert.deepEqual(second.consumed, { searches: 0, reads: 0, validation_reads: 0 });
	assert.equal(second.duplicate_count, 3);
	assert.deepEqual(ledger.remaining(), { searches: 2, reads: 4, validation_reads: 5 });
	const same = ledger.recordRound(baseProposal("run-b", "round-1", "claim-a"));
	assert.equal(same.round_id, "round-1");
	assert.throws(() => ledger.recordRound({ ...baseProposal("run-b", "round-1", "claim-a"), note: "changed" }), ResearchRoundError);
});

test("failed child reports burn their reserved allocation and duplicate or late reports are harmless", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-c", obligations: [obligation("claim-a")] });
	ledger.reserveChild("owner-c", { searches: 1, reads: 1, validation_reads: 0 });
	const report = {
		report_id: "report-c", run_id: "run-c", owner_ref: "owner-c", status: "blocked" as const,
		allocated: { searches: 1, reads: 1, validation_reads: 0 }, consumed: { searches: 0, reads: 0, validation_reads: 0 },
		source_leads: [], evidence_cards: [], gaps: [gap("claim-a", "blocked")], failure_class: "child_failed" as const,
	};
	assert.deepEqual(ledger.mergeChildReport(report), { merged: true, reason: "merged" });
	assert.deepEqual(ledger.remaining(), { searches: 2, reads: 4, validation_reads: 5 });
	assert.deepEqual(ledger.mergeChildReport(report), { merged: false, reason: "duplicate" });
	const check = ledger.settlementCheck({ graph_terminal: true });
	assert.equal(check.ready, false);
});

test("child-only, truncated, and conflicting evidence cannot manufacture settlement", () => {
	const childLedger = new ResearchRoundLedger({ run_id: "run-d", obligations: [obligation("claim-a")] });
	childLedger.reserveChild("owner-d", { searches: 1, reads: 1, validation_reads: 0 });
	childLedger.mergeChildReport({
		report_id: "report-d", run_id: "run-d", owner_ref: "owner-d", status: "done", allocated: { searches: 1, reads: 1, validation_reads: 0 }, consumed: { searches: 1, reads: 1, validation_reads: 0 }, source_leads: [{ url: "https://example.test/source", claim_ids: ["claim-a"] }], evidence_cards: [parentCard("claim-a")], gaps: [gap("claim-a")],
	});
	let check = childLedger.settlementCheck({ graph_terminal: true });
	assert.equal(check.ready, false);
	assert.ok(check.reasons.includes("required_claims_unresolved"));
	const truncated = new ResearchRoundLedger({ run_id: "run-e", obligations: [obligation("claim-a")] });
	truncated.recordRound({ ...baseProposal("run-e", "round-1", "claim-a"), reads: [], evidence_cards: [parentCard("claim-a", "https://example.test/source", { truncated: true })], proposed_next_action: "read" });
	assert.equal(truncated.validatedClaimIds().length, 0);
	const conflict = new ResearchRoundLedger({ run_id: "run-f", obligations: [obligation("claim-a")] });
	conflict.recordRound({ ...baseProposal("run-f", "round-1", "claim-a"), reads: [{ url: "https://example.test/source", phase: "parent_validation", method: "ketch", outcome: "completed", truncated: false, parent_validated: true }, { url: "https://example.test/other", phase: "parent_validation", method: "ketch", outcome: "completed", truncated: false, parent_validated: true }], evidence_cards: [parentCard("claim-a"), parentCard("claim-a", "https://example.test/other", { card_id: "b".repeat(32), content_sha256: "b".repeat(64) })], conflicts: [{ conflict_id: "conflict-a", claim_id: "claim-a", card_ids: ["a".repeat(32), "b".repeat(32)], status: "open" }], proposed_next_action: "validate" });
	check = conflict.settlementCheck({ graph_terminal: true });
	assert.equal(check.ready, false);
	assert.ok(check.reasons.includes("conflicting_sources_unresolved"));
});

test("budget exhaustion becomes an explicit gap and persistence survives restart/compaction", async () => {
	const root = await mkdtemp(join(tmpdir(), "research-round-"));
	try {
		const ledger = new ResearchRoundLedger({ run_id: "run-g", obligations: [obligation("claim-a")] });
		ledger.recordRound({ ...baseProposal("run-g", "round-1", "claim-a"), reads: [] });
			ledger.recordRound({ ...baseProposal("run-g", "round-2", "claim-a", "https://example.test/other"), queries: [{ query_id: "q2", claim_id: "claim-a", query: "new angle" }], reads: [] });
			ledger.recordRound({ ...baseProposal("run-g", "round-3", "claim-a", "https://example.test/third"), queries: [{ query_id: "q3", claim_id: "claim-a", query: "third angle" }], reads: [] });
		const path = researchRoundPath(root, "run-g", { PI_CODING_AGENT_DIR: join(root, "agent") });
		await writeResearchRoundLedger(path, ledger.state);
		const restored = await readResearchRoundLedger(path);
		assert.ok(restored);
		assert.equal(validateResearchRoundLedger(restored), true);
	assert.equal(restored?.rounds.length, 3);
	assert.equal((await readFile(path, "utf8")).includes("quote"), false);
	assert.doesNotThrow(() => JSON.parse(ledger.renderSummary(600)));
	assert.ok(Buffer.byteLength(ledger.renderSummary(128), "utf8") <= 128, "compact summary respects its byte ceiling");
	} finally { await rm(root, { recursive: true, force: true }); }
});

test("discovery exhaustion still permits parent validation while validation budget remains", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-validation-after-discovery", obligations: [obligation("claim-a")] });
	const urls = Array.from({ length: 5 }, (_, index) => `https://example.test/source-${index + 1}`);
	const first = ledger.recordRound({
		...baseProposal("run-validation-after-discovery", "round-1", "claim-a", urls[0]),
		queries: [
			{ query_id: "query-1", claim_id: "claim-a", query: "authoritative angle one" },
			{ query_id: "query-2", claim_id: "claim-a", query: "authoritative angle two" },
			{ query_id: "query-3", claim_id: "claim-a", query: "authoritative angle three" },
		],
		source_leads: urls.map((url, index) => ({ lead_id: `lead-${index + 1}`, url, claim_ids: ["claim-a"], triage: "selected" as const })),
		reads: urls.map((url) => ({ url, phase: "discovery" as const, method: "ketch" as const, outcome: "completed" as const, truncated: false, parent_validated: false })),
		proposed_next_action: "read" as const,
	});
	assert.deepEqual(first.consumed, { searches: 3, reads: 5, validation_reads: 0 });
	assert.equal(first.status, "recorded", "discovery exhaustion is not terminal while parent validation remains");
	assert.equal(first.next_action, "validate", "the next permitted action is parent validation");
	const second = ledger.recordRound({
		...baseProposal("run-validation-after-discovery", "round-2", "claim-a", urls[0]),
		selected_gaps: ["gap-claim-a"], queries: [], source_leads: [],
		reads: [{ url: urls[0], phase: "parent_validation" as const, method: "ketch" as const, outcome: "completed" as const, truncated: false, parent_validated: true }],
		evidence_cards: [parentCard("claim-a", urls[0])], gaps: [], proposed_next_action: "synthesize" as const,
	});
	assert.deepEqual(second.consumed, { searches: 0, reads: 0, validation_reads: 1 });
	assert.equal(validateResearchRoundLedger(ledger.state), true, "parent-validation-only rounds must survive ledger validation");
	assert.equal(ledger.settlementCheck({ graph_terminal: true }).ready, true);
});

test("answer readiness is distinct from graph terminality and optional deferrals are explicit", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-h", obligations: [obligation("required"), obligation("optional", false)] });
	ledger.recordRound({
		schema: "pi.research-round/v1", run_id: "run-h", round_id: "round-1", selected_gaps: ["gap-required", "gap-optional"],
		queries: [], source_leads: [], reads: [{ url: "https://example.test/source", phase: "parent_validation", method: "ketch", outcome: "completed", truncated: false, parent_validated: true }], evidence_cards: [parentCard("required")], conflicts: [], gaps: [gap("required"), gap("optional")], proposed_next_action: "synthesize",
	});
	let check = ledger.settlementCheck({ graph_terminal: true });
	assert.equal(check.ready, false);
	assert.ok(check.reasons.includes("optional_deferral_missing:optional"));
	assert.throws(() => ledger.settle({ graph_terminal: true, reason: "missing optional decision", optional_deferrals: [] }), ResearchRoundError);
	const settled = ledger.settle({ graph_terminal: true, reason: "required evidence complete; optional polish deferred", optional_deferrals: [{ claim_id: "optional", value: "Lower value than core answer", risk: "Minor context omitted", rationale: "Budget is exhausted and the answer remains useful." }] });
	assert.equal(settled.status, "settled");
	assert.deepEqual(ledger.mergeChildReport({ report_id: "late", run_id: "run-h", owner_ref: "owner-late", status: "done", allocated: { searches: 0, reads: 0, validation_reads: 0 }, consumed: { searches: 0, reads: 0, validation_reads: 0 }, source_leads: [], gaps: [], evidence_cards: [] }), { merged: false, reason: "settled" });
});

test("tampered round digests and child validation spending fail closed", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-i", obligations: [obligation("claim-a")] });
	const round = ledger.recordRound(baseProposal("run-i", "round-1", "claim-a"));
	assert.equal(validateResearchRoundLedger({ ...ledger.state, rounds: [{ ...round, note: "changed without rehash" }] }), false);
	ledger.reserveChild("owner-i", { searches: 1, reads: 0, validation_reads: 0 });
	assert.throws(() => ledger.mergeChildReport({ report_id: "report-i", run_id: "run-i", owner_ref: "owner-i", status: "done", allocated: { searches: 1, reads: 0, validation_reads: 1 }, consumed: { searches: 1, reads: 0, validation_reads: 1 }, source_leads: [], gaps: [], evidence_cards: [] }), ResearchRoundError);
});

test("malformed child reports are transactional and parent validation retries are deduplicated", () => {
	const ledger = new ResearchRoundLedger({ run_id: "run-j", obligations: [obligation("claim-a")] });
	ledger.reserveChild("owner-j", { searches: 0, reads: 1, validation_reads: 0 });
	const before = ledger.state;
	assert.throws(() => ledger.mergeChildReport({
		report_id: "report-j", run_id: "run-j", owner_ref: "owner-j", status: "done", allocated: { searches: 0, reads: 1, validation_reads: 0 }, consumed: { searches: 0, reads: 1, validation_reads: 0 },
		source_leads: [{ url: "not-a-url", claim_ids: ["claim-a"] }], gaps: [], evidence_cards: [],
	}), ResearchRoundError);
	assert.deepEqual(ledger.state, before, "invalid child input cannot burn a reservation");
	const first = ledger.recordRound({ ...baseProposal("run-j", "round-1", "claim-a"), reads: [{ url: "https://example.test/source", phase: "parent_validation", method: "ketch", outcome: "completed", truncated: false, parent_validated: true }], evidence_cards: [parentCard("claim-a")], proposed_next_action: "synthesize" });
	assert.deepEqual(first.consumed, { searches: 1, reads: 0, validation_reads: 1 });
	const second = ledger.recordRound({ ...baseProposal("run-j", "round-2", "claim-a"), selected_gaps: [], queries: [{ query_id: "query-round-2", claim_id: "claim-a", query: "authoritative claim-a" }], source_leads: [], reads: [{ url: "https://example.test/source", phase: "parent_validation", method: "ketch", outcome: "completed", truncated: false, parent_validated: true }], evidence_cards: [parentCard("claim-a")], gaps: [], proposed_next_action: "synthesize" });
	assert.deepEqual(second.consumed, { searches: 0, reads: 0, validation_reads: 0 });
	assert.equal(second.duplicate_count, 2);
});

test("evidence card references retain canonical source metadata without page text", () => {
	const card = makeEvidenceCard({ original_url: "https://example.test/source?utm_source=ignored", content: "A bounded source sentence.", claim_ids: ["claim-a"], truncated: false, parent_validated: true, retrieval_method: "jina" });
	const ref = evidenceCardRef(card);
	assert.equal(ref.original_url, "https://example.test/source");
	assert.equal("content" in ref, false);
});
