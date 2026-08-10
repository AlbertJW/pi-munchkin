import assert from "node:assert/strict";
import test from "node:test";
import {
	FailureEpisodeTracker, classifyFailure, episodeKey, isFailureObservation,
	type FailureObservation,
} from "../lib/failure-episodes.ts";

function failure(overrides: Partial<FailureObservation> = {}): FailureObservation {
	return {
		toolName: "bash",
		args: { command: "npm test" },
		text: "1 failing AssertionError: expected true",
		isError: true,
		planItemId: "item-1",
		...overrides,
	};
}

function exposeVerification(tracker: FailureEpisodeTracker, planItemId = "item-1"): void {
	tracker.observeFailure(failure({ args: { command: "npm test" }, planItemId }));
	tracker.observeFailure(failure({ args: { command: "pnpm test" }, planItemId }));
}

function exposeRead(tracker: FailureEpisodeTracker, path: string, planItemId = "item-1"): void {
	for (let attempt = 0; attempt < 2; attempt++) {
		tracker.observeFailure(failure({
			toolName: "read",
			args: { path },
			text: "permission denied",
			failureClass: "permission",
			planItemId,
		}));
	}
}

test("different verification commands join one semantic failure episode", () => {
	const tracker = new FailureEpisodeTracker();
	const first = tracker.observeFailure(failure());
	const second = tracker.observeFailure(failure({ args: { command: "pnpm test" } }));
	assert.equal(first.opened, true);
	assert.equal(second.opened, false);
	assert.equal(second.episode.id, first.episode.id);
	assert.equal(second.episode.count, 2);
	assert.equal(second.episode.strategyHashes.length, 2, "changed commands remain distinct strategies");
});

test("identical result text remains separate when failure classes differ", () => {
	const tracker = new FailureEpisodeTracker();
	const text = "operation failed";
	const permission = tracker.observeFailure(failure({ text, failureClass: "permission" })).episode;
	const timeout = tracker.observeFailure(failure({ text, failureClass: "timeout" })).episode;
	assert.notEqual(permission.id, timeout.id);
	assert.equal(tracker.snapshot().active.length, 2);
	assert.notEqual(
		episodeKey(permission),
		episodeKey(timeout),
	);
});

test("successful mutation does not close a failing verification episode", () => {
	const tracker = new FailureEpisodeTracker();
	tracker.observeFailure(failure());
	const recovered = tracker.observeSuccess({ toolName: "edit", args: { path: "src/app.ts" } });
	assert.equal(recovered.length, 0);
	assert.equal(tracker.snapshot().active.length, 1);
});

test("successful exact gate closes verification and unknown episodes", () => {
	const tracker = new FailureEpisodeTracker();
	tracker.observeFailure(failure());
	tracker.observeFailure(failure({ toolName: "write", args: { path: "src/app.ts" }, text: "opaque", failureClass: "unknown" }));
	const recovered = tracker.observeSuccess(
		{ toolName: "bash", args: { command: "npm test" }, verifiedExact: true },
		"exact_gate",
	);
	assert.equal(recovered.length, 2);
	assert.ok(recovered.every((episode) => episode.recovery === "exact_gate"));
	assert.equal(tracker.snapshot().active.length, 0);
});

test("successful inspection output containing FAILED is not a failure", () => {
	const observation = failure({
		args: { command: "rg FAILED records.txt" },
		text: "FAILED record",
		isError: false,
	});
	assert.equal(isFailureObservation(observation), false);
});

test("classification uses a stable safe taxonomy", () => {
	assert.equal(classifyFailure(failure({ text: "Invalid input: required property items" })), "schema_validation");
	assert.equal(classifyFailure(failure({ text: "Permission denied (EACCES)" })), "permission");
	assert.equal(classifyFailure(failure({ text: "command not found: widget" })), "command_missing");
	assert.equal(classifyFailure(failure({ text: "error TS2322: type mismatch" })), "compile_or_lint");
	assert.equal(classifyFailure(failure({ text: "AssertionError: expected 1 actual 2" })), "verification_assertion");
});

test("snapshot contains hashes and safe classes, never raw arguments or output", () => {
	const tracker = new FailureEpisodeTracker();
	tracker.observeFailure(failure({
		args: { command: "npm test -- DUMMY_EPISODE_VALUE_DO_NOT_PERSIST" },
		text: "DUMMY_RESULT_VALUE_DO_NOT_PERSIST",
	}));
	const serialized = JSON.stringify(tracker.snapshot());
	assert.equal(serialized.includes("DUMMY_EPISODE_VALUE_DO_NOT_PERSIST"), false);
	assert.equal(serialized.includes("DUMMY_RESULT_VALUE_DO_NOT_PERSIST"), false);
	assert.match(serialized, /verification_assertion/);
});

test("no exposed episode returns before inspecting or bounding arguments", () => {
	const tracker = new FailureEpisodeTracker();
	const inaccessible = new Proxy({}, {
		ownKeys() { throw new Error("arguments were inspected"); },
		getOwnPropertyDescriptor() { throw new Error("arguments were inspected"); },
	});
	tracker.noteToolCall({ toolName: "read", args: inaccessible, planItemId: "item-1" });
	assert.equal(tracker.snapshot().semanticFailureOverrun, 0);
	assert.equal(tracker.snapshot().correlatedFailureOverrun, 0);
});

