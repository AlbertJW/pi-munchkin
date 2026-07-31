export type TelemetryScalarType = "string" | "number" | "boolean" | "null";
export type TelemetryFieldType = TelemetryScalarType | `${Exclude<TelemetryScalarType, "null">}[]`;
export type TelemetryDetailSchema = Readonly<Record<string, TelemetryFieldType | readonly TelemetryFieldType[]>>;

const usage = {
	contextTokens: ["number", "null"],
	contextWindow: ["number", "null"],
	contextPct: ["number", "null"],
} as const;

const failure = {
	error_class: "string",
	error_length: "number",
	error_sha256: "string",
} as const;

export const EVENT_CATALOG = {
	"telemetry/schema-reject": { rejected_count: "number", reason_class: "string" },
	"verify-gate/gate-green-consumed": {},
	"verify-gate/steer": { failed: "boolean", fires: "number", sessionFires: "number", injected_chars: "number", turnIndex: "number" },
	"verify-gate/unverified-end": { fires: "number", sessionFires: "number" },
	"did-you-mean/hint": { tool: "string", injected_chars: "number" },
	"chaos/injected": { fault: "string", tool: "string", nth: "number" },
	"plan-runner/deps-rejected": { errors: "number" },
	"plan-runner/gate": { pass: "boolean", fails: "number", rung: "number", recovered: "boolean", prior_fails: "number", terminal: "boolean" },
	"plan-runner/integrity": { reattached: "number", preserved: "number", yielded: "number" },
	"plan-runner/thrash-warn": { streak: "number" },
	"plan-runner/resume-found": { open: "number", in_progress: "number" },
	"plan-runner/subagent-only-block": { toolName: "string" },
	"plan-runner/delegate-all-block": { toolName: "string" },
	"plan-runner/delegate-all-subagent": { agent: "string", mode: "string" },
	"plan-runner/force-plan-write-block": { toolName: "string" },
	"plan-runner/write": { items: "number", newly_done: "number", rewrite: "boolean", declared_dependencies: "number", unmet_dependencies: "number", dependency_compliant: "boolean", context_tokens: ["number", "null"] },
	"plan-runner/uncertainty-hold": { count: "number", gate: "string" },
	"plan-runner/sha-guard": { checked: "number", missing: "number" },
	"plan-runner/write-rejected": { reason_class: "string", context_tokens: ["number", "null"] },
	// `activation` ("command"|"tool") added 2026-07-30 when /plan-go and the plan_go
	// tool were unified: both now emit these. Rows before that date are all
	// tool-path (the command emitted nothing). `go` still excludes yolo starts —
	// /plan yolo flips phase in startPlanCommand without a go event, so this
	// metric means "explicit go activation", not "execution started".
	"plan-runner/go": { resumed: "boolean", stale: "number", activation: "string" },
	"plan-runner/go-blocked": { reason: "string", activation: "string" },
	// `block_kind`, not `kind`: a detail field named `kind` OVERWRITES the envelope's
	// kind (the event name itself), so every row this ever wrote was labelled
	// "inspect"/"mutate" instead of "plan-mode-block" and the event was unfindable
	// by name. Caught 2026-07-31 by the reserved-field guard on its first run.
	"plan-runner/plan-mode-block": { toolName: "string", block_kind: "string" },
	"git-guard/blocked-unresolved-target": { reason: "string" },
	"git-guard/confirm": { approved: "boolean", changes: "number" },
	"context-inlet-guard/block": { risky: "boolean", bytes: "number", n: "number", bigLimit: "boolean" },
	"surface-receipt/surface": { sha256: "string" },
	"loop-breaker/compact-reset": { streak: "number", blocked: "number" },
	"loop-breaker/session-repeat": { repeats: "number", turnIndex: "number" },
	"loop-breaker/outcome-steer": { n: "number", final: "boolean", injected_chars: "number", turnIndex: "number" },
	"loop-breaker/outcome-abort": { n: "number", turnIndex: "number" },
	"loop-breaker/progress-after-steer": { turns_since: "number" },
	"loop-breaker/steer": { tier: "number", byTool: "boolean", byReason: "boolean", repeat: "number", streak: "number", injected_chars: "number", turnIndex: "number" },
	"loop-breaker/abort": { streak: "number", turnIndex: "number" },
	"loop-breaker/block": { tool: "string", abortArmed: "boolean" },
	"drift-scanner/review-skipped": { why: "string" },
	"drift-scanner/review-start": { diffChars: "number", truncated: "boolean" },
	"drift-scanner/review-null": { stopReason: "string", textLen: "number" },
	"drift-scanner/advisory": { chars: "number" },
	"drift-scanner/review-error": failure,
	"micro-gate/skipped": { reason: "string", file: "string", files: "number", checked: "number" },
	"micro-gate/checker-error": { file: "string", ...failure },
	"micro-gate/passed": { files: "number", checked: "number" },
	"micro-gate/fired": { files: "number", injected_chars: "number" },
	"reflect/review-error": failure,
	"reflect/review": { round: "number", clean: "boolean", chars: "number" },
	"span-tools/search": { total: "number", shown: "number" },
	"span-tools/read": { start: "number", end: "number" },
	"ketch/search": {
		mode: "string", backends: "string[]", attempts: "number", results: "number", chars: "number",
		duration_ms: "number", truncated: "boolean", outcome: "string",
	},
	"ketch/read": {
		sources: "number", succeeded: "number", failed: "number", chars: "number",
		duration_ms: "number", truncated: "boolean", outcome: "string",
	},
	"context-watcher/compacted": { ...usage, requester: "string", contentProvider: "string", reason: "string", willRetry: "boolean", tokensBefore: "number" },
	"blackboard/rendered": { chars: "number", attempts: "number" },
	"blackboard/restored": { attempts: "number" },
	"state-lens/view-injected": { chars: "number", turnIndex: "number" },
	"state-lens/steer-injected": { chars: "number", turnIndex: "number" },
	"tool-call-rescue/detected": { signature: "string", turnIndex: "number" },
	"tool-call-rescue/steered": { signature: "string", turnIndex: "number" },
	"spec-adherence/armed": { specs: "number" },
	"spec-adherence/steered": { path: "string", turnIndex: "number" },
	"teach-hints/hint": { rule: "string", tool: "string", injected_chars: "number" },
	"micro-gate/slop-fired": { files: "number", findings: "number", injected_chars: "number" },
	"micro-gate/slop-passed": { files: "number", checked: "number" },
	"micro-gate/slop-checker-error": { file: "string", ...failure },
	"context-brief/injected": { brief_bytes: "number", entries: "number", truncated: "boolean" },
	"bash-output-guard/withheld": { chars: "number", max_chars: "number", cwd_escape_suspected: "boolean" },
	"context-dedup/dedup": { replaced: "number", saved_bytes: "number" },
	"context-dedup/nudge": { share_pct: "number", injected_chars: "number", turnIndex: "number" },
	"context-surface/receipt": {
		surface_sha256: "string", system_prompt_sha256: "string", system_prompt_bytes: "number",
		message_count: "number", user_messages: "number", assistant_messages: "number", tool_messages: "number", custom_messages: "number",
		user_text_bytes: "number", assistant_text_bytes: "number", tool_text_bytes: "number", custom_text_bytes: "number",
		image_count: "number", image_bytes: "number", tool_names: "string[]", tool_result_bytes: "number[]",
		largest_message_share: "number", largest_tool_result_share: "number", exact_duplicate_block_share: "number",
		repeated_five_token_shingle_share: "number", stale_tool_result_share: "number",
		near_duplicate_block_share: "number",
		prefix_stable: ["boolean", "null"], appended_only: ["boolean", "null"], system_prompt_changed: ["boolean", "null"],
		context_tokens: ["number", "null"], context_window: ["number", "null"], context_pct: ["number", "null"],
		compaction_generation: "number", plan_run_id: ["string", "null"], plan_item_id: ["string", "null"],
	},
} as const satisfies Readonly<Record<string, TelemetryDetailSchema>>;

