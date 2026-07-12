import assert from "node:assert/strict";
import test from "node:test";
import { decideOutcomeAction } from "../lib/loop-outcome.ts";

test("outcome ladder: steer at T1 and 2xT1, escalate at 3xT1, silent between and after", () => {
	const T1 = 3;
	// walk n=1..12 tracking fired like the extension does
	let fired = 0;
	const log: string[] = [];
	for (let n = 1; n <= 12; n++) {
		const a = decideOutcomeAction(n, fired, T1);
		if (a !== "none") {
			log.push(`${n}:${a}`);
			fired += 1;
		}
	}
	assert.deepEqual(log, ["3:steer", "6:steer", "9:escalate"], log.join(","));
});

test("outcome ladder: nothing fires below T1 or after escalation", () => {
	assert.equal(decideOutcomeAction(2, 0, 3), "none");
	assert.equal(decideOutcomeAction(50, 3, 3), "none", "post-escalation stays silent");
});

test("outcome ladder: late-start fired state cannot skip the escalation gate", () => {
	// fired=1 at very high n -> second steer (not escalate) so the ladder is honored
	assert.equal(decideOutcomeAction(30, 1, 3), "steer");
	assert.equal(decideOutcomeAction(30, 2, 3), "escalate");
});
