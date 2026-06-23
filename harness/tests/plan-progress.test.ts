import { test } from "node:test";
import assert from "node:assert/strict";
import { nextReplanStreak } from "../lib/plan-progress.ts";

test("a call that completes nothing bumps the streak; warns at max", () => {
	let s = 0;
	({ streak: s } = nextReplanStreak(s, 0, 3)); // 1
	assert.equal(s, 1);
	({ streak: s } = nextReplanStreak(s, 0, 3)); // 2
	assert.equal(s, 2);
	const r = nextReplanStreak(s, 0, 3); // 3 → warn
	assert.equal(r.streak, 3);
	assert.equal(r.warn, true);
});

test("completing an item resets the streak and clears the warning", () => {
	const r = nextReplanStreak(5, 1, 3);
	assert.equal(r.streak, 0);
	assert.equal(r.warn, false);
});

test("below max never warns", () => {
	assert.equal(nextReplanStreak(0, 0, 3).warn, false);
	assert.equal(nextReplanStreak(1, 0, 3).warn, false);
});

test("stays warning while thrash continues past max", () => {
	assert.equal(nextReplanStreak(3, 0, 3).warn, true); // 4 ≥ 3
});
