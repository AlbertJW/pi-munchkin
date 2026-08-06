import assert from "node:assert/strict";
import test from "node:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendToLedger, checkNote, ledgerPath, MAX_CACHE_BYTES, MAX_CACHED_PAGES,
	normalizeForContainment, PageCache, quoteContained, renderNoteLine, sha256Hex,
} from "../lib/research-ledger.ts";
import { callToolRaw, fire, makeFakePi, resetPiGlobals } from "./integration-harness.ts";

// Run: cd ~/.pi/agent && TELEMETRY_FILE=$(mktemp) TELEMETRY_SOURCE=test \
//        npx -y tsx --test tests/research-ledger.test.ts
//
// The research pipeline's core claim is that a hallucinated citation cannot be
// RECORDED — research_note is the verify-gate of deep research. These tests pin
// the containment check, the LRU/byte bounds, and the dark-by-default gate.

test("quote containment is verbatim modulo whitespace, and rejects paraphrase", () => {
	const page = "The release shipped on August 5, 2026, with 256 experts.";
	assert.equal(quoteContained("shipped on August 5, 2026", page), true, "verbatim substring");
	assert.equal(quoteContained("shipped   on\n August 5,\t2026", page), true, "whitespace differences tolerated");
	assert.equal(quoteContained("shipped in August 2026", page), false, "wording change is NOT contained");
	assert.equal(quoteContained("256 EXPERTS", page), false, "case change is not contained (verbatim)");
	assert.equal(quoteContained("", page), false, "empty quote never matches");
	assert.equal(normalizeForContainment("  a\t b  \n c "), "a b c");
});

test("PageCache evicts LRU by count and by total bytes", () => {
	const cache = new PageCache();
	for (let i = 0; i < MAX_CACHED_PAGES + 5; i++) cache.put(`https://ex/${i}`, `body-${i}`);
	assert.equal(cache.size(), MAX_CACHED_PAGES, "count bound holds");
	assert.equal(cache.has("https://ex/0"), false, "oldest evicted");
	assert.equal(cache.has(`https://ex/${MAX_CACHED_PAGES + 4}`), true, "newest kept");

	// LRU touch: reading an old entry protects it from the next eviction.
	const c2 = new PageCache();
	for (let i = 0; i < MAX_CACHED_PAGES; i++) c2.put(`u${i}`, `b${i}`);
	c2.get("u0"); // touch the oldest
	c2.put("uNEW", "bNEW"); // forces one eviction
	assert.equal(c2.has("u0"), true, "touched entry survived");
	assert.equal(c2.has("u1"), false, "the next-oldest was evicted instead");

	// Byte bound: one page larger than the whole budget cannot wedge the cache.
	const c3 = new PageCache();
	c3.put("big", "x".repeat(MAX_CACHE_BYTES + 10));
	assert.ok(c3.bytes() <= MAX_CACHE_BYTES || c3.size() === 0, "byte budget enforced");
});

test("checkNote refuses an unread URL and a fabricated quote; accepts a real one", () => {
	const cache = new PageCache();
	cache.put("https://ex/a", "Maple decodes at about 80 tokens per second on this Mac.");
	assert.deepEqual(checkNote(cache, "https://ex/never", "anything"), { ok: false, reason: "url_not_read" });
	assert.deepEqual(checkNote(cache, "https://ex/a", "runs at 500 tokens per second"), { ok: false, reason: "quote_not_found" });
	const ok = checkNote(cache, "https://ex/a", "about 80 tokens per second");
	assert.equal(ok.ok, true);
});

