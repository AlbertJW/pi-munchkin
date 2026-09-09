import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalResearchUrl, makeEvidenceCard, ResearchCoverageLedger } from "../lib/research-evidence.ts";
import { researchReservationRoot, reservationCount, reserveResearchKey } from "../lib/research-reservations.ts";

test("research evidence uses one canonical URL and content digest", () => {
	assert.equal(canonicalResearchUrl("HTTPS://Example.com:443/a/?utm_source=x&b=2&a=1#frag"), "https://example.com/a/?utm_source=x&b=2&a=1");
	const card = makeEvidenceCard({ original_url: "https://Example.com/a/", content: "source body", claim_ids: ["claim-b", "claim-a", "claim-a"], truncated: false, parent_validated: true, retrieval_method: "jina" });
	assert.equal(card.original_url, "https://example.com/a/");
	assert.deepEqual(card.claim_ids, ["claim-a", "claim-b"]);
	assert.match(card.content_sha256, /^[a-f0-9]{64}$/);
	assert.match(card.card_id, /^[a-f0-9]{32}$/);
});

test("coverage ledger deduplicates queries and URLs and only validated complete cards close gaps", () => {
	const ledger = new ResearchCoverageLedger([{ id: "claim-a" }, { id: "claim-b" }]);
	assert.deepEqual(ledger.nextQueries([
		{ claim_id: "claim-a", query: "  JSON syntax  " },
		{ claim_id: "claim-a", query: "different wording" },
		{ claim_id: "claim-b", query: "YAML syntax" },
	]), [{ claim_id: "claim-a", query: "JSON syntax" }, { claim_id: "claim-b", query: "YAML syntax" }]);
	assert.deepEqual(ledger.nextQueries([{ claim_id: "claim-a", query: "JSON syntax" }]), []);
	const partial = makeEvidenceCard({ original_url: "https://example.test/a", content: "partial", claim_ids: ["claim-a"], truncated: true, parent_validated: true, retrieval_method: "ketch" });
	assert.equal(ledger.addCard(partial), false);
	const card = makeEvidenceCard({ original_url: "https://example.test/a", content: "complete", claim_ids: ["claim-a"], truncated: false, parent_validated: true, retrieval_method: "ketch" });
	assert.equal(ledger.addCard(card), true);
	assert.equal(ledger.addCard(makeEvidenceCard({ original_url: "https://example.test/a?utm_medium=x", content: "complete", claim_ids: ["claim-b"], truncated: false, parent_validated: true, retrieval_method: "ketch" })), true);
	assert.deepEqual(ledger.unmetClaimIds(), []);
	assert.equal(ledger.cardCount, 2, "query variants are not aliases without evidence");
});

test("untrusted delegated cards cannot satisfy the parent ledger", () => {
	const ledger = new ResearchCoverageLedger([{ id: "claim-a" }]);
	const card = makeEvidenceCard({ original_url: "https://example.test/a", content: "source", claim_ids: ["claim-a"], truncated: false, parent_validated: false, retrieval_method: "jina" });
	assert.equal(ledger.addCard(card), false);
	assert.deepEqual(ledger.unmetClaimIds(), ["claim-a"]);
});

test("research reservations deduplicate keys across concurrent branch writers", async () => {
	const dir = await mkdtemp(join(tmpdir(), "research-reservations-"));
	const prior = process.env.PI_CODING_AGENT_DIR;
	process.env.PI_CODING_AGENT_DIR = join(dir, "agent");
	try {
		const root = researchReservationRoot(dir, "run-123");
		const results = await Promise.all(Array.from({ length: 8 }, () => reserveResearchKey(root, "query", "same claim")));
		assert.equal(results.filter(Boolean).length, 1);
		assert.equal(await reservationCount(root, "query"), 1);
		assert.equal(await reserveResearchKey(root, "url", "https://example.test/source"), true);
		assert.equal(await reserveResearchKey(root, "url", "https://example.test/source"), false);
		assert.equal(await reservationCount(root, "url"), 1);
	} finally {
		if (prior === undefined) delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = prior;
		await rm(dir, { recursive: true, force: true });
	}
});
