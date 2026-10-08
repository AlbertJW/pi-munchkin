import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { gradeFixture, prepareStudy, summarizeOutcomes, validateTaskBank } from "../lib/acceptance-suite.ts";
const bank = JSON.parse(readFileSync(new URL("../acceptance/tasks-v1.json", import.meta.url), "utf8"));
test("40 fixed fixtures reject broken seeds and accept independent golden mechanisms", () => {
 validateTaskBank(bank);
 for (const task of bank.tasks) {
  assert.equal(gradeFixture(task, task.files).pass, false, task.id);
  const grade = gradeFixture(task, task.oracle.answer);
  assert.equal(grade.mechanismPass, true, task.id);
  assert.equal(grade.pass, task.oracle.externalChecks.length === 0, task.id);
  if (task.oracle.externalChecks.length) assert.equal(grade.status, "awaiting-independent-verification");
 }
});
test("study schedule freezes 240 task runs without authorizing inference; invalid identities/budgets fail", () => {
 const manifest = { v: 1 as const, comparison: { intervention: "context-brief" as const, baseline: {CONTEXT_BRIEF:"off"},candidate:{CONTEXT_BRIEF:"on"} }, baselineCommit: "a".repeat(40), candidateCommit: "b".repeat(40), model: {provider:"scripted",id:"fixture",servingFingerprint:"frozen"}, baselineReceiptHash:"c".repeat(64), candidateReceiptHash:"d".repeat(64), budget:{maxProviderRequests:1,maxOutputTokens:1024,deadlineMs:60000},seed:"fixed",judgeIdentity:"independent" };
 const study = prepareStudy(bank, manifest); assert.equal(study.taskRuns, 240); assert.equal(study.inferenceAuthorized, false);
 assert.deepEqual(prepareStudy(bank, manifest), study);
 assert.throws(()=>prepareStudy(bank,{...manifest,comparison:{...manifest.comparison,candidate:{CONTEXT_BRIEF:"off"}}}));
 assert.throws(() => prepareStudy(bank, {...manifest, baselineCommit:"HEAD"}));
 assert.throws(() => prepareStudy(bank, {...manifest, budget:{...manifest.budget,maxProviderRequests:NaN}}));
});
test("outcome summaries reject duplicate trials and retain paired task units", () => {
 const row = { taskId:"repair-01",trial:0,arm:"baseline" as const,pass:true,quality:1,inputTokens:10,outputTokens:2,cost:1,latencyMs:100,harmfulInterventions:0 };
 assert.throws(() => summarizeOutcomes([row,row])); assert.equal(summarizeOutcomes([row]).incomplete,true);
});
