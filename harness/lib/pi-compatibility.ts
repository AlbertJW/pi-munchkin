import { VERSION, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type ContinuationBoundary = { outcome: "completed" | "aborted" | "error"; context: { canContinue: boolean } };
export type ContinuationDraft = { type: "custom_message"; customType: string; content: string; display: boolean };
export type ContinuationBoundaryResult = { entries: ContinuationDraft[]; continue: boolean };
/** Pi versions this harness has passed `npm run qualify:pi` against. Append a version
 * only after qualification passes; anything else in 1.x still loads, with a warning. */
export const QUALIFIED_PI_VERSIONS: readonly string[] = ["1.0.4", "1.1.0"];
export const PI_VERSION_FLOOR = "1.0.4";
function parse(version: string): [number, number, number] {
 const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
 if (!match) throw new Error("Cannot determine Pi lifecycle contract");
 return [Number(match[1]), Number(match[2]), Number(match[3])];
}
export function piCompatibility(version = VERSION) {
 const [major, minor, patch] = parse(version);
 const [floorMajor, floorMinor, floorPatch] = parse(PI_VERSION_FLOOR);
 if (major > 1) throw new Error(`Unqualified Pi major version ${major}`);
 if (major < floorMajor || (major === floorMajor && (minor < floorMinor || (minor === floorMinor && patch < floorPatch)))) {
  throw new Error(`pi-munchkin requires Pi ${PI_VERSION_FLOOR} or newer (found ${version})`);
 }
 return { version, qualified: QUALIFIED_PI_VERSIONS.includes(version), actionableSettlement: true as const, mutationQueue: "native-in-process" as const, contextBoundary: "conversation-only" as const };
}
/** The one place that names Pi's actionable settlement event. */
export function onActionableSettlement(pi: ExtensionAPI, handler: (event: ContinuationBoundary) => Promise<ContinuationBoundaryResult | undefined>): void {
 piCompatibility();
 const on = pi.on as unknown as (event: "agent_before_settle", handler: (event: ContinuationBoundary) => Promise<ContinuationBoundaryResult | undefined>) => unknown;
 on.call(pi, "agent_before_settle", handler);
}
export function continuationDraft(message: string): ContinuationDraft {
 return { type: "custom_message", customType: "pi-munchkin:continuation", content: message, display: false };
}
export function dispatchIdleContinuation(pi: ExtensionAPI, message: string): void {
 // followUp starts immediately when idle and queues safely if a run is still finishing.
 void pi.sendUserMessage(message, { deliverAs: "followUp" });
}
export const withPiFileMutationQueue = withFileMutationQueue;
export function transformLegacyPrompt(prompt: string, transform: (prompt: string) => string): { systemPrompt: string } {
 return { systemPrompt: transform(prompt) };
}
