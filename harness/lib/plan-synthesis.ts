import { createHash } from "node:crypto";

export type ReflectionStage = "interpretation" | "evidence" | "critique";
export type StepKind = "behavior" | "support";
export type StepStatusV4 = "pending" | "in_progress" | "done" | "blocked" | "stale";
export type Ordinal = "low" | "medium" | "high";

export type CapabilityEntry = {
	name: string;
	kind: "tool" | "command" | "passive";
	description: string;
	origin: string;
	active: boolean;
	planning_note?: string;
};

export type CapabilitySnapshot = {
	sha256: string;
	captured_at: string;
	entries: CapabilityEntry[];
};

export type ReflectionSignals = {
	repository_behavior?: boolean;
	ambiguity?: boolean;
	multiple_artifacts?: boolean;
	external_effects?: boolean;
	risk?: boolean;
	capability_dependent?: boolean;
	competing_approaches?: boolean;
	safety_or_compatibility?: boolean;
	test_exception?: boolean;
};

export type ReflectionRecord = {
	stage: ReflectionStage;
	requirements: string[];
	constraints: string[];
	non_goals: string[];
	assumptions: string[];
	evidence_refs: string[];
	uncertainties: string[];
	capability_use: string[];
	scope_cuts: string[];
	test_seams: string[];
	signals: ReflectionSignals;
};

export type StepTestContract = {
	paths: string[];
	command: string;
	red_expectation: string;
	green_expectation: string;
};

export type TestException = {
	reason: string;
	validation: string;
};

export type PlanStepV4 = {
	id: string;
	order: number;
	title: string;
	kind: StepKind;
	status: StepStatusV4;
	objective: string;
	acceptance: string[];
	covers: string[];
	hard_depends_on: string[];
	soft_after: string[];
	required_capabilities: string[];
	capability_fallback?: string;
	risk: Ordinal;
	information_value: Ordinal;
	effort: Ordinal;
	expected_files: string[];
	invalidated_by: string[];
	test?: StepTestContract;
	test_exception?: TestException;
	validation?: string;
	note?: string;
	stale_reason?: string;
	route_history?: Array<{ at: string; action: string; reason: string }>;
	red_receipt?: TestReceipt;
	green_receipt?: TestReceipt;
	spawn_receipt?: {
		recorded_at: string;
		success: boolean;
		parent_input: number;
		child_input: number;
		child_output: number;
	};
};

export type TestReceipt = {
	command: string;
	exit_code: number;
	output_sha256: string;
	recorded_at: string;
};

export type PassiveCapability = {
	name: string;
	description: string;
	active: boolean;
	planning_note: string;
};

const tidy = (value: unknown, max = 240): string =>
	String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export function buildCapabilitySnapshot(
	activeToolNames: string[],
	allTools: Array<{ name: string; description?: string; sourceInfo?: { source?: string; path?: string } }>,
	commands: Array<{ name: string; description?: string; source?: string }>,
	passive: PassiveCapability[],
	now = new Date().toISOString(),
): CapabilitySnapshot {
	const active = new Set(activeToolNames);
	const entries: CapabilityEntry[] = [];
	for (const tool of allTools) {
		entries.push({
			name: tidy(tool.name, 80),
			kind: "tool",
			description: tidy(tool.description),
			origin: tidy(tool.sourceInfo?.source ?? tool.sourceInfo?.path ?? "unknown", 120),
			active: active.has(tool.name),
		});
	}
	for (const command of commands) {
		entries.push({
			name: `/${tidy(command.name, 79)}`,
			kind: "command",
			description: tidy(command.description),
			origin: tidy(command.source ?? "command", 120),
			active: true,
		});
	}
	for (const capability of passive) {
		entries.push({
			name: tidy(capability.name, 80),
			kind: "passive",
			description: tidy(capability.description),
			origin: "pi-munchkin",
			active: capability.active,
			planning_note: tidy(capability.planning_note),
		});
	}
	entries.sort((a, b) => a.name.localeCompare(b.name) || a.kind.localeCompare(b.kind));
	const material = JSON.stringify(entries.map(({ name, kind, description, origin, active, planning_note }) =>
		({ name, kind, description, origin, active, planning_note })));
	return {
		sha256: createHash("sha256").update(material).digest("hex"),
		captured_at: now,
		entries,
	};
}

