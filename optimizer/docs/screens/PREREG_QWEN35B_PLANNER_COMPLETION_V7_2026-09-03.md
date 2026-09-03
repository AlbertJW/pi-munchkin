# Preregistration: Qwen 35B hierarchical planner completion screen v7 (2026-09-03)

## Status and purpose

**PREPARED — NO SESSIONS RUN.** This preregistration supersedes the incomplete
v5/v6 planner mechanism observations as the next execution envelope. It adds
one deliberately completion-shaped comparative fixture so a bounded parent /
child graph has a realistic opportunity to merge both branches, reread their
evidence, and settle the parent. The purpose is still mechanism qualification,
not a quality comparison, adoption gate, or permission to enable planner
defaults.

The earlier v5 screen reached only 3/6 graph starts, 0/6 validated merges, and
0/6 settlements. V6 repaired actionable budget guidance and observed one start
plus nine receipts, but again no merge or settlement. Those observations remain
quarantined and cannot be pooled with this screen.

## Frozen identity

- Subject: `local-llamacpp/qwen36-35b-iq3s`.
- Source surface SHA-256:
  `d1b17fd8dbe1114e5185f68c36809d80ed1d4160c9822c2f1b0faf8ad4db0f18`.
- Loaded mirror surface SHA-256:
  `d83baa71d3eb6d9d79afac7d1adda2b2cf08f96e92c1f7c7785b524bae6fdc09`.
- Candidate configuration `deep-research-planning.json`:
  `0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e`.
- Control configuration `deep-research-planning-control.json`:
  `a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7`.

The source and loaded hashes are unchanged by this fixture and documentation
boundary. The launcher must resolve the loaded hash immediately before every
session. Any source, mirror, model, provider, serving, or configuration drift
voids that session; no rows may pool across the resulting boundary.

## Admitted fixture slate

The slate is immutable for this screen and passed the structural admission
self-test without network, inference, or source fetching. Each manifest carries
its own prompt/source/provenance hashes, evidence-family obligations, negative
control, and bounded local oracle.

| fixture | kind | manifest SHA-256 | admission receipt SHA-256 |
|---|---|---|---|
| `compare-http-api-styles` | comparative | `f4543130e6e2414e1acfdc259f457ffab904135291887b8f0dfff48ff51773ad` | `84d6cd5c82a4fb9c48c13d91bb656cefc62141641aeecf7d0a75e17332972413` |
| `compare-json-yaml-config` | comparative, completion-shaped | `c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646` | `f9e4d42fe2439111babe2513dc0890086de6a9d0458bd398e7969e827e85e65b` |
| `password-expiration-guidance` | contested | `786c66c9e8a7a19c8d85afd36729282be6f3360d74e67de8316d000a3e99ccf3` | `7a2de48a4e7fc0638d4e3e9f420b8280d6a381666dd8c1235ee2d7b4e45e2766` |
| `sqlite-postgres-selection` | multi-part | `9aca1c35b47c6054e6cee938bfb91997f97b37abb7a37cd797980db3c625e975` | `0be1e9162d9d8b1afec9dd6d52ebe0f27274a9f8a9c91c90660035187a242ed4` |

The completion-shaped fixture asks for exactly two bounded evidence branches,
one official read per branch, one cited claim and limitation per branch, and a
conditional synthesis. It is intentionally small enough to fit the shared
three-search/five-read envelope, while its explicit stop condition makes a
successful settlement observable. It does not contain an answer, quote, or
model output.

The four negative controls are the `negative_control` siblings embedded in the
manifests. Each is a straightforward fact lookup with
`expected_plan_start=false`; they must not activate `research_plan_start`.

## No-inference preflight

Run these checks before asking for a human-approved screen:

```sh
python3 optimizer/research-fixtures/admission.py --selftest
python3 optimizer/research-fixtures/preflight.py --selftest
python3 optimizer/research-fixtures/preflight.py --dry \
  --agent-dir /Users/Albert.Wessels/.pi/agent
```

The preflight output must report four fixture IDs, the exact hashes above, both
arm flag maps, `inference_started:false`, and the Qwen subject. These commands
never contact the model server, fetch a source, or launch Pi.

For each session, use the fixture-bound launcher path so the prompt cannot drift
from the admitted manifest. For example, the completion-shaped candidate is
prepared with:

