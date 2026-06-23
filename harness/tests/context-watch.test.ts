import assert from "node:assert/strict";
import test from "node:test";
import { decide } from "../lib/context-watch.ts";

// Run: cd ~/.pi/agent && npx -y tsx --test tests/context-watch.test.ts

const T = 70;
const R = 55;

test("fires once at threshold, then disarms", () => {
	assert.deepEqual(decide(70, true, T, R), { compact: true, armed: false });
	assert.deepEqual(decide(85, true, T, R), { compact: true, armed: false });
});

test("does not re-fire while still high and disarmed", () => {
	assert.deepEqual(decide(90, false, T, R), { compact: false, armed: false });
	assert.deepEqual(decide(72, false, T, R), { compact: false, armed: false });
});

test("re-arms only after dropping below rearm band", () => {
	assert.deepEqual(decide(60, false, T, R), { compact: false, armed: false }); // 60 ≥ rearm 55 → still disarmed
	assert.deepEqual(decide(54, false, T, R), { compact: false, armed: true }); // < 55 → re-armed
});

test("below threshold while armed does nothing", () => {
	assert.deepEqual(decide(50, true, T, R), { compact: false, armed: true });
	assert.deepEqual(decide(69, true, T, R), { compact: false, armed: true });
});

test("null/NaN percent is a no-op (preserves armed state)", () => {
	assert.deepEqual(decide(null, true, T, R), { compact: false, armed: true });
	assert.deepEqual(decide(null, false, T, R), { compact: false, armed: false });
	assert.deepEqual(decide(Number.NaN, true, T, R), { compact: false, armed: true });
});

test("full thrash cycle: fire → stay quiet → re-arm → fire again", () => {
	let a = true;
	let r = decide(75, a, T, R); a = r.armed;
	assert.equal(r.compact, true); // fired
	r = decide(40, a, T, R); a = r.armed; // post-compaction drop → re-arm
	assert.equal(a, true);
	r = decide(71, a, T, R); a = r.armed;
	assert.equal(r.compact, true); // fires again on next climb
});
