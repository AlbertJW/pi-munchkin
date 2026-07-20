import { test } from "node:test";
import assert from "node:assert/strict";
import { planIntegrity, executionUnderway, normalizeTitle, preserveDecision, type IntegrityItem } from "../lib/plan-integrity.ts";

const item = (title: string, status: string): IntegrityItem => ({ title, status });

test("healthy rewrite that re-emits the whole list drops nothing", () => {
	const prev = [item("a", "done"), item("b", "in_progress"), item("c", "pending")];
	const reconciled = [item("a", "done"), item("b", "done"), item("c", "pending")];
	const { reattached, droppedOpen } = planIntegrity(prev, reconciled);
	assert.equal(reattached.length, 0);
	assert.equal(droppedOpen.length, 0);
});

test("the 2026-06-22 shape: 9→2 rewrite preserves done, flags dropped open", () => {
	const prev = [
		item("j1", "done"),
		item("j2", "done"),
		item("j3", "done"),
		item("j4", "in_progress"),
		item("j5", "pending"),
		item("j6", "pending"),
		item("j7", "pending"),
		item("j8", "pending"),
		item("j9", "pending"),
	];
	const reconciled = [item("j5", "pending"), item("j6", "pending")]; // model collapsed to 2
	const { reattached, droppedOpen } = planIntegrity(prev, reconciled);
	assert.deepEqual(reattached.map((i) => i.title), ["j1", "j2", "j3"]); // completed work survives
	assert.deepEqual(droppedOpen.map((i) => i.title), ["j4", "j7", "j8", "j9"]); // open work flagged
});

test("blocked items are treated as open work — flagged for the caller's preserve/yield net, not silently dropped", () => {
	const prev = [item("a", "done"), item("b", "blocked")];
	const reconciled = [item("c", "pending")];
	const { reattached, droppedOpen } = planIntegrity(prev, reconciled);
	assert.deepEqual(reattached.map((i) => i.title), ["a"]);
	assert.deepEqual(droppedOpen.map((i) => i.title), ["b"]);
});

test("first plan (no prev) is clean", () => {
	const { reattached, droppedOpen } = planIntegrity([], [item("a", "pending")]);
	assert.equal(reattached.length, 0);
	assert.equal(droppedOpen.length, 0);
});

test("executionUnderway: true once any item is done or in_progress", () => {
	assert.equal(executionUnderway([item("a", "done"), item("b", "pending")]), true);
	assert.equal(executionUnderway([item("a", "in_progress")]), true);
});

test("executionUnderway: false while still drafting (all pending or empty)", () => {
	assert.equal(executionUnderway([item("a", "pending"), item("b", "pending")]), false);
	assert.equal(executionUnderway([]), false);
});

test("during execution, an omitted open item is in droppedOpen so the caller preserves it", () => {
	// mid-run: item 1 done, items 2-3 still open; model re-emits only item 1 (the 9→2 shape)
	const prev = [item("step1", "done"), item("step2", "in_progress"), item("step3", "pending")];
	const reconciled = [item("step1", "done")];
	const { droppedOpen } = planIntegrity(prev, reconciled);
	assert.equal(executionUnderway(prev), true);
	assert.deepEqual(droppedOpen.map((i) => i.title), ["step2", "step3"]);
});

test("normalizeTitle collapses cosmetic differences (backticks, case, whitespace)", () => {
	assert.equal(normalizeTitle("Run `just reindex`"), normalizeTitle("run just reindex"));
	assert.equal(normalizeTitle("  Fix   Links  "), normalizeTitle("fix links"));
	assert.notEqual(normalizeTitle("reindex"), normalizeTitle("reconcile"));
});

test("F1: a renamed done item (backticks) is NOT flagged dropped — no false re-attach/dup", () => {
	// the live 2026-06-22 shape: model re-emits the reindex step with backticks
	const prev = [item("Reconcile: run just reindex", "done"), item("Compress: trim hot.md", "pending")];
	const reconciled = [item("Reconcile: run `just reindex`", "done"), item("Compress: trim hot.md", "in_progress")];
	const { reattached, droppedOpen } = planIntegrity(prev, reconciled);
	assert.equal(reattached.length, 0); // renamed done item matched → not re-attached → no duplicate
	assert.equal(droppedOpen.length, 0);
});

test("F3 preserveDecision: a fresh omission is preserved at count 1", () => {
	const { preserve, yielded } = preserveDecision([{ title: "Job 2", preserve_count: undefined }], 3);
	assert.equal(yielded.length, 0);
	assert.equal(preserve.length, 1);
	assert.equal(preserve[0].preserve_count, 1);
});

test("F3 preserveDecision: below max keeps preserving, incrementing", () => {
	const { preserve, yielded } = preserveDecision([{ title: "Job 2", preserve_count: 1 }], 3);
	assert.equal(yielded.length, 0);
	assert.equal(preserve[0].preserve_count, 2);
});

test("F3 preserveDecision: at max it yields (persistent omission = intent) — breaks the deadlock", () => {
	const { preserve, yielded } = preserveDecision([{ title: "Job 2", preserve_count: 2 }], 3);
	assert.equal(preserve.length, 0);
	assert.deepEqual(yielded.map((i) => i.title), ["Job 2"]);
});

test("F3 preserveDecision: mixed batch splits correctly", () => {
	const { preserve, yielded } = preserveDecision(
		[{ title: "fresh" }, { title: "old", preserve_count: 2 }],
		3,
	);
	assert.deepEqual(preserve.map((i) => i.title), ["fresh"]);
	assert.deepEqual(yielded.map((i) => i.title), ["old"]);
});
