---
name: lavish-review
description: Visual human review of the CURRENT PLAN (.pi/plan-state.json) via lavish-axi — renders items, dependency graph, and uncertainties to an annotatable HTML artifact and loops feedback back into plan_write. Use when the user wants to review, discuss, or reshape the plan visually ("review the plan with me", "open the plan in lavish"), especially at the plan gate before execution. For generic (non-plan) artifacts, use the `lavish` skill instead.
---

# lavish-review

Render the live plan to an HTML artifact, open it in the lavish-axi browser reviewer, and
loop on the user's annotations until they end the session. Feedback arrives as structured
JSON — selectors, text ranges, Mermaid edits, chat messages — apply it via `plan_write`,
reply, poll again. Highest-leverage moment: the plan gate, before execution burns turns.

## Reviewing the current plan

1. Render the live plan to HTML (writes `artifacts/plan-review.html`, prints the path):

   ```bash
   node "$SKILL_DIR/scripts/render-plan.mjs" .pi/plan-state.json
   ```

2. Open it: `npx -y lavish-axi artifacts/plan-review.html`

## The feedback loop

Repeat until done:

1. `npx -y lavish-axi poll artifacts/plan-review.html` — long-polls; returns JSON:
   - `status: "feedback"` — apply it as `plan_write` updates (retitle/split/reorder/drop
     items, resolve uncertainties; Mermaid whiteboard edits describe dependency changes —
     translate them to `depends_on` updates). Then re-run `render-plan.mjs` so the browser
     view reflects the new plan (lavish live-reloads).
   - `status: "layout_warning"` — fix the reported selector/overflow first, then continue.
   - `status: "ended"` — stop polling, summarize what changed and what remains.
2. After applying a round, poll again with a short receipt:
   `npx -y lavish-axi poll <file> --agent-reply "applied: <one line>"`

## Rules

- One bounded action per feedback item; do not batch speculative changes the user didn't ask for.
- Plan changes go through `plan_write` only — never edit `.pi/plan-state.json` directly.
- If `npx` cannot fetch `lavish-axi` (offline), say so and fall back to plain chat review.
- Never `share`/publish an artifact unless the user explicitly asks.
