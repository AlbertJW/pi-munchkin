# Archive

Nothing in this directory is current. Nothing in it was rewritten.

Two kinds of file live here, and the distinction matters.

## `qa/` — counterfactual proof records

Each of these records a **destructive experiment that cannot be re-run**: a defect was
deliberately reintroduced, a named test was observed failing, and the fix was restored. The
counterfactual itself was never committed, so the claim "this test actually discriminates" is
not recoverable from the current tree or from git history. These files are the only evidence
that the regression suite does what it says.

They are append-only. Do not condense them, do not merge them into prose, and do not "update"
a recorded failure to match current line numbers.

## `design/` — design notes for behaviour that has since shipped

These describe mechanisms at the moment they were written, when most were dark and unmirrored.
Their status headers are now wrong by construction — a document that says "not mirrored" was
accurate the day it was written and became false the day the feature was adopted. Several
already carry their own supersession banners.

They are kept because they explain *why* a mechanism has the shape it does, and because the
surface hashes they quote are how you locate the measurement epoch a historical result belongs
to. For what any flag does **today**, read [`../ARCHITECTURE.md`](../ARCHITECTURE.md) and the
configuration table in the top-level [`README.md`](../../README.md) — not these.

## Where the live documents are

| question | file |
|---|---|
| What does the harness do, and how do the parts fit together? | [`../ARCHITECTURE.md`](../ARCHITECTURE.md) |
| Which surface was loaded when, and what may be pooled with what? | [`../SURFACE_BOUNDARIES.md`](../SURFACE_BOUNDARIES.md) |
| What changed, and when? | [`../../CHANGELOG.md`](../../CHANGELOG.md) |
| What ran, and what did it conclude? | [`../../optimizer/docs/SCREENS.md`](../../optimizer/docs/SCREENS.md) |
