import { createHash } from "node:crypto";
import { Script } from "node:vm";
export type AcceptanceTask = { id: string; category: "repair" | "research" | "resume" | "browser"; kind: "regression" | "capability";
 title: string; prompt: string; files: Record<string, string>; oracle: { tests: { args: unknown[]; expected: unknown }[]; answer: Record<string, string>; externalChecks: string[] } };
export function validateTaskBank(bank: { v: number; tasks: AcceptanceTask[] }): void {
 if (bank.v !== 1 || bank.tasks.length !== 40) throw new Error("Acceptance v1 requires 40 fixed tasks");
 const ids = new Set<string>();
 for (const task of bank.tasks) {
  if (ids.has(task.id) || !/^(repair|research|resume|browser)-\d{2}$/.test(task.id)) throw new Error("Invalid task identity"); ids.add(task.id);
  for (const name of [...Object.keys(task.files), ...Object.keys(task.oracle.answer)]) if (name === "." || name === ".." || !/^[a-zA-Z0-9._-]+$/.test(name)) throw new Error("Unsafe fixture path");
  if (!task.prompt || !task.title) throw new Error("Task contract is incomplete");
 }
 for (const category of ["repair", "research", "resume", "browser"]) if (bank.tasks.filter(task => task.category === category).length !== 10) throw new Error("Require ten tasks per category");
}
export type ExternalJudgement = { artifactHash: string; checks: Record<string, boolean>; graderIdentity: string };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
/** Offline fixture grader, not a sandbox for executing arbitrary real-world agent code. */
export function gradeFixture(task: AcceptanceTask, artifacts: Record<string, string>, external?: ExternalJudgement) {
 let mechanismPass = false;
 try {
  if (task.category === "research") {
   const actual = JSON.parse(artifacts["answer.json"]), expected = JSON.parse(task.oracle.answer["answer.json"]);
   mechanismPass = actual.value === expected.value && actual.benefitEstablished === false && Array.isArray(actual.sources) && actual.sources.length > 0 && actual.sources.every((name: unknown) => name === expected.sources[0]);
  } else {
   const filename = Object.keys(task.oracle.answer)[0];
   const code = task.category === "browser" ? artifacts[filename].match(/<script>([\s\S]*?)<\/script>/i)?.[1]?.split('document.querySelector("#apply").onclick')[0] : artifacts[filename];
   if (code === undefined) throw new Error("Missing implementation");
   mechanismPass = new Script(`${code}\nJSON.stringify(${JSON.stringify(task.oracle.tests)}.map(t => run(...t.args)));`).runInNewContext({ TextEncoder }, { timeout: 1000 }) === JSON.stringify(task.oracle.tests.map(test => test.expected));
  }
 } catch { mechanismPass = false; }
 const artifactHash = digest(artifacts);
 const externalPass = task.oracle.externalChecks.length === 0 || Boolean(external && external.artifactHash === artifactHash && external.graderIdentity && task.oracle.externalChecks.every(check => external.checks[check] === true));
 return { taskId: task.id, mechanismPass, externalPass, pass: mechanismPass && externalPass, artifactHash,
  status: !mechanismPass ? "failed" : !externalPass ? "awaiting-independent-verification" : "passed" };
}
export type StudyManifest = { v: 1; comparison: { intervention: "context-brief" | "loop-verification-steering" | "combined-context-reduction"; baseline: Record<string, string>; candidate: Record<string, string> }; baselineCommit: string; candidateCommit: string; model: { provider: string; id: string; servingFingerprint: string };
 baselineReceiptHash: string; candidateReceiptHash: string; budget: { maxProviderRequests: number; maxOutputTokens: number; deadlineMs: number }; seed: string; judgeIdentity: string };