export function nextReflectionStage(records: ReflectionRecord[]): ReflectionStage | null {
	if (records.length === 0) return "interpretation";
	const interpretation = records.find((record) => record.stage === "interpretation");
	if (!interpretation) return "interpretation";
const needsEvidence =
		Object.values(interpretation.signals).some(Boolean) ||
		interpretation.uncertainties.length > 0 ||
		interpretation.capability_use.length > 0 ||
		interpretation.requirements.length > 1;
	const evidence = records.find((record) => record.stage === "evidence");
	if (needsEvidence && !evidence) return "evidence";
	if (!needsEvidence) return null;
	const combinedSignals = records.reduce<ReflectionSignals>(
		(all, record) => {
			for (const [key, value] of Object.entries(record.signals) as Array<[keyof ReflectionSignals, boolean | undefined]>) {
				if (value) all[key] = true;
			}
			return all;
		},
		{},
	);
	const needsCritique =
		(evidence?.uncertainties.length ?? interpretation.uncertainties.length) > 0 ||
		Boolean(combinedSignals.competing_approaches) ||
		Boolean(combinedSignals.safety_or_compatibility) ||
		Boolean(combinedSignals.test_exception) ||
		Boolean(combinedSignals.risk && combinedSignals.multiple_artifacts);
	if (needsCritique && !records.some((record) => record.stage === "critique")) return "critique";
	return null;
}

export function validateReflectionAppend(records: ReflectionRecord[], incoming: ReflectionRecord): string[] {
	const expected = nextReflectionStage(records);
	if (expected === null) return ["reflection sequence is already complete"];
	if (incoming.stage !== expected) return [`expected ${expected} reflection, received ${incoming.stage}`];
	if (records.length >= 3) return ["reflection pass limit is 3"];
	if (incoming.requirements.length === 0) return ["at least one requirement is required"];
	if (incoming.stage !== "interpretation" && incoming.evidence_refs.length === 0) {
		return [`${incoming.stage} reflection requires at least one evidence reference`];
	}
	return [];
}

