import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { contractFields, contractNote, missingContractFields } from "../lib/subagent-contract.ts";

test("every shipped role declares a return contract that can be read", () => {
	for (const role of ["executor", "explorer", "verifier", "researcher"]) {
		const fields = contractFields(readFileSync(new URL(`../agents/${role}.md`, import.meta.url), "utf8"));
		assert.ok(fields.length >= 2, `${role}: ${fields.join(",")}`);
	}
	assert.deepEqual(contractFields(readFileSync(new URL("../agents/executor.md", import.meta.url), "utf8")), ["RESULT", "CHANGED", "VERIFY"]);
});

test("missing fields are named; a complete report adds nothing", () => {
	const fields = ["RESULT", "CHANGED", "VERIFY"];
	assert.deepEqual(missingContractFields(fields, "RESULT: done — fixed\nCHANGED: a.ts\nVERIFY: npm test passed"), []);
	assert.deepEqual(missingContractFields(fields, "RESULT: done — fixed it, trust me"), ["CHANGED", "VERIFY"]);
	assert.equal(contractNote("executor", []), "");
	assert.match(contractNote("executor", ["VERIFY"]), /missing VERIFY\. Treat its claims as unverified/);
});
