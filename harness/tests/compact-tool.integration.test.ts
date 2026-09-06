import assert from "node:assert/strict";
import test from "node:test";
import compactTool from "../extensions/compact-tool.ts";
import { resetCompactionCoordinator } from "../lib/compaction-coordinator.ts";
import { fire, makeFakePi } from "./integration-harness.ts";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The unit fixture does not load run-capsule. Pin the documented storage
// rollback so goal-state lookup has a deterministic private location.
process.env.PLAN_STORAGE = "project";
import { onContinuationRequest, setContinuationDispatcherActive, type ContinuationEnvelope } from "../lib/continuation-authority.ts";

async function flushAsync(): Promise<void> {
	for (let turn = 0; turn < 4; turn += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

function setup() {
	resetCompactionCoordinator();
	const fp = makeFakePi();
	compactTool(fp.pi as any);
	setContinuationDispatcherActive(fp.pi.events as never, true);
	const offers: ContinuationEnvelope[] = [];
	onContinuationRequest(fp.pi.events as never, (offer) => offers.push(offer));
	let calls = 0;
	let options: any;
	const notes: string[] = [];
	const ctx = {
		cwd: mkdtempSync(join(tmpdir(), "pi-compact-tool-")),
		ui: { notify: (message: string) => notes.push(message) },
		compact: (value: unknown) => { calls += 1; options = value; },
	};
	const execute = (focus?: string) => fp.tools.get("compact_context")
		.execute("tc", { focus }, undefined, undefined, ctx);
	return { fp, ctx, notes, offers, execute, get calls() { return calls; }, get options() { return options; } };
}

test("compact_context deduplicates and resumes exactly once after completion", { concurrency: false }, async () => {
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
	await flushAsync();
	assert.equal(h.fp.customDeliveries.length, 0, "compaction cannot bypass the authority with a private follow-up");
	assert.equal(h.offers.length, 1);
	assert.match(h.offers[0]!.request.message, /Do not repeat completed work/);

	await h.execute();
	assert.equal(h.calls, 2, "completion must re-arm a future explicit request");
	h.options.onComplete({ tokensBefore: 2500, estimatedTokensAfter: 1000 });
	await flushAsync();
});

test("compact_context resumes after failure because Pi already aborted the turn", { concurrency: false }, async () => {
	const h = setup();
	await h.execute();
	const secret = "DUMMY_COMPACTION_SECRET";
	h.options.onError(new Error(`provider unavailable at https://private.invalid/v1?token=${secret} /Users/alice/private.txt`));
	await flushAsync();
	assert.equal(h.offers.length, 1);
	assert.match(h.notes[0], /compaction failed \(failure_class=provider\)/);
	const visible = JSON.stringify({ notes: h.notes, offers: h.offers });
	assert.doesNotMatch(visible, /DUMMY_COMPACTION_SECRET|private\.invalid|\/Users\/alice/);
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

test("session replacement clears an orphaned in-flight latch", { concurrency: false }, async () => {
	const h = setup();
	await h.execute();
	const stale = h.options;
	assert.equal((await h.execute()).details.duplicate, true);
	await fire(h.fp, "session_start", {});
	stale.onComplete({ tokensBefore: 9000, estimatedTokensAfter: 2500 });
	await flushAsync();
	assert.equal(h.offers.length, 0, "old-session callback must not resume the new session");
	await h.execute();
	assert.equal(h.calls, 2);
	h.options.onComplete({ tokensBefore: 6000, estimatedTokensAfter: 2000 });
	await flushAsync();
	assert.equal(h.offers.length, 1);
});

test("synchronous compact failure releases the shared slot", async () => {
	resetCompactionCoordinator();
	const fp = makeFakePi();
	compactTool(fp.pi as any);
	let calls = 0;
	const notes: string[] = [];
	const secret = "DUMMY_SYNC_COMPACTION_SECRET";
	const ctx = {
		cwd: "/tmp/compact-tool-sync-failure-test",
		ui: { notify(message: string) { notes.push(message); } },
		compact: () => { calls += 1; throw new Error(`timeout at https://private.invalid/?key=${secret} /tmp/private`); },
	};
	const execute = () => fp.tools.get("compact_context").execute("tc", {}, undefined, undefined, ctx);
	const first = await execute();
	assert.equal(first.details.queued, false);
	assert.equal(first.details.failureClass, "timeout");
	assert.match(first.content[0].text, /failure_class=timeout/);
	assert.doesNotMatch(JSON.stringify({ first, notes }), /DUMMY_SYNC_COMPACTION_SECRET|private\.invalid|\/tmp\/private/);
	await execute();
	assert.equal(calls, 2, "a synchronous failure must not wedge future requests");
});