function normalize(value: string): string {
	return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function titleKey(value: string): string {
	return normalize(value.replace(/`/g, ""));
}

export function validateV4Plan(
	steps: PlanStepV4[],
	reflections: ReflectionRecord[],
	capabilities: CapabilitySnapshot,
): string[] {
	const errors: string[] = [];
	const interpretation = reflections.find((record) => record.stage === "interpretation");
	if (!interpretation) errors.push("missing interpretation reflection");
	if (nextReflectionStage(reflections) !== null) errors.push(`reflection sequence incomplete; next=${nextReflectionStage(reflections)}`);
	if (steps.length === 0) errors.push("plan requires at least one step");
	if (steps.filter((step) => step.status === "in_progress").length > 1) {
		errors.push("one mutation lane permits at most one in_progress step");
	}

	const ids = new Set<string>();
	const titles = new Set<string>();
	for (const step of steps) {
		if (!step.id.trim()) errors.push(`step "${step.title}" has no id`);
		if (ids.has(step.id)) errors.push(`duplicate step id "${step.id}"`);
		ids.add(step.id);
		const key = titleKey(step.title);
		if (titles.has(key)) errors.push(`duplicate normalized step title "${step.title}"`);
		titles.add(key);
		if (!step.objective.trim()) errors.push(`step "${step.title}" has no objective`);
		if (step.acceptance.length === 0) errors.push(`step "${step.title}" has no acceptance criteria`);
		if (step.kind === "behavior" && !step.test && !step.test_exception) errors.push(`behavior step "${step.title}" requires a test contract or explicit exception`);
		if (step.kind === "behavior" && step.test && !step.test.command.trim()) errors.push(`behavior step "${step.title}" has an empty test command`);
		if (step.kind === "behavior" && step.test_exception && (!step.test_exception.reason.trim() || !step.test_exception.validation.trim())) {
			errors.push(`behavior step "${step.title}" has an incomplete test exception`);
		}
		if (step.test && step.test_exception) errors.push(`behavior step "${step.title}" cannot declare both a test contract and exception`);
		if (step.kind === "support" && !step.validation?.trim()) errors.push(`support step "${step.title}" requires validation`);
	}
	for (const step of steps) {
		for (const dep of [...step.hard_depends_on, ...step.soft_after]) {
			if (!ids.has(dep)) errors.push(`step "${step.title}" references unknown dependency "${dep}"`);
			if (dep === step.id) errors.push(`step "${step.title}" depends on itself`);
		}
		if (step.status === "in_progress" || step.status === "done") {
			const unmet = step.hard_depends_on.filter((dep) => steps.find((candidate) => candidate.id === dep)?.status !== "done");
			if (unmet.length) errors.push(`step "${step.title}" crosses unfinished hard dependencies: ${unmet.join(", ")}`);
		}
	}
	const graph = new Map(steps.map((step) => [step.id, step.hard_depends_on]));
	const colors = new Map<string, number>();
	const cyclic = (id: string): boolean => {
		if (colors.get(id) === 1) return true;
		if (colors.get(id) === 2) return false;
		colors.set(id, 1);
		for (const dep of graph.get(id) ?? []) if (cyclic(dep)) return true;
		colors.set(id, 2);
		return false;
	};
	for (const id of graph.keys()) {
		if (!colors.has(id) && cyclic(id)) {
			errors.push(`hard dependency cycle involving "${id}"`);
			break;
		}
	}

	if (interpretation) {
		const requirements = new Set(interpretation.requirements.map(normalize));
		const covered = new Set(steps.flatMap((step) => step.covers).map(normalize));
		for (const requirement of interpretation.requirements) {
			if (!covered.has(normalize(requirement))) errors.push(`uncovered requirement: ${requirement}`);
		}
		for (const step of steps) {
			for (const mapped of step.covers) {
				if (!requirements.has(normalize(mapped))) errors.push(`step "${step.title}" maps unknown requirement: ${mapped}`);
			}
			if (step.kind === "behavior" && step.covers.length === 0) {
				errors.push(`speculative behavior step "${step.title}" covers no explicit requirement; defer it instead`);
			}
		}
		// A support increment may omit direct coverage only when it unlocks a
		// requirement-bearing step. This keeps repository probes/test scaffolds
		// while pruning detached abstractions and generic "future-proofing".
		const useful = new Set(steps.filter((step) => step.covers.length > 0).map((step) => step.id));
		let grew = true;
		while (grew) {
			grew = false;
			for (const step of steps) {
				if (useful.has(step.id)) continue;
				if (steps.some((consumer) => useful.has(consumer.id) && consumer.hard_depends_on.includes(step.id))) {
					useful.add(step.id);
					grew = true;
				}
			}
		}
		for (const step of steps) {
			if (step.kind === "support" && step.covers.length === 0 && !useful.has(step.id)) {
				errors.push(`speculative support step "${step.title}" unlocks no explicit requirement; defer it instead`);
			}
		}
	}
	const active = new Set(capabilities.entries.filter((entry) => entry.active).map((entry) => entry.name));
	const known = new Set(capabilities.entries.map((entry) => entry.name));
	for (const step of steps) {
		for (const capability of step.required_capabilities) {
			if (!known.has(capability)) {
				errors.push(`step "${step.title}" references unknown capability "${capability}"`);
			} else if (!active.has(capability) && !step.capability_fallback?.trim()) {
				errors.push(`step "${step.title}" requires unavailable capability "${capability}" without fallback`);
			}
		}
	}
	return errors;
}

export function slugifyStep(title: string): string {
	const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
	return slug || "step";
}

export function stepFileName(step: Pick<PlanStepV4, "order" | "title">): string {
	return `${String(step.order).padStart(2, "0")}-${slugifyStep(step.title)}.md`;
}

function bulletList(values: string[], empty = "(none)"): string {
	return values.length ? values.map((value) => `- ${value}`).join("\n") : empty;
}

export function renderContextMarkdown(
	request: string,
	reflections: ReflectionRecord[],
	capabilities: CapabilitySnapshot,
	steps: PlanStepV4[] = [],
	testExceptionsApproved = false,
): string {
	const combined = (key: keyof Omit<ReflectionRecord, "stage" | "signals">): string[] =>
		[...new Set(reflections.flatMap((record) => record[key] as string[]))];
	const active = capabilities.entries.filter((entry) => entry.active);
	return [
		"# Planning Context",
		"",
		"## Request",
		request,
		"",
		"## Requirements",
		bulletList(combined("requirements")),
		"",
		"## Constraints",
		bulletList(combined("constraints")),
		"",
		"## Non-goals and YAGNI cuts",
		bulletList([...combined("non_goals"), ...combined("scope_cuts")]),
		"",
		"## Assumptions and uncertainties",
		bulletList([...combined("assumptions"), ...combined("uncertainties")]),
		"",
		"## Repository evidence",
		bulletList(combined("evidence_refs")),
		"",
		"## Test exceptions",
		...(steps.some((step) => step.test_exception)
			? steps.filter((step) => step.test_exception).map((step) =>
				`- ${testExceptionsApproved ? "APPROVED" : "PENDING"} — ${step.title}: ${step.test_exception!.reason}; validation \`${step.test_exception!.validation}\``)
			: ["(none)"]),
		"",
		"## Available planning capabilities",
		`Snapshot: \`${capabilities.sha256}\``,
		...active.map((entry) => `- \`${entry.name}\` (${entry.kind}): ${entry.description}${entry.planning_note ? ` — ${entry.planning_note}` : ""}`),
		"",
	].join("\n");
}

