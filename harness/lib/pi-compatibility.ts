import { VERSION, withFileMutationQueue, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
export type ContinuationBoundary = { outcome: "completed" | "aborted" | "error"; context: { canContinue: boolean } };
export type ContinuationDraft = { type: "custom_message"; customType: string; content: string; display: boolean };
export type ContinuationBoundaryResult = { entries: ContinuationDraft[]; continue: boolean };
export function piCompatibility(version = VERSION) {
 const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version);
 if (!match) throw new Error("Cannot determine Pi lifecycle contract");
 const major = Number(match[1]);
 if (major > 1) throw new Error(`Unqualified Pi major version ${major}`);
 return { version, actionableSettlement: major === 1, mutationQueue: "native-in-process" as const, contextBoundary: "conversation-only" as const };
}
/** Only the version adapter names an event absent from the pinned 0.80.6 declarations. */
export function onActionableSettlement(pi: ExtensionAPI, handler: (event: ContinuationBoundary) => Promise<ContinuationBoundaryResult | undefined>): void {
 if (!piCompatibility().actionableSettlement) return;
 const on = pi.on as unknown as (event: "agent_before_settle", handler: (event: ContinuationBoundary) => Promise<ContinuationBoundaryResult | undefined>) => unknown;
 on.call(pi, "agent_before_settle", handler);
}
export function continuationDraft(message: string): ContinuationDraft {
 return { type: "custom_message", customType: "pi-munchkin:continuation", content: message, display: false };
}
export function dispatchIdleContinuation(pi: ExtensionAPI, message: string): void {
 // 0.80.6 can announce settlement before its send guard observes idle.
 void pi.sendUserMessage(message, { deliverAs: "followUp" });
}
export const withPiFileMutationQueue = withFileMutationQueue;
export function transformLegacyPrompt(prompt: string, transform: (prompt: string) => string): { systemPrompt: string } {
 return { systemPrompt: transform(prompt) };
}