export type CatalogEventKey = keyof typeof EVENT_CATALOG;

function valueType(value: unknown): TelemetryFieldType | "object" | "undefined" {
	if (value === null) return "null";
	if (Array.isArray(value)) {
		if (value.every((item) => typeof item === "string")) return "string[]";
		if (value.every((item) => typeof item === "number")) return "number[]";
		if (value.every((item) => typeof item === "boolean")) return "boolean[]";
		return "object";
	}
	const type = typeof value;
	return type === "string" || type === "number" || type === "boolean" || type === "undefined" ? type : "object";
}

// Detail is spread OVER the envelope in telemetry.ts's appendRow, so a detail key
// with one of these names silently REPLACES the envelope's value. That is not a
// style issue: `source` carries TELEMETRY_SOURCE, and context_telemetry.py:49,62,78
// discards every event whose source != "gate" — so a detail field named `source`
// makes the event vanish from every gate round's extraction, reading as a mechanism
// that never fired. Introduced and caught the same day (2026-07-31, plan-runner's
// go/go-blocked `source`). run_id/provider/model are deliberately NOT reserved:
// envelope() reads them from detail on purpose and writes back the same value.
const RESERVED_ENVELOPE_FIELDS = new Set([
	"schema", "ts", "seq", "source", "sk", "harness_surface_sha256", "config_sha256", "ext", "kind",
]);

export function validateCatalogDetail(ext: string, kind: string, detail: Record<string, unknown>): string[] {
	const schema = EVENT_CATALOG[`${ext}/${kind}` as CatalogEventKey] as TelemetryDetailSchema | undefined;
	if (!schema) return [`unknown event ${ext}/${kind}`];
	const errors: string[] = [];
	for (const [field, value] of Object.entries(detail)) {
		if (value === undefined) continue;
		if (RESERVED_ENVELOPE_FIELDS.has(field)) {
			errors.push(`field ${field} shadows a telemetry envelope key`);
			continue;
		}
		const expected = schema[field];
		if (!expected) {
			errors.push(`unknown field ${field}`);
			continue;
		}
		const actual = valueType(value);
		const allowed = Array.isArray(expected) ? expected : [expected];
		if (!(allowed as readonly string[]).includes(actual)) errors.push(`invalid ${field}: expected ${allowed.join("|")}, got ${actual}`);
	}
	return errors;
}

export function catalogHas(ext: string, kind: string): boolean {
	return `${ext}/${kind}` in EVENT_CATALOG;
}
