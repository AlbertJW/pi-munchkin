import { normalizeVerificationCommand } from "./command-policy.ts";

export type PlanGateOutcome = {
	command: string;
	pass: boolean;
	rejected?: boolean;
};

export type PlanGateReceipt = {
	v: 1;
	runId: string;
	outcomes: PlanGateOutcome[];
	allPassed: boolean;
};

const KEY = "__pi_plan_gate_receipt_v1";

export function buildPlanGateReceipt(runId: string, outcomes: readonly PlanGateOutcome[]): PlanGateReceipt | null {
	if (outcomes.length === 0) return null;
	const byCommand = new Map<string, PlanGateOutcome>();
	for (const outcome of outcomes) {
		const command = normalizeVerificationCommand(outcome.command);
		const previous = byCommand.get(command);
		byCommand.set(command, {
			command,
			pass: (previous?.pass ?? true) && outcome.pass,
			rejected: (previous?.rejected ?? false) || outcome.rejected === true,
		});
	}
	const deduped = [...byCommand.values()];
	return { v: 1, runId, outcomes: deduped, allPassed: deduped.every((outcome) => outcome.pass && !outcome.rejected) };
}

export function publishPlanGateReceipt(receipt: PlanGateReceipt | null): void {
	const global = globalThis as Record<string, unknown>;
	if (receipt) global[KEY] = receipt;
	else delete global[KEY];
}

export function consumePlanGateReceipt(): PlanGateReceipt | null {
	const global = globalThis as Record<string, unknown>;
	const value = global[KEY];
	delete global[KEY];
	if (!value || typeof value !== "object" || (value as { v?: unknown }).v !== 1) return null;
	return value as PlanGateReceipt;
}

export function clearPlanGateReceipt(): void {
	delete (globalThis as Record<string, unknown>)[KEY];
}
