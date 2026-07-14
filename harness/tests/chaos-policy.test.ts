import assert from "node:assert/strict";
import test from "node:test";
import { ChaosState, FAULTS, parseChaos } from "../lib/chaos-policy.ts";

test("parseChaos: valid specs parse, everything else is inert", () => {
	assert.deepEqual(parseChaos("read:2:stale-tag"), { tool: "read", nth: 2, fault: "stale-tag" });
	assert.equal(parseChaos(undefined), null);
	assert.equal(parseChaos(""), null);
	assert.equal(parseChaos("read:2:not-a-fault"), null, "unknown fault id must be inert, not throw");
	assert.equal(parseChaos("read:0:stale-tag"), null, "nth is 1-based");
	assert.equal(parseChaos("garbage"), null);
});

test("ChaosState: fires exactly once, on exactly the nth call of the target tool", () => {
	const s = new ChaosState({ tool: "read", nth: 2, fault: "missing-file" });
	assert.equal(s.observe("bash"), null, "other tools never counted");
	assert.equal(s.observe("read"), null, "1st read passes");
	const fault = s.observe("read");
	assert.ok(fault?.includes("ENOENT"), "2nd read gets the fault");
	assert.equal(s.observe("read"), null, "3rd read passes — one-shot");
	assert.equal(s.observe("read"), null, "and stays clean forever after");
	assert.ok(s.hasFired);
});

test("alreadyFired (workdir marker seed): a recovery session cannot re-inject", () => {
	const s = new ChaosState({ tool: "edit", nth: 1, fault: "stale-tag" }, true);
	assert.equal(s.observe("edit"), null, "seeded-fired state never injects again");
	assert.equal(s.observe("edit"), null);
	assert.ok(s.hasFired, "reports fired even though this process never injected");
});

test("fault registry: every fault has realistic non-empty text", () => {
	assert.ok(Object.keys(FAULTS).length >= 5);
	for (const [id, text] of Object.entries(FAULTS)) {
		assert.ok(text.length > 20, `${id} text too short to be a realistic observation`);
	}
	// the stale-tag text mirrors the real hashline error contract (re-read instruction)
	assert.ok(FAULTS["stale-tag"].includes("Read the file again"));
});
