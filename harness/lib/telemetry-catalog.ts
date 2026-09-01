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
	"telemetry/writer-overflow": { dropped_rows: "number" },
	"session-bootstrap/surface-unavailable": { reason: "string" },
	"control-arbiter/decision": {
		mode: "string", proposals: "number", collisions: "number", legacy_actions: "number",
		winner_kind: "string", winner_source: "string", winner_reason: "string", boundary_sequence: "number",
		lens_merged: "boolean", verification_merged: "boolean",
	},
	"verify-gate/gate-green-consumed": {},
	"verify-gate/gate-green-execution-ordered": { started_sequence: "number", ended_sequence: "number" },
	"verify-gate/steer": { failed: "boolean", fires: "number", sessionFires: "number", injected_chars: "number", turnIndex: "number" },
	"verify-gate/unverified-end": { fires: "number", sessionFires: "number" },
	"verification-frontier/settled": {
		protocol: "string", recognized_gates: "number",
		current_passed: ["number", "null"], current_failed: ["number", "null"],
		current_skipped: ["number", "null"], current_total: ["number", "null"],
		best_passed: ["number", "null"], best_failed: ["number", "null"],
		best_skipped: ["number", "null"], best_total: ["number", "null"],
		last_advanced: "boolean", plateau_streak: "number",
		 successful_mutation_epochs_since_advance: "number", verification_plateau_overrun: "number",
	},
	"verification-plateau/observed": {
		mode: "string", streak: "number", gate_hash: "string", plan_item_hash: "string",
	},
	"verification-plateau/intervention": {
		tier: "number", streak: "number", injected_chars: "number", activation_requested: "boolean",
		// injected_chars counts what was DELIVERED, so it is 0 whenever the control
		// arbiter is not enforcing on this bus -- the tier-1 correction has no legacy
		// delivery path of its own. `delivered` makes the difference between
		// "no plateau fired" and "plateau fired into a shadow arbiter" readable.
		delivered: "boolean", arbiter: "string",
	},
	"verification-plateau/settled": {
		mode: "string", eligible_epochs: "number", plateau_events: "number", max_streak: "number",
		frontier_advances: "number", current_streak: "number", pending_successful_mutation: "boolean",
		corrections: "number", activation_requests: "number",
	},
	"did-you-mean/hint": { tool: "string", injected_chars: "number" },
	"chaos/injected": { fault: "string", tool: "string", nth: "number" },
	"plan-runner/start": { request_bytes: "number" },
	"plan-runner/write": { items: "number", open_items: "number", rewrite: "boolean" },
	"plan-runner/write-rejected": { reason_class: "string" },
	"plan-runner/delta": { changed: "number", idempotent: "number", open_items: "number" },
	"plan-runner/go": { resumed: "boolean" },
	"plan-runner/plan-mode-block": { toolName: "string" },
	"plan-runner/ended-open": { open_items: "number" },
	"plan-runner/research-start": { items: "number", open_items: "number" },
	"plan-runner/expand": { parent_item_id: "string", children: "number", open_items: "number" },
	"plan-runner/branch-merged": { children: "number", lead_count: "number", evidence_gaps: "number" },
	"plan-runner/branch-failed": { failure_class: "string" },
	"plan-runner/settled": { items: "number", deferred: "number" },
	"goal-runner/proposed": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/started": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/accepted": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/updated": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/settled": { goal_id_hash: "string", status: "string", open_criteria: "number", outcome: "string", deferred: "number" },
	"goal-runner/resumed": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/paused": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/blocked": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"goal-runner/cancelled": { goal_id_hash: "string", status: "string", open_criteria: "number" },
	"git-guard/blocked-unresolved-target": { reason: "string" },
	"git-guard/confirm": { approved: "boolean", changes: "number" },
	"context-inlet-guard/block": { risky: "boolean", bytes: "number", n: "number", bigLimit: "boolean" },
	"surface-receipt/surface": { sha256: "string" },
	// Registry contextWindow vs the server's actually-served n_ctx, probed once
	// per model per session after the first successful response. No URLs by
	// construction (FORBIDDEN_DETAIL_FIELD would ban them anyway).
	"runtime/serving-truth": { served_n_ctx: "number", registry_ctx: "number", verdict: "string" },
	// provider/model are deliberately NOT declared here: normalizeDetail strips
	// them from detail (RESERVED_FIELDS) and consumes them as envelope fallbacks.
	"runtime/context-profile": { epoch: "number", declared_ctx: ["number", "null"], served_ctx: ["number", "null"], safe_input: ["number", "null"], confidence: "string", profile_source: "string", serving_fingerprint: "string" },
	"runtime/context-budget": { epoch: "number", previous_safe_input: "number", safe_input: "number", handoff_required: "boolean" },
	"runtime/context-calibration": { epoch: "number", success: "boolean", status: "number", failure: "string", safe_input: "number" },
	"runtime/context-handoff": { from_epoch: "number", to_epoch: "number", reason_class: "string", ok: "boolean" },
	"runtime/provider-timing": {
		request_seq: "number", request_to_headers_ms: ["number", "null"],
		first_token_ms: ["number", "null"], stream_completion_ms: ["number", "null"],
		settlement_ms: ["number", "null"], status: ["number", "null"],
	},
	"runtime/protocol-parity": {
		api: "string", reasoning: "string", thinking_format: "string", thinking_levels: "number",
		strict_sampling: "string", stream_shape: "string", thinking_observed: "boolean", toolcalls_observed: "boolean",
		text_deltas: "number", thinking_deltas: "number", toolcall_deltas: "number",
	},
	"run-kernel/receipt": {
		tool: "string", tool_family: "string", status: "string", mutation: "string",
		verification: "string", failure_class: ["string", "null"], result_bytes: "number",
		started_sequence: "number", ended_sequence: "number", had_start: "boolean", had_result: "boolean",
	},
	"run-kernel/transition": { from_phase: "string", to_phase: "string", reason: "string", sequence: "number" },
	"run-kernel/legacy-disagreement": { dimension: "string", kernel_value: "boolean", legacy_value: "boolean" },
	"run-kernel/restored": { restore_source: "string", surface_changed: "boolean", sequence_floor: "number" },
	"run-kernel/objective-abandoned": { previous_outcome: "string" },
	"run-kernel/settled": {
		phase: "string", outcome: "string", lifecycle: "string", receipts: "number", failures: "number",
		active_walls: "number", mutations: "number", verification_attempts: "number", valid_gates: "number", transitions: "number",
		missing_start: "number", missing_result: "number", validation_errors: "number",
	},
	"run-kernel/projection-check": { check_kind: "string", ok: "boolean", reason: "string" },
	"run-capsule/checkpoint": { ok: "boolean", state_bytes: "number", markdown_bytes: "number", failure_class: ["string", "null"] },
	"run-capsule/entry": { ok: "boolean", failure_class: ["string", "null"], state_bytes: "number" },
	"run-capsule/recovery-brief": { reason: "string", brief_bytes: "number", generation: "number" },
	"working-memory/upsert": { record_hash: "string", active: "number", total: "number", state_bytes: "number", superseded: "boolean" },
	"working-memory/resolve": { record_hash: "string", active: "number", total: "number", state_bytes: "number" },
	"working-memory/list": { active: "number", total: "number", state_bytes: "number" },
	"working-memory/settled": {
		active: "number", total: "number", state_bytes: "number", writes: "number",
		lists: "number", resolutions: "number", supersessions: "number",
	},
	"loop-breaker/compact-reset": { streak: "number", blocked: "number" },
	"loop-breaker/session-repeat": { repeats: "number", turnIndex: "number" },
	"loop-breaker/outcome-steer": { n: "number", final: "boolean", injected_chars: "number", turnIndex: "number" },
	"loop-breaker/outcome-abort": { n: "number", turnIndex: "number" },
	"loop-breaker/progress-after-steer": { turns_since: "number" },
	"loop-breaker/steer": { tier: "number", byTool: "boolean", byReason: "boolean", repeat: "number", streak: "number", injected_chars: "number", turnIndex: "number" },
	"loop-breaker/abort": { streak: "number", turnIndex: "number" },
	"loop-breaker/block": { tool: "string", abortArmed: "boolean" },
	"failure-episode/opened": {
		episode_id: "string", failure_class: "string", tool_family: "string",
		target_hash: "string", plan_item_hash: "string",
	},
	"failure-episode/observed": {
		episode_id: "string", failure_class: "string", count: "number",
		calls_after_second: "number", correlated_calls_after_second: "number", call_variant_count: "number",
	},
	"failure-episode/recovered": {
		episode_id: "string", failure_class: "string", count: "number",
		calls_after_second: "number", correlated_calls_after_second: "number", recovery: "string",
	},
	// Verification ABANDONED same-target episodes (degraded research_note):
	// terminal, distinct from recovery — abandonment must never inflate recovery.
	"failure-episode/abandoned": { episode_id: "string", failure_class: "string", count: "number" },
	"failure-episode/settled": {
		total_episodes: "number", total_failures: "number", longest_episode: "number",
		semantic_failure_overrun: "number", correlated_failure_overrun: "number", settled_without_recovery: "number",
	},
	"failure-episode/tier-observed": {
		tier: "number", detector: "string", mode: "string", failure_class: "string",
		count: "number", session_repeats: "number",
	},
	"failure-episode/intervention": {
		tier: "number", detector: "string", failure_class: "string", count: "number",
		session_repeats: "number", injected_chars: "number", turnIndex: "number",
	},
	"failure-episode/receipt": { persisted: "boolean", call_variant_count: "number" },
	"failure-episode/resumed": { cleared: "number", blocked: "number", injected_chars: "number" },
	"drift-scanner/review-skipped": { why: "string" },
	"drift-scanner/review-start": { diffChars: "number", truncated: "boolean" },
	"drift-scanner/review-null": { stopReason: "string", textLen: "number" },
	"drift-scanner/advisory": { chars: "number" },
	"drift-scanner/review-error": failure,
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
	"blackboard/restore-rejected": { attempts: "number" },
	// `delivered` distinguishes "the arbiter merged and showed this lens" from "it was
	// dropped". Without it the row could only ever be written on the legacy path, so
	// under the shipped enforce default lens exposure read zero.
	"state-lens/steer-injected": { chars: "number", turnIndex: "number", delivered: "boolean" },
	"tool-activation/deferred": { tool: "string", reason: "string" },
	"tool-activation/activated": { tool: "string", reason: "string" },
	"tool-activation/deactivated": { tool: "string", reason: "string" },
	"tool-activation/preserved-explicit": { tool: "string", reason: "string" },
	"tool-activation/unavailable": { tool: "string", reason: "string" },
	"tool-activation/first-useful-mutation": { elapsed_ms: "number", tool: "string" },
	"tool-activation/surface": { mode: "string", surface_mode: "string", active_tools: "number", all_tools: "number", schema_bytes: "number", guideline_bytes: "number", deferred_tools: "number", unavailable_attempts: "number" },
	"tool-call-rescue/detected": { signature: "string", turnIndex: "number" },
	// `steered` is recorded when the message actually REACHED the model, and the
	// session budget is charged at the same moment. tool_rescue has the second-lowest
	// arbiter priority, so under the shipped CONTROL_ARBITER=enforce it frequently
	// loses the boundary to a failure_recovery or verification_required proposal.
	"tool-call-rescue/steered": { signature: "string", turnIndex: "number", delivered: "boolean" },
	"teach-hints/hint": { rule: "string", tool: "string", injected_chars: "number" },
	// research-ledger (dark, RESEARCH_LEDGER=on). No URLs or queries, by design —
	// normalizeDetail's FORBIDDEN_DETAIL_FIELD bans them, and the ledger FILE is
	// where provenance lives. reason_class, the FULL set (an analysis that buckets
	// on `ok` is safe; one that buckets on reason_class must carry all six or it
	// undercounts): ok | corrected | url_not_read | quote_not_found |
	// quote_ambiguous | ledger_write_failed | ledger_full. `corrected` ships with ok:true — the
	// quote was verbatim in a fetched page OTHER than the one the model named, so
	// it recorded under the true source; `quote_ambiguous` ships with ok:false.
	// `failure_class` appears only on persistence/capacity failures; quote refusals
	// are deterministically classified by failure-episodes from their fixed text.
	"research/note": { ok: "boolean", reason_class: "string", failure_class: "string", quote_chars: "number" },
	"research/recall": { shown: "number", omitted: "number", suffix_truncated: "boolean" },
	"research/run-summary": { searches: "number", reads: "number", notes: "number", notes_rejected: "number", cache_hits: "number" },
	// Fired once when an answer wraps up after web reads with zero recorded notes.
	"research/wrap-steer": { reads: "number", notes: "number", injected_chars: "number" },
	"context-brief/injected": { brief_bytes: "number", entries: "number", truncated: "boolean" },
	"bash-output-guard/withheld": { chars: "number", max_chars: "number", cwd_escape_suspected: "boolean" },
	"context-dedup/dedup": { replaced: "number", saved_bytes: "number" },
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
	"context-surface/summary": {
		call: "number", context_tokens: ["number", "null"], context_window: ["number", "null"],
		context_pct: ["number", "null"], compaction_generation: "number", reason: "string",
	},
} as const satisfies Readonly<Record<string, TelemetryDetailSchema>>;

