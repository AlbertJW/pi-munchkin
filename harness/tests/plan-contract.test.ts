import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	compilePlan, localityBrief, nextReady, normalizeInput, parseChildResult, stalled,
	type CompileInput, type WeavePlan,
} from "../lib/plan-contract.ts";

const NOW = "2026-07-17T00:00:00Z";

const good: CompileInput = {
	items: [
		{ id: "s1", title: "find call sites", mode: "explore", deliverable: "list of files" },
		{ id: "s2", title: "add quoting", mode: "execute", inputs: ["src/index.js"], deliverable: "quoted CSV", gate: "node --test", depends_on: ["s1"] },
		{ id: "s3", title: "adversarial check", mode: "verify", deliverable: "verdict", depends_on: ["s2"] },
	],
};

test("compile accepts a well-formed plan", () => {
	const out = compilePlan(good, "req", NOW);
	assert.ok(out.ok);
	if (out.ok) {
		assert.equal(out.plan.items.length, 3);
		assert.equal(out.plan.items[1].gate, "node --test");
		assert.equal(out.plan.phase, "compiled");
	}
});

test("execute items REQUIRE a gate (no unverifiable steps)", () => {
	const out = compilePlan({ items: [{ title: "edit stuff", mode: "execute", deliverable: "d" }] }, "r", NOW);
	assert.ok(!out.ok);
	if (!out.ok) assert.ok(out.errors.some((e) => e.includes("REQUIRE a read-only gate")));
});

test("cycles, unknown deps, dup ids, empty plans are rejected", () => {
	const cyc = compilePlan({ items: [
		{ id: "a", title: "a", depends_on: ["b"] },
		{ id: "b", title: "b", depends_on: ["a"] },
	] }, "r", NOW);
	assert.ok(!cyc.ok && cyc.errors.some((e) => e.includes("cycle")));
	const unk = compilePlan({ items: [{ id: "a", title: "a", depends_on: ["zz"] }] }, "r", NOW);
	assert.ok(!unk.ok && unk.errors.some((e) => e.includes("unknown id")));
	const dup = compilePlan({ items: [{ id: "a", title: "x" }, { id: "a", title: "y" }] }, "r", NOW);
	assert.ok(!dup.ok && dup.errors.some((e) => e.includes("duplicate")));
	const empty = compilePlan({ items: [] }, "r", NOW);
	assert.ok(!empty.ok);
});

test("nextReady walks the DAG in order; stalled detects blocked-on-blocked", () => {
	const out = compilePlan(good, "r", NOW);
	assert.ok(out.ok);
	const plan = (out as { ok: true; plan: WeavePlan }).plan;
	assert.equal(nextReady(plan)?.id, "s1");             // s2/s3 dep-blocked
	plan.items[0].status = "done";
	assert.equal(nextReady(plan)?.id, "s2");
	plan.items[1].status = "blocked";                    // s3 depends on s2 which is blocked
	assert.equal(nextReady(plan), undefined);
	assert.ok(stalled(plan));                            // s3 still pending but nothing dispatchable
	plan.items[2].status = "blocked";
	assert.ok(!stalled(plan));                           // nothing open at all
});

test("normalizeInput: exact wins; unique basename fuzz-resolves; ambiguous stays", () => {
	const d = mkdtempSync(join(tmpdir(), "weave-"));
	try {
		mkdirSync(join(d, "src"));
		mkdirSync(join(d, "other"));
		writeFileSync(join(d, "src/util.js"), "");
		writeFileSync(join(d, "src/dup.js"), "");
		writeFileSync(join(d, "other/dup.js"), "");
		assert.equal(normalizeInput(d, "src/util.js"), "src/util.js");   // exact
		assert.equal(normalizeInput(d, "src/utils.js"), "src/utils.js"); // wrong basename: unchanged (honest miss)
		assert.equal(normalizeInput(d, "lib/util.js"), "src/util.js");   // unique basename found
		assert.equal(normalizeInput(d, "lib/dup.js"), "lib/dup.js");     // ambiguous: unchanged
	} finally { rmSync(d, { recursive: true, force: true }); }
});

test("parseChildResult: contract respected, malformed -> blocked (never trust)", () => {
	assert.equal(parseChildResult("RESULT: done — patched\nCHANGED: src/x.js").result, "done");
	assert.equal(parseChildResult("RESULT: blocked — need input").result, "blocked");
	assert.equal(parseChildResult("I think I finished everything!").result, "blocked");
	assert.equal(parseChildResult("").result, "blocked");
});

test("localityBrief embeds the failing output (stateful, never a static continue)", () => {
	const b = localityBrief("node --test", "AssertionError: expected 0 to equal 6");
	assert.ok(b.includes("node --test"));
	assert.ok(b.includes("expected 0 to equal 6"));
	assert.ok(b.includes("ONE bounded edit"));
});
