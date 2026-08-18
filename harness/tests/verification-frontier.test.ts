import assert from "node:assert/strict";
import test from "node:test";
import { parseNodeTapSummary, VerificationFrontierTracker } from "../lib/verification-frontier.ts";

const tap = (passed: number, failed: number, skipped = 0, extra = "") => [
	extra,
	`# tests ${passed + failed + skipped}`,
	`# pass ${passed}`,
	`# fail ${failed}`,
	`# skipped ${skipped}`,
].join("\n");

test("parses an internally consistent Node TAP terminal summary", () => {
	assert.deepEqual(parseNodeTapSummary(tap(7, 2, 1)), { passed: 7, failed: 2, skipped: 1, total: 10 });
	assert.deepEqual(parseNodeTapSummary(`\u001b[31m${tap(3, 1)}\u001b[0m`), { passed: 3, failed: 1, skipped: 0, total: 4 });
});

test("rejects partial, contradictory, and merely mentioned TAP summaries", () => {
	assert.equal(parseNodeTapSummary("# pass 2\n# fail 1"), null);
	assert.equal(parseNodeTapSummary("# tests 9\n# pass 8\n# fail 2\n# skipped 0"), null);
	assert.equal(parseNodeTapSummary("documentation says # tests 1"), null);
	assert.equal(parseNodeTapSummary("  # tests 1\n  # pass 1\n  # fail 0\n  # skipped 0"), null);
	assert.equal(parseNodeTapSummary(`${tap(1, 0)}\n# pass 1`), null);
});

test("tracks productive advance separately from a failed-gate plateau", () => {
	const tracker = new VerificationFrontierTracker();
	tracker.noteMutationSettled(true);
	let snapshot = tracker.observeExactGate({ text: tap(3, 3), passed: false, ordered: true });
	assert.equal(snapshot.lastAdvanced, true);
	assert.equal(snapshot.plateauStreak, 0);

	tracker.noteMutationSettled(true);
	snapshot = tracker.observeExactGate({ text: tap(4, 2), passed: false, ordered: true });
	assert.equal(snapshot.lastAdvanced, true);
	assert.equal(snapshot.best?.passed, 4);

	for (let index = 0; index < 3; index += 1) {
		tracker.noteMutationSettled(true);
		snapshot = tracker.observeExactGate({ text: tap(4, 2), passed: false, ordered: true });
	}
	assert.equal(snapshot.plateauStreak, 3);
	tracker.noteToolCall();
	assert.equal(tracker.snapshot().verificationPlateauOverrun, 1);
});

test("unordered, unknown, and successful gates cannot manufacture a plateau", () => {
	const tracker = new VerificationFrontierTracker();
	tracker.noteMutationSettled(true);
	tracker.observeExactGate({ text: tap(1, 1), passed: false, ordered: false });
	assert.equal(tracker.snapshot().recognizedGates, 0);
	tracker.observeExactGate({ text: "FAILED record", passed: false, ordered: true });
	assert.equal(tracker.snapshot().recognizedGates, 0);
	tracker.observeExactGate({ text: tap(2, 0), passed: true, ordered: true });
	assert.equal(tracker.snapshot().plateauStreak, 0);
});
