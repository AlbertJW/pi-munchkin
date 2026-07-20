import assert from "node:assert/strict";
import test from "node:test";
import compactTool from "../extensions/compact-tool.ts";
import { registerContextWatcher } from "../extensions/context-watcher.ts";
import { resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { fire, makeFakePi } from "./integration-harness.ts";

function setup() {
	resetCompactionCoordinator();
	const fp = makeFakePi();
	compactTool(fp.pi as any);
	let calls = 0;
	let options: any;
	const notes: string[] = [];
	const ctx = {
		cwd: "/tmp/compact-tool-test",
		ui: { notify: (message: string) => notes.push(message) },
		compact: (value: unknown) => { calls += 1; options = value; },
	};
	const execute = (focus?: string) => fp.tools.get("compact_context")
		.execute("tc", { focus }, undefined, undefined, ctx);
	return { fp, ctx, notes, execute, get calls() { return calls; }, get options() { return options; } };
}

test("compact_context deduplicates and resumes exactly once after completion", async () => {
	const h = setup();
	await fire(h.fp, "session_start", {});
	const first = await h.execute();
	const duplicate = await h.execute();
	assert.equal(h.calls, 1);
	assert.match(first.content[0].text, /tool turn will stop/);
	assert.equal(duplicate.details.duplicate, true);

	h.options.onComplete({ tokensBefore: 9000, estimatedTokensAfter: 2500 });
	h.options.onComplete({ tokensBefore: 9000, estimatedTokensAfter: 2500 });
	h.options.onError(new Error("late duplicate callback"));
	assert.equal(h.fp.customDeliveries.length, 1);
	assert.equal(h.fp.customDeliveries[0].triggerTurn, true);
	assert.equal(h.fp.customDeliveries[0].deliverAs, "nextTurn");
	assert.deepEqual((h.fp.customDeliveries[0].message as any).details,
		{ status: "complete", tokensBefore: 9000, estimatedTokensAfter: 2500 });
	assert.match((h.fp.customDeliveries[0].message as any).content, /Do not repeat completed work/);

	await h.execute();
	assert.equal(h.calls, 2, "completion must re-arm a future explicit request");
});

test("compact_context resumes after failure because Pi already aborted the turn", async () => {
	const h = setup();
	await h.execute();
	h.options.onError(new Error("summary backend unavailable"));
	assert.equal(h.fp.customDeliveries.length, 1);
	assert.deepEqual((h.fp.customDeliveries[0].message as any).details,
		{ status: "failed", error: "summary backend unavailable" });
	assert.match(h.notes[0], /compact failed/);
});

test("default compaction focus is a structured recall-first capsule", async () => {
	const h = setup();
	await h.execute();
	assert.match(h.options.customInstructions, /active task and constraints/);
	assert.match(h.options.customInstructions, /changed paths and exact identifiers/);
	assert.match(h.options.customInstructions, /verified commands\/results/);
	assert.match(h.options.customInstructions, /unresolved errors or blockers/);
	assert.match(h.options.customInstructions, /next action/);
});

test("session replacement clears an orphaned in-flight latch", async () => {
	const h = setup();
	await h.execute();
	const stale = h.options;
	assert.equal((await h.execute()).details.duplicate, true);
	await fire(h.fp, "session_start", {});
	stale.onComplete({ tokensBefore: 9000, estimatedTokensAfter: 2500 });
	assert.equal(h.fp.customDeliveries.length, 0, "old-session callback must not resume the new session");
	await h.execute();
	assert.equal(h.calls, 2);
	h.options.onComplete({ tokensBefore: 6000, estimatedTokensAfter: 2000 });
	assert.equal(h.fp.customDeliveries.length, 1);
});

test("compact tool and watcher share one process-wide compaction slot", async () => {
	const h = setup();
	const events: string[] = [];
	registerContextWatcher(
		h.fp.pi as any,
		{ enabled: true, thresholdPct: 70, rearmPct: 55 },
		(_ext, kind) => { events.push(kind); },
	);
	await fire(h.fp, "session_start", { reason: "startup" }, {
		getContextUsage: () => ({ tokens: 0, contextWindow: 1000, percent: 0 }),
	});
	await h.execute();
	let watcherCalls = 0;
	await fire(h.fp, "turn_end", { toolResults: [{}] }, {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: () => { watcherCalls += 1; },
		ui: { notify() {} },
	});
	assert.equal(h.calls, 1);
	assert.equal(watcherCalls, 0);
	assert.equal(events.filter((kind) => kind === "compact-suppressed").length, 1);
	h.options.onError(new Error("summary backend unavailable"));
	await fire(h.fp, "turn_end", { toolResults: [] }, {
		getContextUsage: () => ({ tokens: 750, contextWindow: 1000, percent: 75 }),
		compact: () => { watcherCalls += 1; },
		ui: { notify() {} },
	});
	assert.equal(watcherCalls, 1, "suppression must not permanently disarm watcher after another caller fails");
});

test("synchronous compact failure releases the shared slot", async () => {
	resetCompactionCoordinator();
	const fp = makeFakePi();
	compactTool(fp.pi as any);
	let calls = 0;
	const ctx = {
		ui: { notify() {} },
		compact: () => { calls += 1; throw new Error("cannot start"); },
	};
	const execute = () => fp.tools.get("compact_context").execute("tc", {}, undefined, undefined, ctx);
	const first = await execute();
	assert.equal(first.details.queued, false);
	await execute();
	assert.equal(calls, 2, "a synchronous failure must not wedge future requests");
});