export function renderStepMarkdown(step: PlanStepV4): string {
	const test = step.test
		? [
			"## Test-first contract",
			`Test paths: ${step.test.paths.map((path) => `\`${path}\``).join(", ") || "(unspecified)"}`,
			`Command: \`${step.test.command}\``,
			`RED: ${step.test.red_expectation}`,
			`GREEN: ${step.test.green_expectation}`,
		].filter(Boolean)
		: step.test_exception
			? [
				"## Approved-test exception",
				`Reason: ${step.test_exception.reason}`,
				`Smallest alternative validation: \`${step.test_exception.validation}\``,
			]
		: ["## Validation", `Command: \`${step.validation ?? ""}\``];
	return [
		`# ${step.order}. ${step.title}`,
		"",
		`Status: ${step.status}`,
		"",
		"## Objective",
		step.objective,
		"",
		"## Acceptance",
		bulletList(step.acceptance),
		"",
		"## Requirement coverage",
		bulletList(step.covers),
		"",
		"## Dependencies",
		`Hard: ${step.hard_depends_on.join(", ") || "(none)"}`,
		`Soft order: ${step.soft_after.join(", ") || "(none)"}`,
		"",
		"## Capabilities",
		`Required: ${step.required_capabilities.join(", ") || "(none)"}`,
		`Fallback: ${step.capability_fallback || "(none)"}`,
		"",
		"## Expected surface",
		bulletList(step.expected_files),
		"",
		...test,
		"",
		"## Replan triggers",
		bulletList(step.invalidated_by),
		"",
		"## Route history",
		step.route_history?.length
			? step.route_history.map((entry) => `- ${entry.at} — ${entry.action}: ${entry.reason}`).join("\n")
			: "(none)",
		"",
	].join("\n");
}

export function renderPlanMarkdown(
	request: string,
	summary: string,
	steps: PlanStepV4[],
	capabilities: CapabilitySnapshot,
	selectedStepId?: string,
): string {
	const table = steps.map((step) =>
		`| ${step.order} | ${step.status} | [${step.title}](./${stepFileName(step)}) | ${step.hard_depends_on.join(", ") || "—"} | ${step.required_capabilities.join(", ") || "—"} |`,
	);
	const requirements = [...new Set(steps.flatMap((step) => step.covers))];
	const coverage = requirements.map((requirement) =>
		`| ${requirement} | ${steps.filter((step) => step.covers.includes(requirement)).map((step) => `\`${step.id}\``).join(", ")} |`,
	);
	return [
		"# Active Plan",
		"",
		"## Request",
		request,
		"",
		"## Summary",
		summary,
		"",
		`Capability snapshot: \`${capabilities.sha256}\``,
		`Current route: ${selectedStepId ? `\`${selectedStepId}\`` : "(none)"}`,
		"",
		"| # | Status | Step | Hard dependencies | Capabilities |",
		"|---:|---|---|---|---|",
		...table,
		"",
		"## Coverage matrix",
		"",
		"| Requirement | Acceptance-bearing steps |",
		"|---|---|",
		...(coverage.length ? coverage : ["| (none) | — |"]),
		"",
	].join("\n");
}