export type CatalogEventKey = keyof typeof EVENT_CATALOG;

function valueType(value: unknown): TelemetryFieldType | "object" | "undefined" | "empty[]" {
	if (value === null) return "null";
	if (Array.isArray(value)) {
		// An EMPTY array satisfies every element predicate vacuously, so it used to
		// type as "string[]" and a declared number[] field rejected it — taking the
		// WHOLE row with it (telemetry.ts replaces a rejected row with a
		// schema-reject stub). A context call with zero tool results is ordinary,
		// and 12 such rows were silently destroyed in the live corpus before this
		// was found. "empty[]" is element-agnostic and satisfies any array type.
		if (value.length === 0) return "empty[]";
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
// go/go-blocked `source`). run_id/provider/model remain detail-overridable for
// existing event callers; requested_* are launcher identity fields and are
// reserved like the other envelope values.
// Exported so the static half of this guard (telemetry-catalog.test.ts) can assert
// against the real set rather than a copy that drifts.
export const RESERVED_ENVELOPE_FIELDS = new Set([
	"schema", "ts", "seq", "source", "sk", "si", "sp", "harness_surface_sha256", "config_sha256", "requested_provider", "requested_model", "invocation_id", "ext", "kind",
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
		// "empty[]" is accepted by any array-typed field: [] carries no element
		// evidence either way, and rejecting it deleted legitimate rows.
		const satisfied = (allowed as readonly string[]).includes(actual) ||
			(actual === "empty[]" && (allowed as readonly string[]).some((type) => type.endsWith("[]")));
		if (!satisfied) errors.push(`invalid ${field}: expected ${allowed.join("|")}, got ${actual}`);
	}
	return errors;
}

export function catalogHas(ext: string, kind: string): boolean {
	return `${ext}/${kind}` in EVENT_CATALOG;
}
