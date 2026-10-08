import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { walkRelativeImports } from "./surface-walk.ts";

/** Only behavioral modes are exported. Credentials, commands, endpoints and arbitrary env are excluded. */
export const RECEIPT_FLAGS = ["GOALS", "PLAN_GRAPH", "PLAN_STORAGE", "DEEP_RESEARCH_PLANNING", "RESEARCH_WORKFLOW", "CONTROL_ARBITER", "RUN_KERNEL", "READ_DEDUP", "CONTEXT_BRIEF", "CONTEXT_ADMISSION", "CONTEXT_PIPELINE_RECEIPTS", "WORKING_MEMORY", "VISION", "HASHLINE", "MUNCHKIN_TOOL_PROFILE", "MUNCHKIN_TOOL_ACTIVATION", "MUNCHKIN_TOOL_SURFACE", "GOAL_SCOPE", "RUN_CAPSULE", "ACTIVE_TOOL_PROMPTS", "VERIFY_GATE", "VERIFICATION_PLATEAU", "FORCE_PLAN_WRITE"] as const;
export type ProviderIdentity = { provider: string; model: string; api: string };
export type RuntimeReceiptInput = {
 piVersion: string; baseDir: string; entryPoints: readonly string[];
 evidence: "loaded" | "discovered"; registeredTools: readonly string[]; activeTools: readonly string[];
 generation: number; sessionId: string | null; env?: NodeJS.ProcessEnv;
 requestedProvider?: ProviderIdentity | null; effectiveProvider?: ProviderIdentity | null;
};
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function packageIdentity(file: string): Promise<{ name: string; version: string } | null> {
 let dir = dirname(file);
 while (true) {
  try { const p = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
   if (typeof p.name === "string" && typeof p.version === "string") return { name: p.name, version: p.version };
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") return null; }
  const parent = dirname(dir); if (parent === dir) return null; dir = parent;
 }
}
export async function buildRuntimeReceipt(input: RuntimeReceiptInput) {
 const files = await walkRelativeImports([...input.entryPoints]);
 const sources = await Promise.all([...files].sort().map(async path => ({ path: relative(input.baseDir, path), sha256: digest(await readFile(path)) })));
 const entries = await Promise.all(input.entryPoints.map(async path => ({ path: relative(input.baseDir, path), package: await packageIdentity(path) })));
 const defaults: Record<string, string> = { GOALS: "on", PLAN_GRAPH: "off", PLAN_STORAGE: "capsule", DEEP_RESEARCH_PLANNING: "off", RESEARCH_WORKFLOW: "legacy", CONTROL_ARBITER: "enforce", RUN_KERNEL: "shadow", READ_DEDUP: "on", CONTEXT_BRIEF: "on", CONTEXT_ADMISSION: "off", CONTEXT_PIPELINE_RECEIPTS: "off", WORKING_MEMORY: "off", VISION: "off", HASHLINE: "on", MUNCHKIN_TOOL_PROFILE: "core", MUNCHKIN_TOOL_ACTIVATION: "dynamic", MUNCHKIN_TOOL_SURFACE: "default", GOAL_SCOPE: "worktree", RUN_CAPSULE: "recovery", ACTIVE_TOOL_PROMPTS: "derived", VERIFY_GATE: "on", VERIFICATION_PLATEAU: "enforce", FORCE_PLAN_WRITE: "off" };
 const allowed = new Set(["on", "off", "capsule", "private", "project", "parent", "legacy", "enforce", "shadow", "core", "ambient", "derived", "active", "minimal", "dynamic", "phase", "worktree", "default", "recovery"]);
 const flags = Object.fromEntries(RECEIPT_FLAGS.map(name => {
  const configured = input.env?.[name];
  const env = input.env ?? {};
  let effective = configured && allowed.has(configured) ? configured : defaults[name];
  if (["GOALS", "READ_DEDUP", "CONTEXT_BRIEF", "HASHLINE", "VERIFY_GATE"].includes(name)) effective = configured === "off" ? "off" : "on";
  if (["PLAN_GRAPH", "CONTEXT_ADMISSION", "CONTEXT_PIPELINE_RECEIPTS", "WORKING_MEMORY", "VISION"].includes(name)) effective = configured === "on" ? "on" : "off";
  if (name === "DEEP_RESEARCH_PLANNING") effective = env.PLAN_GRAPH === "on" && configured === "on" ? "on" : "off";
  if (name === "RESEARCH_WORKFLOW") effective = env.PLAN_GRAPH === "on" && env.DEEP_RESEARCH_PLANNING === "on" && configured === "parent" ? "parent" : "legacy";
  if (name === "PLAN_STORAGE") effective = configured === "project" || env.RUN_CAPSULE === "off" ? "project" : "capsule";
  if (name === "GOAL_SCOPE") effective = configured === "project" ? "project" : "worktree";
  if (name === "RUN_CAPSULE") effective = configured === "off" || configured === "shadow" ? configured : "recovery";
  if (name === "CONTROL_ARBITER") effective = configured === "off" || configured === "shadow" ? configured : "enforce";
  if (name === "MUNCHKIN_TOOL_ACTIVATION") effective = configured === "ambient" || configured === "phase" ? configured : "dynamic";
  if (name === "RUN_KERNEL") effective = configured === "off" ? "off" : "shadow";
  if (name === "MUNCHKIN_TOOL_PROFILE") effective = configured === "ambient" ? "ambient" : "core";
  if (name === "ACTIVE_TOOL_PROMPTS") effective = configured === "active" ? "derived" : configured === "ambient" ? "ambient" : env.MUNCHKIN_TOOL_SURFACE === "minimal" || env.MUNCHKIN_TOOL_ACTIVATION !== "ambient" ? "derived" : "ambient";
  if (name === "VERIFICATION_PLATEAU") effective = configured === "off" || configured === "shadow" ? configured : "enforce";
  if (name === "FORCE_PLAN_WRITE") effective = (configured ?? "off") === "off" ? "off" : "on";
  return [name, { configured: configured === undefined ? null : allowed.has(configured) ? configured : "invalid", default: defaults[name], effective }];
 }));
 return { v: 1 as const, evidence: input.evidence, closure: "relative-imports" as const,
  piVersion: input.piVersion, generation: input.generation, sessionIdHash: input.sessionId === null ? null : digest(input.sessionId),
  entries, sources, sourceHash: digest(JSON.stringify({ entries, sources })), flags,
  registeredTools: [...new Set(input.registeredTools)].sort(), activeTools: [...new Set(input.activeTools)].sort(),
  requestedProvider: input.requestedProvider ?? null, effectiveProvider: input.effectiveProvider ?? null };
}
export type RuntimeReceipt = Awaited<ReturnType<typeof buildRuntimeReceipt>>;
