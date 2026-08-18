# Mirror-mini fixture generation (2026-08)

This generation adds two unapproved `pi.fixture/v3` instruments. It does not
start a Ling calibration and does not make a difficulty or efficacy claim.

`mirror-cross-file-cli` tests a cross-file semantic invariant through observable
behaviour: a parser must follow the live policy vocabulary while preserving the
CLI contract and transition rules. Its duplicate-vocabulary, parser-only, and
visible-case-hardcode shortcuts score 60/100, 30/100, and 15/100 across three
identical admission runs. `mirror-partial-order-cli` tests
an algorithm-class change from sorting to a dependency-aware ready-set
scheduler. Its local-parent, depth-first, and visible-ID-hardcode shortcuts score
50/100, 30/100, and 30/100.
Gold scores 100/100 and pristine fails the hidden suite for both fixtures.

The scores above demonstrate that the instruments can represent partial
solutions; they do not predict Ling Tiny's score distribution. The existing
six-session admission rule remains the only model-specific band decision.

Each requirement maps a visible seed case to two hidden siblings with changed
values or graph structure. The authoritative runner grades the hidden TAP names
using fixed percentage points from the admitted manifest. Missing, renamed, or
unexpected case populations are refused. Strict gate exit status remains the
correctness bit. The explicit hardcode mutants prove that copying the visible
answers does not satisfy the corresponding hidden duals.

Each fixture also has a deterministic execute-only oracle. Admission runs the
same bounded self-test three times and stores only byte counts and hashes. The
oracle is outside the candidate fixture, omitted from one-shot context, never
installed as an overlay, and inaccessible to the evaluated agent under the
existing repository read jail. The gate currently uses hidden duals, not oracle
queries. Any future oracle-query experiment needs a separate parent-owned
broker and approval.

Both manifests remain `approved: false`. Human fixture review and any
calibration are separate checkpoints. Measurements from this generation must
bind the fixture version and hashes and must not be pooled with v1/v2 fixtures.
