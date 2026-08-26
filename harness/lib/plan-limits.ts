// plan-limits — the plan bounds, in one place.
//
// These were literals repeated across four files and nine enforcement layers: a
// runtime constant in plan-runner, five TypeBox `maxLength`s in the tool schemas the
// model actually sees, plan-delta's validator, plan-graph's `boundedText`, and
// branch-report's merged-child check. The 2026-08-25 raise from 300 had to touch all
// nine by hand, and the note in CHANGELOG explaining why a partial raise would "split
// the churn across tools" is precisely the failure mode a shared constant removes.
//
// The model-visible number is the TypeBox `maxLength`, not the runtime constant —
// it is what reaches the schema, and it fires before `execute()` ever runs. So the
// schemas import from here too; nothing is allowed to state a bound independently.
//
// harness/lib/working-memory.ts:8 established this pattern in the same directory.

/** Per-item note. The model-visible schema bound and every validator agree on it. */
export const PLAN_NOTE_MAX_BYTES = 900;

/** Per-item title. */
export const PLAN_TITLE_MAX_BYTES = 120;

/** Each of a deferral's value / risk / rationale fields. */
export const PLAN_DEFER_FIELD_MAX_BYTES = 300;

/** Top-level items in one plan. */
export const PLAN_MAX_ITEMS = 24;

/** Deltas in one plan_update. Matches PLAN_MAX_ITEMS so a full-plan status resend
 *  cannot die in the schema validator (audit B5, 2026-08-25). */
export const PLAN_MAX_DELTAS = 24;

/** The authoritative state file. A full PLAN_MAX_ITEMS plan at PLAN_NOTE_MAX_BYTES
 *  notes is roughly 27.7 KB, so this must stay clear of that or note churn simply
 *  becomes whole-plan-rejection churn. */
export const PLAN_STATE_MAX_BYTES = 32 * 1024;
