import { createHash } from "node:crypto";
import type { CapabilitySnapshot, Ordinal, PlanStepV4, StepStatusV4, TestReceipt } from "./plan-synthesis.ts";

const rank: Record<Ordinal, number> = { low: 0, medium: 1, high: 2 };
const effortRank: Record<Ordinal, number> = { low: 0, medium: 1, high: 2 };

export function unmetHardDependencies(step: PlanStepV4, steps: PlanStepV4[]): string[] {
	const byId = new Map(steps.map((candidate) => [candidate.id, candidate]));
	return step.hard_depends_on.filter((id) => byId.get(id)?.status !== "done");
}

export function eligibleSteps(steps: PlanStepV4[], capabilities: CapabilitySnapshot): PlanStepV4[] {
	const active = new Set(capabilities.entries.filter((entry) => entry.active).map((entry) => entry.name));
	return steps.filter((step) => {
		if (step.status !== "pending" && step.status !== "stale") return false;
		if (unmetHardDependencies(step, steps).length > 0) return false;
		return step.required_capabilities.every((name) => active.has(name) || Boolean(step.capability_fallback?.trim()));
	});
}

function unlockedDependents(step: PlanStepV4, steps: PlanStepV4[]): number {
	return steps.filter((candidate) => candidate.hard_depends_on.includes(step.id)).length;
}

export function rankEligibleSteps(
	steps: PlanStepV4[],
	capabilities: CapabilitySnapshot,
	invalidated: string[] = [],
	currentStepId?: string,
): PlanStepV4[] {
	const invalidatedSet = new Set(invalidated);
	const currentFiles = new Set(steps.find((step) => step.id === currentStepId)?.expected_files ?? []);
	const switchCost = (step: PlanStepV4): number =>
		currentFiles.size > 0 && step.expected_files.some((path) => currentFiles.has(path)) ? 0 : 1;
	return eligibleSteps(steps, capabilities).sort((a, b) => {
		const aInvalidated = a.invalidated_by.some((key) => invalidatedSet.has(key)) ? 1 : 0;
		const bInvalidated = b.invalidated_by.some((key) => invalidatedSet.has(key)) ? 1 : 0;
		const aImpact = Math.max(rank[a.risk], rank[a.information_value]);
		const bImpact = Math.max(rank[b.risk], rank[b.information_value]);
		return (
			bInvalidated - aInvalidated ||
			bImpact - aImpact ||
			rank[b.information_value] - rank[a.information_value] ||
			rank[b.risk] - rank[a.risk] ||
			unlockedDependents(b, steps) - unlockedDependents(a, steps) ||
			switchCost(a) - switchCost(b) ||
			effortRank[a.effort] - effortRank[b.effort] ||
			a.order - b.order
		);
	});
}

export function validateRouteTarget(targetId: string, steps: PlanStepV4[], capabilities: CapabilitySnapshot): string[] {
	const target = steps.find((step) => step.id === targetId);
	if (!target) return [`unknown target step "${targetId}"`];
	const unmet = unmetHardDependencies(target, steps);
	if (unmet.length) return [`target "${targetId}" has unmet hard dependencies: ${unmet.join(", ")}`];
	const eligible = eligibleSteps(steps, capabilities).some((step) => step.id === targetId);
	if (!eligible) return [`target "${targetId}" is not eligible in status ${target.status}`];
	return [];
}

export function backtrackAndStale(steps: PlanStepV4[], targetId: string, reason: string): { steps: PlanStepV4[]; stale: string[] } {
	if (!steps.some((step) => step.id === targetId)) return { steps, stale: [] };
	const stale = new Set<string>([targetId]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const step of steps) {
			if (step.status === "done" && step.hard_depends_on.some((dep) => stale.has(dep)) && !stale.has(step.id)) {
				stale.add(step.id);
				changed = true;
			}
		}
	}
	return {
		steps: steps.map((step) => stale.has(step.id)
			? {
				...step,
				status: "stale" as StepStatusV4,
				stale_reason: reason,
				green_receipt: undefined,
				spawn_receipt: undefined,
			}
			: step),
		stale: [...stale],
	};
}

export function testReceipt(command: string, exitCode: number, output: string, now = new Date().toISOString()): TestReceipt {
	return {
		command,
		exit_code: exitCode,
		output_sha256: createHash("sha256").update(output).digest("hex"),
		recorded_at: now,
	};
}

export function tddEvidenceErrors(step: PlanStepV4): string[] {
	if (step.kind !== "behavior") return [];
	if (step.test_exception) return [];
	if (!step.test) return [`behavior step "${step.title}" has no test contract`];
	if (!step.red_receipt || step.red_receipt.exit_code === 0) return [`behavior step "${step.title}" has no failing RED receipt`];
	if (!step.green_receipt || step.green_receipt.exit_code !== 0) return [`behavior step "${step.title}" has no passing GREEN receipt`];
	if (step.red_receipt.command !== step.test.command || step.green_receipt.command !== step.test.command) {
		return [`behavior step "${step.title}" receipts do not match its declared test command`];
	}
	if (step.red_receipt.recorded_at > step.green_receipt.recorded_at) return [`behavior step "${step.title}" GREEN precedes RED`];
	return [];
}

export function routeFingerprint(steps: PlanStepV4[], selectedId: string | undefined, evidence: string[]): string {
	const material = JSON.stringify({
		selectedId: selectedId ?? null,
		statuses: steps.map((step) => [step.id, step.status]),
		evidence: [...evidence].sort(),
	});
	return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

export function nextRouteStreak(previousFingerprint: string | undefined, fingerprint: string, streak: number): number {
	return previousFingerprint === fingerprint ? streak + 1 : 0;
}
