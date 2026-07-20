import assert from "node:assert/strict";
import test from "node:test";
import { buildCapsule } from "../src/capsule.js";

test("buildCapsule preserves supplied identifiers", () => {
	const row = buildCapsule({
		PROJECT_CODE: "A-01", OWNER_ALIAS: "owner", CHECKPOINT: "cp", OUTPUT_MODE: "json",
		ROLLBACK_TOKEN: "rb", INVARIANT: "keep", NEXT_ACTION: "next",
	});
	assert.equal(row.project, "A-01");
	assert.equal(row.rollback, "rb");
});
