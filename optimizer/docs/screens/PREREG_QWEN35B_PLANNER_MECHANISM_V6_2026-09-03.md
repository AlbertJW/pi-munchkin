# Preregistration amendment: Qwen 35B hierarchical planner routing screen v6 (2026-09-03)

## Status and purpose

**SCREENED — INCOMPLETE MECHANISM; GATE NOT MET.** This amendment follows the incomplete v5
mechanism screen and addresses a concrete model-facing contract defect found in
its structural traces. When root allocations exceeded the shared discovery
envelope, `research_plan_start` returned only “root budgets exceed the
deep-research discovery envelope”; the model had to infer the actual limits and
repeated invalid calls. The tool now reports the actionable limit (at most
three searches and five reads total) and the requested allocation. This is a
routing/lifecycle intervention only, not an efficacy comparison or permission
to enable planner defaults.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source commit: `cc74517` (`fix(planner): explain discovery budget rejection`).
- Source surface SHA-256:
  `0d3c7871a22d210ba52cf2f3117a5da9cef087fb4caee4e6c46c3601224a88e6`.
- Loaded mirror surface SHA-256:
  `12fbe4cd2f6555f24810af69d914037d0d20d9a1c3c930f47e2a8c4b52ab27e9`.
  `mirror:check` reports 122/122 first-party files with zero drift.
- Candidate and control configuration hashes remain those in v2–v5:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e` and
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.

The only source change after v5 is the bounded error guidance and its
regression test. It does not alter budgets, graph semantics, defaults, or
candidate/control flags.

## Diagnosis and bounded follow-up

The v5 screen produced candidate starts in 3/6 sessions, no validated merges,
and no parent settlements. Its repeated budget rejection exposed a failure of
the tool contract rather than evidence about model quality. V6 therefore uses
one short, explicit diagnostic against the exact loaded hash after mirroring.
The diagnostic records only safe lifecycle aggregates and checks whether an
over-budget request receives the actionable envelope and whether a corrected
request can reach `research-start`; it does not claim a qualifying screen.

The single v6 diagnostic then ran against the exact loaded hash. It reached
one `research-start`, nine source receipts, and the bounded output cap after
60.514 seconds (exit 143), with 113 payload-free authenticated rows, no branch
merge, and no parent settlement. The new actionable envelope appeared four
times and the old generic error zero times. The diagnostic is an incomplete
operability observation, not a qualifying screen.

The full six-candidate/three-control screen remains invalidated by v5’s
incomplete mechanism gate. Any new multi-session screen requires a fresh
preregistration after reviewing this diagnostic. Planner flags remain dark,
and no quality, adoption, mirror, or source-tree decision follows from this
amendment.

## Execution and acceptance

Before the diagnostic, require the source hash above, a newly observed loaded
hash, the arm-qualified launcher, the frozen fixture, and no running Pi
process. Use the existing 180-second / 350,000-byte bounds. Accept only a
payload-free, provenance-complete receipt with no identity drift; a timeout,
missing graph event, malformed report, or incomplete lifecycle is an
operability observation, not a quality result. Do not pool it with v2–v5.

This amendment authorizes no further model execution beyond the single bounded
diagnostic described above and authorizes no default change. A later screen
must be separately prepared and explicitly approved.
