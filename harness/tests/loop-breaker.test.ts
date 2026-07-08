import assert from "node:assert/strict";
import test from "node:test";
import { thresh, resolveStopMode, fpKey, decideTier, type Thresholds } from "../extensions/loop-breaker.ts";

const TH: Thresholds = { t1: 2, t2: 3, t3: 5, streakSoft: 8, streakHard: 20 }; // local defaults

test("fpKey: read pagination (different offsets) does NOT collide", () => {
	// The read tool truncates large files and instructs "continue with offset=N";
	// paginating must NOT look like a repeated call.
	const p0 = fpKey("read", { path: "src/app.ts", offset: 0 });
	const p1 = fpKey("read", { path: "src/app.ts", offset: 2000 });
	const p2 = fpKey("read", { path: "src/app.ts", offset: 4000 });
	assert.notEqual(p0, p1);
	assert.notEqual(p1, p2);
});

test("fpKey: verbatim re-read (same offset) DOES collide", () => {
	assert.equal(fpKey("read", { path: "a.ts" }), fpKey("read", { path: "a.ts", offset: 0 }));
	assert.equal(fpKey("read", { path: "a.ts", offset: 50 }), fpKey("read", { path: "a.ts", offset: 50 }));
});

test("decideTier: reasoning repetition steers but NEVER blocks a fingerprint", () => {
	// maxReason drives the tier, maxTool=0 (each turn a different tool) → no block.
	const d2 = decideTier(0, TH.t2, 1, TH); // reasoning repeated to the T2 threshold
	assert.equal(d2.tier, 2);
	assert.equal(d2.byReasonRepeat, true);
	assert.equal(d2.byToolRepeat, false);
	assert.equal(d2.blockWorst, false, "must not block an innocent n=1 tool call on reasoning repeats");
});

test("decideTier: genuine tool repetition DOES block at tier 2", () => {
	const d = decideTier(TH.t2, 0, 1, TH);
	assert.equal(d.tier, 2);
	assert.equal(d.blockWorst, true);
});

test("decideTier: a long VARIED read streak nudges (T1) but never blocks", () => {
	const d = decideTier(1, 0, TH.streakSoft, TH); // no repetition, just a long streak
	assert.equal(d.tier, 1);
	assert.equal(d.blockWorst, false);
	assert.equal(d.byToolRepeat, false);
});

test("decideTier: escalates to tier 3 on repeat or hard streak", () => {
	assert.equal(decideTier(TH.t3, 0, 1, TH).tier, 3);
	assert.equal(decideTier(1, 0, TH.streakHard, TH).tier, 3);
	assert.equal(decideTier(1, 1, 1, TH).tier, 0); // below everything
});

test("thresh: explicit LB_* env wins for both tiers", () => {
	process.env.LB_REPEAT_T1 = "7";
	try {
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, true), 7);
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, false), 7);
	} finally {
		delete process.env.LB_REPEAT_T1;
	}
});

test("thresh: local default < cloud default when env unset", () => {
	assert.equal(thresh("LB_STREAK_SOFT", 12, 8, true), 8);
	assert.equal(thresh("LB_STREAK_SOFT", 12, 8, false), 12);
});

test("thresh: env value below floor is clamped to 2", () => {
	process.env.LB_REPEAT_T1 = "1";
	try {
		assert.equal(thresh("LB_REPEAT_T1", 3, 2, true), 2);
	} finally {
		delete process.env.LB_REPEAT_T1;
	}
});

test("resolveStopMode: default is abort (graceful run-stop); env overrides", () => {
	assert.equal(resolveStopMode(undefined), "abort"); // new default: tier 3 stops the run
	assert.equal(resolveStopMode("shutdown"), "shutdown");
	assert.equal(resolveStopMode("block"), "block"); // opt back into old soft behavior
	assert.equal(resolveStopMode("garbage"), "abort");
});
