import assert from "node:assert/strict";
import test from "node:test";
import { isEffectiveResume } from "../lib/session-resume.ts";

test("resume/fork are always effective resumes, regardless of branch", () => {
	for (const reason of ["resume", "fork"]) {
		assert.equal(isEffectiveResume({ reason }, { sessionManager: { getBranch: () => [] } }), true);
		assert.equal(isEffectiveResume({ reason }, { sessionManager: { getBranch: () => [{}] } }), true);
	}
});

// The real bug: `pi -p --session-id <existing>` fires reason "startup", never
// "resume" — verified against Pi's bundled dist. A non-empty branch is the only
// signal left that this session actually has prior history to restore.
test("a non-resume reason with a non-empty branch is still an effective resume", () => {
	assert.equal(isEffectiveResume({ reason: "startup" }, { sessionManager: { getBranch: () => [{ type: "custom" }] } }), true);
	assert.equal(isEffectiveResume({ reason: "new" }, { sessionManager: { getBranch: () => [{ type: "custom" }] } }), true);
});

test("a non-resume reason with an empty branch is not a resume", () => {
	for (const reason of ["startup", "new", "reload"]) {
		assert.equal(isEffectiveResume({ reason }, { sessionManager: { getBranch: () => [] } }), false);
	}
});

test("a throwing sessionManager fails closed, not open", () => {
	const throwing = { sessionManager: { getBranch: () => { throw new Error("no branch"); } } };
	assert.equal(isEffectiveResume({ reason: "startup" }, throwing), false);
});
