# Preregistration: Jina Reader task quality and cost — 2026-09-24

Status: **PREPARED — NOT EXECUTED.** This is a new task-value study. The
2026-09-10 extraction screen remains an immutable, narrow mechanism receipt;
its source-term and single-observation timing results are not task-quality
evidence. `JINA_READER` remains off unless explicitly enabled for an isolated
approved arm. This preregistration authorizes no inference, mirror, install,
default change, or adoption.

## Question and source identity

Does the opt-in Jina formatting path improve supported research answers or
reduce the total cost of producing them, compared with direct Ketch reading,
on the same frozen public-source tasks?

The task slate is Q2, Q3, Q4, Q6, and Q8 from
`optimizer/docs/archive/RESEARCH_EVAL_QUESTIONS_2026-08.md`. Before execution,
freeze each prompt, evidence-family oracle, source-time cutoff, permitted
source set, and source-content digest in a versioned fixture. Reuse the same
frozen slate in both arms; changed questions or sources require a new
revision. The approval must bind the runtime source commit and surface hash,
manifest, runner/probe/test digests, loaded package hash, served model and
artifact identity, endpoint/serving fingerprint, flags, and the actual arm
exposure. Model and serving identity are deliberately **unassigned** until a
separate execution approval and live preflight.

## Paired design

For each of the five questions, run one fresh control and treatment session in
isolated directories, randomizing arm order within each pair. Use identical
model, prompt, source-time cutoff, research instructions, tool limits, output
cap, and outer deadline. Control uses `JINA_READER=on` capability available
but selects direct `reader="ketch"` for all reads. Treatment differs only by
selecting `reader="jina"` where the preregistered read policy calls for it.
Both arms keep Ketch search, the 3-search/5-distinct-source-read envelope,
source identity checks, and cancellation/deadline behavior. No other candidate
flag may differ.

The independent judge receives randomized, blinded answer pairs without arm,
tool, or model metadata. Score correctness, directness, evidence coverage,
citation support/identity, conflict handling, and uncertainty honesty. The
authoring model cannot judge its own pair. If an independent judge is
unavailable or malformed, synthesis quality is `UNAVAILABLE`; deterministic
receipts remain diagnostic only.

## Measures and decision rules

Record per arm: completion/incomplete status; blinded rubric and pairwise
verdict; supported material claims and citation/source identity failures;
input/output token counts (provider-reported and estimator-reported kept
separate); search/read units; tool calls; wall time; latency; and truncation,
timeouts, aborts, and retries. Durable public receipts contain counts,
digests, identities, and reason classes only—no prompts, model answers, URLs,
quotes, or page bodies.

The screen is **qualified for a scoped adoption proposal** only if all five
pairs have complete integrity-bound receipts, treatment has no citation
identity violation or critical unsupported-claim regression, treatment is
non-inferior on the blinded quality rubric in at least four of five pairs with
no critical correctness loss, and it shows either a higher quality verdict in
at least three non-tied pairs or at least 10% lower median input-token cost.
The treatment must not add an incomplete pair and median end-to-end wall time
must not regress by more than 20%. This small screen is directional evidence,
not a statistical significance claim. Any missing pair, identity drift,
incomplete telemetry, uncapped fetch, or raw-content leakage is `INCOMPLETE`
or `FAIL` and cannot count toward the threshold. Any adoption/default decision
requires a separate human review after the report.

## Approval and evidence

Stages are separate: (1) approve fixture and source/model preflight, (2)
approve the five paired sessions, and (3) review results and decide whether to
prepare a scoped promotion proposal. No stage auto-advances. Store the
sanitized execution receipt and audit under `docs/evidence/` and a human-readable
screen report under `optimizer/docs/screens/`; keep private run artifacts
outside Git with restrictive permissions. Promotion, if later approved, is
limited to `JINA_READER` opt-in and requires a pre-install inventory, exact
selected-file hashes, fresh enabled/disabled smokes, and a verified rollback
copy. No default change is implied.

## Validation status

The previous screen is at
`optimizer/docs/screens/JINA_READER_CURRENT_AUDIT_2026-09-10.md`; the
implementation boundary is `harness/extensions/ketch.ts` plus
`harness/lib/ketch-runtime.ts`. No runner, fixture, or runtime code is changed
by this preregistration. Current source and loaded identities must be freshly
derived at the approved preflight; the 2026-09-10 hashes must not be reused.
