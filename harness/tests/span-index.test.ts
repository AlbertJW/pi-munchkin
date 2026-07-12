import assert from "node:assert/strict";
import test from "node:test";
import { contentTag, MAX_MATCHES, MAX_OUT_BYTES, MAX_SPAN_LINES, readSpan, searchSpans } from "../lib/span-index.ts";

const corpus = Array.from({ length: 500 }, (_, i) => `line ${i + 1} ${i % 7 === 0 ? "NEEDLE" : "hay"}`).join("\n");

test("searchSpans caps matches but reports the true total", () => {
	const { matches, total } = searchSpans(corpus, "NEEDLE");
	assert.equal(total, 72); // ceil(500/7)
	assert.equal(matches.length, MAX_MATCHES);
	assert.equal(matches[0].line, 1);
});

test("searchSpans truncates long lines and bounds total bytes", () => {
	const big = Array.from({ length: 100 }, () => `x${"y".repeat(1000)}`).join("\n");
	const { matches } = searchSpans(big, "x");
	assert.ok(matches.every((m) => m.text.length <= 201));
	const bytes = matches.reduce((n, m) => n + m.text.length, 0);
	assert.ok(bytes <= MAX_OUT_BYTES, `${bytes} > cap`);
});

test("readSpan clamps to caps and bounds, numbers absolutely, carries provenance", () => {
	const { header, body, start, end } = readSpan(corpus, 490, 9999);
	assert.equal(start, 490);
	assert.equal(end, 500);
	assert.ok(body.startsWith("490:"));
	assert.ok(header.includes(`lines 490-500/500`));
	assert.ok(header.includes(contentTag(corpus)));

	const wide = readSpan(corpus, 1, 9999);
	assert.equal(wide.end - wide.start + 1 <= MAX_SPAN_LINES, true);
});

test("readSpan byte cap trims the range and reports the honest end", () => {
	const fat = Array.from({ length: 300 }, () => "z".repeat(200)).join("\n");
	const { body, end, header } = readSpan(fat, 1, 300);
	assert.ok(body.length <= MAX_OUT_BYTES + 210);
	assert.ok(end < 300);
	assert.ok(header.includes(`1-${end}/300`));
});
