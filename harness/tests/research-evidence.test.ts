import assert from "node:assert/strict";
import test from "node:test";
import { canonicalResearchUrl, makeEvidenceCard, ResearchCoverageLedger } from "../lib/research-evidence.ts";

test("research evidence uses one canonical URL and content digest", () => {
	assert.equal(canonicalResearchUrl("HTTPS://Example.com:443/a/?utm_source=x&b=2&a=1#frag"), "https://example.com/a?a=1&b=2");
	const card = makeEvidenceCard({ original_url: "https://Example.com/a/", content: "source body", claim_ids: ["claim-b", "claim-a", "claim-a"], truncated: false, parent_validated: true, retrieval_method: "jina" });
	assert.equal(card.original_url, "https://example.com/a");
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
	assert.equal(ledger.cardCount, 1);
});

test("untrusted delegated cards cannot satisfy the parent ledger", () => {
	const ledger = new ResearchCoverageLedger([{ id: "claim-a" }]);
	const card = makeEvidenceCard({ original_url: "https://example.test/a", content: "source", claim_ids: ["claim-a"], truncated: false, parent_validated: false, retrieval_method: "jina" });
	assert.equal(ledger.addCard(card), false);
	assert.deepEqual(ledger.unmetClaimIds(), ["claim-a"]);
});
