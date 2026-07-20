import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildCapsule } from "../src/capsule.js";

function evidence() {
	const rows = {};
	for (let index = 1; index <= 8; index += 1) {
		const text = readFileSync(new URL(`../evidence/part-${index}.txt`, import.meta.url), "utf8");
		const match = text.match(/^AUTHORITATIVE ([A-Z_]+)=(.+)$/m);
		assert.ok(match, `missing authoritative record in part-${index}`);
		rows[match[1]] = match[2];
	}
	return rows;
}

test("capsule retains every exact long-horizon identifier", () => {
	assert.deepEqual(buildCapsule(evidence()), {
		project: "KITE-731",
		owner: "north-star",
		checkpoint: "quartz-19",
		mode: "strict-json",
		rollback: "amber-44",
		state: "ready-for-canary",
		invariant: "preserve-leading-zeroes",
		next: "run-readonly-canary",
	});
});
