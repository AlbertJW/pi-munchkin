---
name: lavish-review
description: Visual human review of an explicitly exported current Pi Munchkin plan via lavish-axi. Renders flat or hierarchical items to an annotatable HTML artifact and loops structural feedback through plan_write or plan_expand. Use when the user asks to review or reshape the active plan visually. For generic artifacts, use the `lavish` skill instead.
---

# lavish-review

Render the live plan to an HTML artifact, open it in the lavish-axi browser reviewer, and
loop on the user's annotations until they end the session. The authoritative plan is private;
never read or edit its capsule path directly. Feedback arrives as structured JSON — selectors,
text ranges, Mermaid edits, chat messages — apply flat structural changes through `plan_write`,
graph expansion through `plan_expand`, and status through `plan_update`.

## Reviewing the current plan

1. Ask the user to run `/plan-export`. This explicit command writes the review snapshot to
   `.pi/plan-review.json` and the human-readable checklist to `.pi/TODO.md`.
2. Render the exported snapshot to HTML (writes `artifacts/plan-review.html`, prints the path):

   ```bash
   node "$SKILL_DIR/scripts/render-plan.mjs" .pi/plan-review.json
   ```

3. Open it: `npx -y lavish-axi artifacts/plan-review.html`

## The feedback loop

Repeat until done:

1. `npx -y lavish-axi poll artifacts/plan-review.html` — long-polls; returns JSON:
   - `status: "feedback"` — apply status/note changes with `plan_update`; use `plan_write`
     only for a flat-plan structural revision and `plan_expand` only to attach graph children.
     Parent-child Mermaid edits map to `parent_id` relationships; there are no per-item gates or
     dependency receipts. Ask the user to `/plan-export` again, then rerun the renderer.
   - `status: "layout_warning"` — fix the reported selector/overflow first, then continue.
   - `status: "ended"` — stop polling, summarize what changed and what remains.
2. After applying a round, poll again with a short receipt:
   `npx -y lavish-axi poll <file> --agent-reply "applied: <one line>"`

## Rules

- One bounded action per feedback item; do not batch speculative changes the user didn't ask for.
- Plan changes go through planner tools only — never edit private capsule state or the exported snapshot directly.
- If `npx` cannot fetch `lavish-axi` (offline), say so and fall back to plain chat review.
- Never `share`/publish an artifact unless the user explicitly asks.