test("unrelated work increments only the preregistered session-window overrun", () => {
	const tracker = new FailureEpisodeTracker();
	exposeVerification(tracker);
	tracker.noteToolCall({ toolName: "read", args: { path: "src/other.ts" }, planItemId: "item-1" });
	const snapshot = tracker.snapshot();
	assert.equal(snapshot.v, 2);
	assert.equal(snapshot.semanticFailureOverrun, 1);
	assert.equal(snapshot.correlatedFailureOverrun, 0);
	assert.equal(snapshot.active[0]?.callsAfterSecond, 1);
	assert.equal(snapshot.active[0]?.correlatedCallsAfterSecond, 0);
});

test("same family, target, and plan item increments both overrun counters", () => {
	const tracker = new FailureEpisodeTracker();
	exposeVerification(tracker);
	tracker.noteToolCall({
		toolName: "bash",
		args: { command: "npm run test -- --changed-strategy" },
		planItemId: "item-1",
	});
	const snapshot = tracker.snapshot();
	assert.equal(snapshot.semanticFailureOverrun, 1);
	assert.equal(snapshot.correlatedFailureOverrun, 1);
	assert.equal(snapshot.active[0]?.correlatedCallsAfterSecond, 1);
});

test("the eventual successful recovery call remains inside both overrun windows", () => {
	const tracker = new FailureEpisodeTracker();
	exposeRead(tracker, "src/a.ts");
	tracker.noteToolCall({ toolName: "read", args: { path: "src/a.ts" }, planItemId: "item-1" });
	const recovered = tracker.observeSuccess({ toolName: "read", args: { path: "src/a.ts" } });
	assert.equal(recovered.length, 1);
	assert.equal(recovered[0]?.callsAfterSecond, 1);
	assert.equal(recovered[0]?.correlatedCallsAfterSecond, 1);
	assert.equal(tracker.snapshot().semanticFailureOverrun, 1);
	assert.equal(tracker.snapshot().correlatedFailureOverrun, 1);
	assert.equal(tracker.snapshot().active.length, 0);
});

test("a changed target or active plan item is not correlated", () => {
	const targetTracker = new FailureEpisodeTracker();
	exposeRead(targetTracker, "src/a.ts");
	targetTracker.noteToolCall({ toolName: "read", args: { path: "src/b.ts" }, planItemId: "item-1" });
	assert.equal(targetTracker.snapshot().semanticFailureOverrun, 1);
	assert.equal(targetTracker.snapshot().correlatedFailureOverrun, 0);

	const itemTracker = new FailureEpisodeTracker();
	exposeVerification(itemTracker, "item-1");
	itemTracker.noteToolCall({ toolName: "bash", args: { command: "npm test" }, planItemId: "item-2" });
	assert.equal(itemTracker.snapshot().semanticFailureOverrun, 1);
	assert.equal(itemTracker.snapshot().correlatedFailureOverrun, 0);
});

test("multiple exposed episodes count one window call and each matching episode independently", () => {
	const tracker = new FailureEpisodeTracker();
	exposeRead(tracker, "src/a.ts");
	exposeRead(tracker, "src/b.ts");
	tracker.noteToolCall({ toolName: "read", args: { path: "src/a.ts" }, planItemId: "item-1" });
	const snapshot = tracker.snapshot();
	assert.equal(snapshot.semanticFailureOverrun, 1, "the session-window call is global, not per episode");
	assert.equal(snapshot.correlatedFailureOverrun, 1, "one call is counted once even when episodes coexist");
	const byTarget = new Map(snapshot.active.map((episode) => [episode.targetHash, episode]));
	const targetA = targetTrackerHash("src/a.ts");
	const targetB = targetTrackerHash("src/b.ts");
	assert.equal(byTarget.get(targetA)?.callsAfterSecond, 1);
	assert.equal(byTarget.get(targetA)?.correlatedCallsAfterSecond, 1);
	assert.equal(byTarget.get(targetB)?.callsAfterSecond, 1);
	assert.equal(byTarget.get(targetB)?.correlatedCallsAfterSecond, 0);
});

function targetTrackerHash(path: string): string {
	const probe = new FailureEpisodeTracker();
	return probe.observeFailure(failure({
		toolName: "read", args: { path }, failureClass: "permission", planItemId: "item-1",
	})).episode.targetHash;
}

test("recovery, settlement, manual resume, and reset clear exposed state", () => {
	for (const clear of ["recovery", "settlement", "resume"] as const) {
		const tracker = new FailureEpisodeTracker();
		exposeRead(tracker, "src/a.ts");
		if (clear === "recovery") tracker.observeSuccess({ toolName: "read", args: { path: "src/a.ts" } });
		else if (clear === "settlement") tracker.settle();
		else tracker.clearActive();
		tracker.noteToolCall({ toolName: "read", args: { path: "src/a.ts" }, planItemId: "item-1" });
		assert.equal(tracker.snapshot().semanticFailureOverrun, 0, `${clear} left an exposed episode`);
	}

	const reset = new FailureEpisodeTracker();
	exposeVerification(reset);
	reset.noteToolCall({ toolName: "bash", args: { command: "npm test" }, planItemId: "item-1" });
	reset.reset();
	assert.deepEqual(reset.snapshot(), {
		v: 2,
		totalEpisodes: 0,
		totalFailures: 0,
		longestEpisode: 0,
		semanticFailureOverrun: 0,
		correlatedFailureOverrun: 0,
		settledWithoutRecovery: 0,
		active: [],
		completed: [],
	});
});
