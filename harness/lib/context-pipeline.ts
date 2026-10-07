import { createHash } from "node:crypto";
import { runtimeValue } from "./runtime-ownership.ts";
export type ContextStage = { name: string; boundary: "tool-result" | "context" | "provider";
 recovery: "unchanged" | "earlier-message" | "tool" | "authoritative-state"; requiredTool?: string };
export type ContextMeasurement = { v: 1; request: number; order: number; stage: string; boundary: ContextStage["boundary"];
 inputHash: string; outputHash: string; inputBytes: number; outputBytes: number; recovery: ContextStage["recovery"]; recoverable: boolean };
function measure(value: unknown) { const text = JSON.stringify(value); if (text === undefined) throw new Error("Context measurement requires JSON data");
 return { hash: createHash("sha256").update(text).digest("hex"), bytes: Buffer.byteLength(text) }; }
export function measureContextStage(stage: ContextStage, input: unknown, output: unknown, activeTools: readonly string[], request = 0, order = 0): ContextMeasurement {
 const before = measure(input), after = measure(output);
 const recoverable = before.hash === after.hash || stage.recovery !== "tool" || Boolean(stage.requiredTool && activeTools.includes(stage.requiredTool));
 return { v: 1, request, order, stage: stage.name, boundary: stage.boundary, inputHash: before.hash, outputHash: after.hash,
  inputBytes: before.bytes, outputBytes: after.bytes, recovery: stage.recovery, recoverable };
}
/** Request-local observation. It never mutates messages, requests, budgets or authority. */
export function contextPipeline(bus: object) {
 return runtimeValue(bus, { key: "context-pipeline", lifetime: "session", create: () => ({ request: 0, stages: [] as ContextMeasurement[] }) });
}
export function beginContextRequest(bus: object): number { const state = contextPipeline(bus); state.stages = []; return ++state.request; }
export function observeContextStage(bus: object, stage: ContextStage, input: unknown, output: unknown, activeTools: readonly string[]): ContextMeasurement {
 const state = contextPipeline(bus); const row = measureContextStage(stage, input, output, activeTools, state.request, state.stages.length);
 if (!row.recoverable) throw new Error(`Context stage ${stage.name} requires active retrieval tool ${stage.requiredTool ?? "(undeclared)"}`);
 if (state.stages.length >= 64) throw new Error("Context pipeline exceeded 64 measured stages");
 state.stages.push(row); return row;
}
