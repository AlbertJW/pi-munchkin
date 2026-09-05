import assert from "node:assert/strict";
import test from "node:test";
import { dirname } from "node:path";
import { researchReservationRoot } from "../lib/research-reservations.ts";

test("dot run identifiers cannot escape or collapse research reservation namespaces", () => {
	const env = { PI_CODING_AGENT_DIR: "/tmp/unused-reservation-fixture" };
	const normal = researchReservationRoot("/project", "run-1", env);
	const dot = researchReservationRoot("/project", ".", env);
	const parent = researchReservationRoot("/project", "..", env);
	assert.equal(dirname(dot), dirname(normal));
	assert.equal(dirname(parent), dirname(normal));
	assert.notEqual(dot, parent);
});
