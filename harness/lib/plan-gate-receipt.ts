import { normalizeVerificationCommand } from "./command-policy.ts";

export type PlanGateOutcome = {
	command: string;
	pass: boolean;
	rejected?: boolean;
};

export type PlanGateReceipt = {
	v: 2;
	toolCallId: string;
	runId: string;
	outcomes: PlanGateOutcome[];
	allPassed: boolean;
};

const KEY = "__pi_plan_gate_receipts_v2";
const MAX_PENDING_RECEIPTS = 128;

function receiptMap(): Map<string, PlanGateReceipt> {
	const global = globalThis as Record<string, unknown>;
	const current = global[KEY];
	if (current instanceof Map) return current as Map<string, PlanGateReceipt>;
	const created = new Map<string, PlanGateReceipt>();
	global[KEY] = created;
	return created;
}

export function buildPlanGateReceipt(toolCallId: string, runId: string, outcomes: readonly PlanGateOutcome[]): PlanGateReceipt | null {
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
	return {
		v: 2,
		toolCallId,
		runId,
		outcomes: deduped,
		allPassed: deduped.every((outcome) => outcome.pass && !outcome.rejected),
	};
}

export function publishPlanGateReceipt(receipt: PlanGateReceipt): void {
	const pending = receiptMap();
	pending.delete(receipt.toolCallId);
	pending.set(receipt.toolCallId, receipt);
	while (pending.size > MAX_PENDING_RECEIPTS) {
		const oldest = pending.keys().next().value as string | undefined;
		if (oldest === undefined) break;
		pending.delete(oldest);
	}
}

export function consumePlanGateReceipt(toolCallId: string): PlanGateReceipt | null {
	const pending = receiptMap();
	const value = pending.get(toolCallId);
	pending.delete(toolCallId);
	if (!value || value.v !== 2 || value.toolCallId !== toolCallId) return null;
	return value;
}

export function clearPlanGateReceipt(): void {
	delete (globalThis as Record<string, unknown>)[KEY];
}
