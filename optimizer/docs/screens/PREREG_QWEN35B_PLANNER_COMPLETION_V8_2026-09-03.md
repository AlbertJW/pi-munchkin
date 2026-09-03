# Preregistration: Qwen 35B direct-branch planner repair smoke v8 (2026-09-03)

## Status and purpose

**REGISTRATION SNAPSHOT — EXECUTED; INCOMPLETE.** This bounded repair smoke follows the stopped v7
screen. V7 was terminated after two candidate sessions made its hard acceptance
gate impossible: the first reached the output cap with two pending branches and
the second reached the wall while delegated children were still running, leaving
two `child_failed` branches and no merge. The source contract required every
depth-one branch to create scouts even though the profile only permits optional
expansion. V8 tests the corrected contract on one deliberately small,
completion-shaped fixture. It is mechanism evidence only, not a quality study or
permission to enable planner defaults. The single candidate observation and its
stopped control decision are recorded in
`QWEN35B_PLANNER_COMPLETION_V8_AUDIT_2026-09-03.md`; the pre-run identity and
commands below remain the frozen registration snapshot.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source surface SHA-256: `324aa214006f2f67c2350304f39ab45d063e61209c97cb0d4d52e889377e4c9`.
- Loaded mirror surface SHA-256: `73bbd494f5c23f3b7262bd9f17c44b57574ca23d4b211c07dbd1d6067c23c315`.
- Candidate configuration SHA-256: `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`.
- Control configuration SHA-256: `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.

The source hash is a pending model-visible boundary. The loaded hash must be
rebound after the source is mirrored; no session may run while the two differ.
The launcher must resolve the loaded hash immediately before each invocation.

## Fixture and arms

Use only the admitted completion-shaped fixture
`compare-json-yaml-config`, manifest SHA-256
`c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646`. The
parent asks for one bounded JSON branch and one bounded YAML branch, one cited
claim and limitation per branch, then a conditional synthesis. Each branch can
finish directly with one official read; no scout split is required.

Run exactly one candidate invocation with `PLAN_GRAPH=on`,
`DEEP_RESEARCH_PLANNING=on`, `RESEARCH_LEDGER=on`, and the parent-only headless
lease. Run exactly one negative-control invocation with the control arm and the
embedded fact-lookup prompt. All other settings remain unchanged. Use a fresh
private copy of the agent directory and project directory for each invocation,
the pinned Qwen subject, a 180-second wall, and a 350,000-byte combined
stdout/stderr cap.

## Mechanism observations

The candidate is provisionally operable only if it records exactly one
`research-start`, two validated `branch-merged` events, and one terminal parent
`settled` event after parent evidence rereads. Both branches must be terminal,
covered, and within the shared three-search/five-read envelope. A direct branch
report must contain no children and must account for its observed usage. Any
branch failure, depth violation, budget inflation, duplicate settlement, raw
payload telemetry, or child mutation of the parent capsule invalidates the
observation.

The negative control must record zero `research-start`, `branch-merged`, and
`settled` events. A timeout, output cap, missing report, or interrupted child is
an incomplete lifecycle observation, never a pass or quality score. Retain only
payload-free counts and classifications in the repository; keep prompts,
queries, URLs, quotes, answers, and raw streams private.

## Commands

Before execution, run the admission and preflight self-tests and a no-inference
preflight against the live agent directory. For each invocation use
`optimizer/v2/planner_smoke.py` with the fixture manifest and its exact digest,
the newly rebound loaded hash, private `--output`, `--stderr`, and `--telemetry`
paths, and the corresponding `--arm`. The `--run` flag is the only model-
executing mode and requires explicit human approval.

## Interpretation and follow-up

A clean result establishes only that a small direct-completion branch can reach
validated merges and parent settlement on this subject. It does not establish
research answer quality, cost, or general planner benefit. If clean, issue a
fresh full V9 screen with the original four-fixture candidate/control design. If
incomplete, diagnose the next lifecycle boundary and keep both planner flags
dark. No mirror, source-tree, default, adoption, or historical-evidence change
is authorized by this document.