```sh
python3 -m optimizer.v2.planner_smoke --dry \
  --agent-dir /Users/Albert.Wessels/.pi/agent \
  --project-dir /private/research-project \
  --fixture-manifest optimizer/research-fixtures/manifests/compare-json-yaml-config.json \
  --expected-fixture-sha256 c59fd0a480fc370b17e3df7fb8fccbbbf0279b2932ef6049791f7cd03adab646 \
  --expected-surface d83baa71d3eb6d9d79afac7d1adda2b2cf08f96e92c1f7c7785b524bae6fdc09 \
  --model local-llamacpp/qwen36-35b-iq3s --arm candidate
```

Replace only the manifest and its digest for the other three primary fixtures.
For each negative control, add `--negative-control` to the same fixture-bound
arguments; the launcher derives the embedded fact-lookup prompt and labels the
safe result `fixture_role:negative_control`. The `--run` command uses the same
arguments plus private `--output`, `--stderr`, and `--telemetry` paths; it still
requires a separate human approval.

## Arms and bounded run order

Use the hash-verifying `optimizer/v2/planner_smoke.py` launcher with the exact
subject, a 180-second wall, and a 350,000-byte combined stdout/stderr cap. The
candidate arm enables `RESEARCH_LEDGER`, `PLAN_GRAPH`, and
`DEEP_RESEARCH_PLANNING` with the parent-only headless lease. The control arm
keeps the ledger but disables both planner flags and the lease. No other
profile, context, endpoint, semantic-loop, or tool setting may differ.

Run eight candidate sessions, two for each fixture, in a preregistered
randomized order. Then run four negative controls, one for each fixture, in a
separately randomized order. The order is generated with Python's seeded
`random.Random("planner-v7-2026-09-03")` and is fixed here before execution:

```text
candidate: password-expiration-guidance,
           sqlite-postgres-selection,
           compare-http-api-styles,
           compare-json-yaml-config,
           sqlite-postgres-selection,
           compare-http-api-styles,
           compare-json-yaml-config,
           password-expiration-guidance
control:   compare-http-api-styles,
           sqlite-postgres-selection,
           password-expiration-guidance,
           compare-json-yaml-config
```

Use a fresh disposable Pi agent directory and private output paths for every
session. A timeout, output cap, missing report, or interrupted child is an
incomplete lifecycle observation, never a pass or quality score.

## Mechanism acceptance and stop rules

The candidate mechanism screen is provisionally clean only if at least six of
eight candidate sessions contain exactly one `research-start`, at least three
contain a validated `branch-merged`, and at least three contain one terminal
parent `settled` event after parent evidence rereads. No candidate may show a
branch failure, budget inflation, depth above two, duplicate settlement,
missing coverage, raw payload telemetry, or child mutation of the parent
capsule. All four controls must contain zero `research-start`, `branch-merged`,
and `settled` events.

The completion-shaped fixture is not a special pass lane: its two branches
must satisfy the same coverage, parent-reread, and shared-budget rules. A
blocked or deferred node is an explicit outcome and cannot silently complete
the head plan. Any identity drift, malformed telemetry, invalid child report,
or attempted depth-two delegation stops and quarantines the affected session.

Retain only payload-free classifications and bounded counts: graph depth and
node totals, allocation/consumption, branch merges/failures, parent rereads,
delegated leads, evidence gaps, deferrals, child exits, turns, tool calls,
tokens, wall time, and oracle outcomes. Keep prompts, queries, URLs, quotes,
answer text, and raw streams private.

## Interpretation and follow-up

A clean result qualifies only bounded graph operability on this Qwen subject.
It does not establish answer quality, context efficiency, or a reason to change
`PLAN_GRAPH` or `DEEP_RESEARCH_PLANNING`. If the mechanism screen passes, write
a separate powered graph-versus-control preregistration over several complex,
contested, and comparative questions. If it fails, diagnose the lifecycle
boundary rather than treating the result as negative efficacy evidence.

This document authorizes no model execution by itself. A human must review the
preflight output and explicitly approve each launcher invocation. No mirror,
source-tree, default, adoption, or historical-evidence change is permitted.

## Execution status (appended 2026-09-03)

Two candidate invocations were run under this envelope before its hard guard
made further sessions non-informative. The bounded classifications and private
receipt digests are recorded in
`QWEN35B_PLANNER_COMPLETION_V7_AUDIT_2026-09-03.md`. The preregistration is
therefore closed as incomplete; no control sessions were run and no rows may be
pooled with later source boundaries.