export function prepareStudy(bank: { v: number; tasks: AcceptanceTask[] }, manifest: StudyManifest) {
 validateTaskBank(bank);
 const comparison = manifest.comparison;
 if (!comparison || !["context-brief", "loop-verification-steering", "combined-context-reduction"].includes(comparison.intervention) || !comparison.baseline || !comparison.candidate) throw new Error("Unbound intervention comparison");
 const a=Object.keys(comparison.baseline).sort(), b=Object.keys(comparison.candidate).sort();
 if (!a.length || JSON.stringify(a)!==JSON.stringify(b) || a.some(key=>typeof comparison.baseline[key]!=="string" || typeof comparison.candidate[key]!=="string")) throw new Error("Unbound arm configuration");
 if (a.filter(key=>comparison.baseline[key]!==comparison.candidate[key]).length!==1) throw new Error("Compare exactly one configuration axis");
 for (const name of ["baselineCommit", "candidateCommit"] as const) if (!/^[a-f0-9]{40}$/.test(manifest[name])) throw new Error(`Unbound ${name}`);
 for (const name of ["baselineReceiptHash", "candidateReceiptHash"] as const) if (!/^[a-f0-9]{64}$/.test(manifest[name])) throw new Error(`Unbound ${name}`);
 if (manifest.v !== 1 || !manifest.model?.provider || !manifest.model.id || !manifest.model.servingFingerprint || !manifest.seed || !manifest.judgeIdentity) throw new Error("Unbound serving/grading identity");
 if (!manifest.budget || !["maxProviderRequests", "maxOutputTokens", "deadlineMs"].every(name => Object.hasOwn(manifest.budget, name))) throw new Error("Incomplete study budget");
 for (const value of Object.values(manifest.budget)) if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Unbound study budget");
 if (Object.keys(manifest.budget).length !== 3) throw new Error("Incomplete study budget");
 const schedule = bank.tasks.flatMap(task => [0, 1, 2].flatMap(trial => ["baseline", "candidate"].map(arm => ({ taskId: task.id, trial, arm, orderKey: digest({ seed: manifest.seed, id: task.id, trial, arm }) })))).sort((a, b) => a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0);
 return { v: 1, inferenceAuthorized: false, optimizerInvoked: false, datasetHash: digest(bank), manifestHash: digest(manifest), manifest, schedule, taskRuns: schedule.length };
}
export type TrialOutcome = { taskId: string; trial: number; arm: "baseline" | "candidate"; pass: boolean; quality: number; inputTokens: number; outputTokens: number; cost: number; latencyMs: number; harmfulInterventions: number };
export function summarizeOutcomes(rows: TrialOutcome[]) {
 const ids = new Set<string>();
 for (const row of rows) {
  const key = `${row.taskId}:${row.trial}:${row.arm}`; if (ids.has(key)) throw new Error("Duplicate trial outcome"); ids.add(key);
  if (!/^(repair|research|resume|browser)-(0[1-9]|10)$/.test(row.taskId) || !Number.isInteger(row.trial) || row.trial < 0 || row.trial > 2 || !["baseline", "candidate"].includes(row.arm) || typeof row.pass !== "boolean" || [row.quality, row.cost, row.latencyMs, row.harmfulInterventions].some(x => !Number.isFinite(x) || x < 0) || row.quality > 1 || ![row.inputTokens,row.outputTokens,row.harmfulInterventions].every(x=>Number.isSafeInteger(x) && x>=0)) throw new Error("Invalid trial outcome");
 }
 const arms = Object.fromEntries((["baseline", "candidate"] as const).map(arm => {
  const trials = rows.filter(row => row.arm === arm); const tasks = [...new Set(trials.map(row => row.taskId))];
  return [arm, { trials: trials.length, completionRate: trials.length ? trials.filter(row => row.pass).length / trials.length : null,
   repeatedSuccessTasks: tasks.filter(id => { const samples = trials.filter(row => row.taskId === id); return samples.length === 3 && samples.every(row => row.pass); }).length,
   meanQuality: trials.length ? trials.reduce((sum,row)=>sum+row.quality,0)/trials.length : null, inputTokens: trials.reduce((sum,row)=>sum+row.inputTokens,0), outputTokens: trials.reduce((sum,row)=>sum+row.outputTokens,0),
   cost: trials.reduce((sum, row) => sum + row.cost, 0), totalLatencyMs: trials.reduce((sum, row) => sum + row.latencyMs, 0), harmfulInterventions: trials.reduce((sum, row) => sum + row.harmfulInterventions, 0) }];
 }));
 // Task-level differences, rather than treating three correlated trials as independent tasks.
 const pairedTasks = [...new Set(rows.map(row => row.taskId))].flatMap(id => {
  const a = rows.filter(row => row.taskId === id && row.arm === "baseline"), b = rows.filter(row => row.taskId === id && row.arm === "candidate");
  return a.length === 3 && b.length === 3 ? [{ taskId: id, difference: (b.filter(row => row.pass).length - a.filter(row => row.pass).length) / 3 }] : [];
 });
 let state = 0x4d554e43;
 const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
 const means: number[] = [];
 if (pairedTasks.length >= 2) for (let sample = 0; sample < 10000; sample++) {
  let sum = 0; for (let index = 0; index < pairedTasks.length; index++) sum += pairedTasks[Math.floor(random() * pairedTasks.length)].difference;
  means.push(sum / pairedTasks.length);
 }
 means.sort((a, b) => a - b);
 const uncertainty = means.length ? { method: "paired-task percentile bootstrap", replicates: 10000,
  meanDifference: pairedTasks.reduce((sum, task) => sum + task.difference, 0) / pairedTasks.length,
  interval95: [means[249], means[9749]] } : null;
 return { arms, pairedTasks, uncertainty, incomplete: rows.length !== 240 || pairedTasks.length !== 40, verdict: "screen-only; no promotion or significance inferred" };
}
