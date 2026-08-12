import assert from "node:assert/strict";
import test from "node:test";
import { selectHighestLoopAction, type LoopActionCandidate } from "../lib/loop-action.ts";

test("highest loop tier wins regardless of detector", () => {
	const candidates: LoopActionCandidate[] = [
		{ tier: 1, detector: "exact_outcome", effect: "steer" },
		{ tier: 3, detector: "cumulative_session", effect: "abort" },
		{ tier: 2, detector: "exact_call", effect: "block" },
	];
	assert.equal(selectHighestLoopAction(candidates), candidates[1]);
});

test("equal tiers prefer abort, then outcome, exact call, semantic, and cumulative", () => {
	const candidates: LoopActionCandidate[] = [
		{ tier: 2, detector: "cumulative_session", effect: "steer" },
		{ tier: 2, detector: "semantic_episode", effect: "steer" },
		{ tier: 2, detector: "exact_call", effect: "block" },
		{ tier: 2, detector: "exact_outcome", effect: "steer" },
	];
	assert.equal(selectHighestLoopAction(candidates), candidates[3]);
	const abort = { tier: 2, detector: "cumulative_session", effect: "abort" } as const;
	assert.equal(selectHighestLoopAction([...candidates, abort]), abort);
});

test("stable exact ties preserve the first candidate", () => {
	const first = { tier: 1, detector: "exact_call", effect: "steer", id: "first" } as const;
	const second = { ...first, id: "second" } as const;
	assert.equal(selectHighestLoopAction([first, second]), first);
});
