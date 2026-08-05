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