test("ledger file is append-only, atomic, and keeps quotes fenced", () => {
	const dir = mkdtempSync(join(tmpdir(), "rl-"));
	const path = ledgerPath(dir, new Date("2026-08-05T10:11:12Z"));
	const page = { text: "x", sha256: sha256Hex("x"), fetchedAt: "2026-08-05T10:00:00Z" };
	appendToLedger(path, renderNoteLine(1, "First claim", "https://ex/a", "a verbatim quote", page), "# Research ledger\n\n");
	appendToLedger(path, renderNoteLine(2, "Second claim", "https://ex/b", "another quote", page));
	const body = readFileSync(path, "utf8");
	assert.match(body, /# Research ledger/);
	assert.match(body, /### #1 First claim/);
	assert.match(body, /### #2 Second claim/);
	assert.match(body, /```quote\na verbatim quote\n```/);
	assert.ok(body.indexOf("#1") < body.indexOf("#2"), "append order preserved");
});

// --- integration: the tool as it actually registers ---

async function loadKetch(ledger: boolean) {
	const prev = process.env.RESEARCH_LEDGER;
	if (ledger) process.env.RESEARCH_LEDGER = "on"; else delete process.env.RESEARCH_LEDGER;
	const fp = makeFakePi();
	const mod = await import(`../extensions/ketch.ts?rl=${ledger}-${Date.now()}-${Math.random()}`);
	mod.default(fp.pi as never);
	if (prev === undefined) delete process.env.RESEARCH_LEDGER; else process.env.RESEARCH_LEDGER = prev;
	return fp;
}

test("research_note is DARK by default — absent from the tool surface unless RESEARCH_LEDGER=on", async () => {
	const off = await loadKetch(false);
	assert.equal(off.tools.has("research_note"), false, "no research_note tool when the flag is unset");
	assert.equal(off.tools.has("web_search"), true, "web_search still present");
	const on = await loadKetch(true);
	assert.equal(on.tools.has("research_note"), true, "research_note present under the flag");
});

test("research_note refuses a citation for a page never read this session", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rl-tool-"));
	const fp = await loadKetch(true);
	await fire(fp, "session_start", {}, { cwd: dir });
	const res = await callToolRaw(fp, "research_note",
		{ claim: "x", url: "https://ex/unread", quote: "some quote" }, dir) as { isError?: boolean; content: Array<{ text: string }> };
	assert.equal(res.isError, true, "a note for an unread URL is refused");
	assert.match(res.content[0].text, /was not read this session/);
});

// --- eval Run 2 fixes ---

test("checkNote auto-corrects a quote pasted from the WRONG url of a batch (defect 1)", () => {
	const cache = new PageCache();
	cache.put("https://a", "Alpha page: the sky is blue on Tuesdays.");
	cache.put("https://b", "Beta page: throughput was 80 tokens per second.");
	// Model claims url=a but the quote is verbatim in b. This drove the 62% refusal storm.
	const v = checkNote(cache, "https://a", "throughput was 80 tokens per second");
	assert.equal(v.ok, true, "a quote verbatim in exactly one other fetched page records");
	assert.equal(v.ok && v.url, "https://b", "recorded under the TRUE source, not the claimed url");
	assert.equal(v.ok && v.corrected, true, "flagged as corrected");
	// entries() exposes all cached pairs for the scan.
	assert.equal(cache.entries().length, 2);
});

test("checkNote refuses a quote that appears in TWO pages as ambiguous, naming both", () => {
	const cache = new PageCache();
	cache.put("https://a", "shared boilerplate sentence here.");
	cache.put("https://b", "shared boilerplate sentence here.");
	const v = checkNote(cache, "https://a", "shared boilerplate sentence here");
	// It IS verbatim in the claimed page 'a', so that path wins first — records, not ambiguous.
	assert.equal(v.ok, true, "verbatim in the claimed page still records directly");
	// But if claimed for a THIRD unread url, the two hits are ambiguous.
	const v2 = checkNote(cache, "https://c", "shared boilerplate sentence here");
	assert.equal(v2.ok, false);
	assert.equal(!v2.ok && v2.reason, "quote_ambiguous");
	assert.deepEqual(!v2.ok && "urls" in v2 ? v2.urls.sort() : [], ["https://a", "https://b"]);
});

test("a fabricated quote in NO fetched page is still refused (the anti-hallucination invariant holds)", () => {
	const cache = new PageCache();
	cache.put("https://a", "real content only.");
	const v = checkNote(cache, "https://a", "invented text that appears nowhere");
	assert.equal(v.ok, false);
	assert.equal(!v.ok && v.reason, "quote_not_found");
});

/** A mock ketch binary whose scrape returns two distinct pages, so a real
 *  web_read populates the cache and increments the reads counter offline. */
function mockKetchBin(dir: string): string {
	const file = join(dir, "ketch-mock");
	writeFileSync(file, `#!/bin/sh
case "$1" in
  version) printf 'ketch v0.12.0\\n' ;;
  scrape) printf '[{"url":"https://example.com/a","title":"A","markdown":"page a content"}]\\n' ;;
  *) exit 2 ;;
esac
`);
	chmodSync(file, 0o755);
	return file;
}

test("wrap-up steer fires after reads with zero notes; silent once a note is recorded (defect 3)", async () => {
	const dir = mkdtempSync(join(tmpdir(), "rl-steer-"));
	const prevBin = process.env.KETCH_BIN;
	process.env.KETCH_BIN = mockKetchBin(dir);
	const ctxFor = { cwd: dir, ui: { notify() {} } };
	const wrap = { turnIndex: 9, message: { role: "assistant", content: [{ type: "text", text: "Here's my answer." }] }, toolResults: [] };
	try {
		// Reads>0, notes=0 → steer on the text-only wrap-up.
		const fp = await loadKetch(true);
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
		await fire(fp, "session_start", {}, ctxFor);
		await callToolRaw(fp, "web_read", { urls: ["https://example.com/a"] }, dir); // reads -> 1
		await fire(fp, "turn_end", wrap, ctxFor);
		assert.ok(fp.sent.some((m) => m.includes("recorded no verified citations")),
			"a wrap-up after reads with no notes must steer once");
		// A second wrap-up must not nag again.
		const before = fp.sent.length;
		await fire(fp, "turn_end", { ...wrap, turnIndex: 10 }, ctxFor);
		assert.equal(fp.sent.length, before, "steer fires at most once per session");
		resetPiGlobals();

		// Reads>0 AND a note recorded → no steer (don't nag a compliant run).
		const fp2 = await loadKetch(true);
		delete (globalThis as Record<string, unknown>).__pi_ketch_version_checks_v1;
		await fire(fp2, "session_start", {}, ctxFor);
		await callToolRaw(fp2, "web_read", { urls: ["https://example.com/a"] }, dir);
		await callToolRaw(fp2, "research_note", { claim: "c", url: "https://example.com/a", quote: "page a content" }, dir);
		await fire(fp2, "turn_end", wrap, ctxFor);
		assert.equal(fp2.sent.some((m) => m.includes("recorded no verified citations")), false,
			"a run that recorded a note is not nagged");
	} finally {
		if (prevBin === undefined) delete process.env.KETCH_BIN; else process.env.KETCH_BIN = prevBin;
		resetPiGlobals();
	}
});
