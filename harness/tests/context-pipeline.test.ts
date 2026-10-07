import assert from "node:assert/strict";
import test from "node:test";
import { beginContextRequest, contextPipeline, observeContextStage } from "../lib/context-pipeline.ts";
import { capabilityRoster, capabilityTools } from "../lib/capability-surface.ts";
test("context receipts preserve order and reject an inaccessible replacement without retaining raw data", () => {
 const bus = {}; beginContextRequest(bus);
 const stage = { name: "packing", boundary: "context" as const, recovery: "tool" as const, requiredTool: "obs_recall" };
 assert.throws(() => observeContextStage(bus, stage, ["private source"], ["stub"], []), /requires active/);
 assert.equal(contextPipeline(bus).stages.length, 0);
 const row = observeContextStage(bus, stage, ["private source"], ["stub"], ["obs_recall"]);
 assert.equal(row.request, 1); assert.equal(row.order, 0); assert.equal(JSON.stringify(row).includes("private source"), false);
 assert.equal(observeContextStage(bus, stage, ["x"], ["x"], []).recoverable, true);
 assert.equal(contextPipeline({}).stages.length, 0); beginContextRequest(bus); assert.equal(contextPipeline(bus).stages.length, 0);
});
test("capability status and activation share the registered roster", () => {
 assert.deepEqual(capabilityTools("planning", ["plan_write", "unrelated"]), ["plan_write"]);
 const roster = capabilityRoster([{ name: "obs_recall" }, { name: "subagent", parameters: { secret: "schema" } }], ["obs_recall"]);
 assert.deepEqual(roster.delegation.active, []); assert.equal(roster.delegation.schemaBytes, 0);
});
