# Research assessment: leaner coordination, stronger evidence

Reviewed 2026-09-08. Recommendations only—not active goals, execution approval,
or a replacement roadmap. The previous goals are retired in
[the goal document](HARNESS_IMPROVEMENT_PLAN_2026-09-06.md).

## Scope and conclusion

This is a source review of Munchkin's current working tree, including existing
uncommitted work, against Lexifina's article and pi-research commit
`ace5519000533c2bff1c11beb010eb3b795f77ca` (package 1.6.15). The external repository
was downloaded and inspected, not installed or executed. Selected upstream tests
were read, not run. No inference, benchmark, runtime modification, mirror, or
adoption was performed. Findings below distinguish observed implementation from
proposed improvements; performance benefits remain hypotheses.

**Borrow small mechanisms, not the framework.** Munchkin already has much of the
hard infrastructure: parent-owned research state, shared discovery budgets,
validated evidence, context accounting, deferred tools, and a separate optimizer.
The promising change is to reduce the context and decision overhead of using
those mechanisms. More planners and more recursive calls are not intrinsically
progress.

## What the sources establish

Lexifina separates execution, refinement, and evaluation; recommends scoped
request identities, stable authorized prefixes, deferred tools, batching, and
avoiding unnecessary final acknowledgement calls. Its numerical examples concern
particular overhead measurements, not Munchkin. The self-improvement illustration
is explicitly a proposed approach rather than measured learning. Treat it as
design guidance, not proof that autonomous recursion improves quality.
[Article](https://lexifina.com/blog/optimising-harness-self-recursion).

pi-research offers a more concrete research design: separate routing and final
synthesis, compact coverage summaries for older reports, partitioned synthesis,
optional cross-run knowledge, and explicit concurrency management. Its source
also exposes tradeoffs that matter on Munchkin's small-context, single-slot
hardware. The useful unit of adoption is an idea with a local test, not the
package as a dependency.
[Architecture at reviewed revision](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/docs/ARCHITECTURE.md).

## Improvements that fit the existing system

### Compact routing, complete evidence, bounded synthesis

pi-research retains full reports for synthesis while showing older reports to
the router through compact coverage digests. Its digest parser preserves report
bodies when metadata is malformed, caps digest size, and distinguishes missing
information from an explicit absence of gaps. This is a useful pattern for
long-running work: keep the library, carry only its index.
[Digest implementation](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/utils/coverage-digest.ts),
[synthesis service](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/orchestration/research-synthesis-service.ts).

In Munchkin, derive that index from existing validated state rather than trusting
a child's claim that a topic is covered. A compact projection could identify
claim IDs, validated evidence IDs, unresolved gaps, conflicts, and remaining
budget. Full reports stay in private artifacts and are retrieved progressively.
Do not create another independent research ledger or plan graph.

The relevant integration points already exist in
[branch-report.ts](../harness/lib/branch-report.ts),
[research-round.ts](../harness/lib/research-round.ts), and
[research-evidence.ts](../harness/lib/research-evidence.ts). The distinction must
remain explicit: a source lead is not fetched evidence, and fetched evidence is
not necessarily support for a claim.

Separate routing and synthesis as responsibilities, not automatically as two
additional model calls. Straightforward work can skip routing. Complex work
should route on compact state and synthesize from the validated evidence needed
for the answer. If synthesis needs partitioning, intermediate summaries must
retain evidence IDs, qualifications, and contradictions.

### Charge the entire workflow, and reserve the answer first

Discovery limits alone do not bound duration. Planning, routing, validation,
repair, synthesis, queueing, and retries also consume time and context. Maintain
one run envelope and charge all roles against it. Reserve enough capacity for
an honest final answer before permitting another research branch. Exhaustion
should produce a bounded partial answer with explicit gaps, not a new allowance.

Use [context-accounting.ts](../harness/lib/context-accounting.ts) for provider
payload accounting and the existing research budget for discovery. Do not add a
second token formula. Model inference should respect the actual single-slot
resource constraint even when independent network retrieval can overlap.
Cancellation must prevent new work and preserve already validated partial work.

This is particularly relevant to the history of long Qwen runs: an investigation
can be within its search allowance while still spending too long coordinating.
That history motivates measurement; it does not establish which role caused
each previous delay.

### Reuse evidence as leads, not inherited truth

pi-research's optional knowledge store deduplicates by content hash and scope,
then offers previous material to later research. The underlying idea is useful;
the full vector/browser stack is not necessary to test it.
[Knowledge writer](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/knowledge/writer-queue.ts).

A small private file or SQLite cache could retain source URL, content digest,
retrieval time, project scope, and provenance. Treat cached summaries as leads;
decide freshness and parent validation for the current task. Never promote an
old answer into present evidence just because retrieval found it. Start with
exact URL/content lookup before embeddings, and keep reuse opt-in until it shows
a net context benefit. This is distinct from automatically injecting working
memory notes into every turn.

### Close the uncertain-operation gap before trusting recursion

The inspected optimizer's
[_operation](../optimizer/v2/engine.py) checks for a completed event, calls the
producer, and only then appends the event. The
[OpenAI-compatible provider](../optimizer/v2/provider.py) sends its operation ID
inside prompt content; it does not persist a pre-request intent or implement
server-side idempotency. A crash after remote execution but before the event
append therefore leaves a possible duplicate-call window on resume.

This is a source-level finding, not a fault-injection reproduction. It does not
mean every evaluator has the same gap: Pi gate attempts have their own recovery
controls and must be assessed separately.

The appropriate contract is durable intent, request identity, outcome, and an
explicit uncertain state. Reconcile when the provider supports it; otherwise
stop for a bounded decision instead of silently repeating ambiguous work.
Exactly-once remote execution cannot be promised by a local journal alone.
Any implementation should first reproduce the crash window in an offline fake
provider test and prove that resume cannot duplicate the session.

### Optimize fixed overhead without weakening boundaries

Munchkin already defers capability families in
[tool-activation.ts](../harness/extensions/tool-activation.ts), supports bounded
retrieval through [ketch.ts](../harness/extensions/ketch.ts), and can return a
validated research final answer directly from
[plan_settle](../harness/extensions/plan-runner.ts). These overlap with the
article's advice; they do not justify a parallel implementation.

Measure whether dynamic briefs unnecessarily change a cacheable prefix, keeping
authorization-sensitive content scoped correctly. Prefer stable static content
and appended task state where the actual provider supports caching. Claim cache
savings only from observed provider telemetry, not repeated text alone.

Prefer bounded existing batch tools over a general code-execution layer. Skip a
final acknowledgement request only after verified terminal success; never skip
required synthesis, a warning, or failure reporting. Provider-specific tail-only
transport is an optional adapter capability, not a portable harness assumption.
Streaming tool dispatch should wait until call validation and dependency checks
are complete; small latency gains are not worth speculative side effects.

## What not to import from pi-research

**It is not a drop-in dependency.** The inspected package requires Pi components
in `>=0.85.0 <1`; Munchkin pins 0.80.6 and declares peer ranges below 0.85.0.
The supported ranges do not intersect. Upstream also documents a 100K+ context
requirement and brings browser, extraction, and optional vector/embedding
infrastructure. No paid search API does not mean zero resource cost.
[Upstream package](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/package.json),
[README](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/README.md),
[Munchkin package](../package.json).

**Its synthesis floor is unsuitable for a strict small-context envelope.**
`planning-service.ts` floors synthesis corpus capacity at 40,000 characters even
when calculated room is smaller. Its comment prefers a possible provider error
to excessive partitioning. Borrow partitioning, not that floor: Munchkin must
honor the served budget and reserves even when this requires less evidence or
an explicit incomplete answer.
[Planning service](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/core/planning-service.ts).

**Its citation trust boundary is weaker than Munchkin's intended one.** The
synthesis service explicitly removed a provenance gate that excluded citations
absent from successful session fetches. Parsed report citations can enter the
set named `trustedUrls`; weak-grounding notes are not equivalent to parent
claim validation. Keep unsuccessful URLs as leads without declaring them
authoritative. Retain Munchkin's parent reread, content binding, and final-citation
checks.
[Citation handling](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/orchestration/research-synthesis-service.ts).

**Read-only does not mean confidential.** The tool factory registers a local
read tool rooted for path resolution at the working directory; upstream's
architecture explicitly says this is not a filesystem jail. A researcher that
reads local files and accesses the web needs a confidentiality boundary, not
merely an absence of edit tools. Restrict any adopted worker to its evidence
workspace and retain public-URL/redirect controls. This is a trust-boundary
concern, not a demonstrated exfiltration exploit.
[Tool factory](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/tools/index.ts),
[Architecture](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/docs/ARCHITECTURE.md).

**Admission errors should not permit unbounded work on this machine.** Upstream
propagates cancellation and real capacity exhaustion, but unexpected semaphore
errors proceed without a slot. That is a deliberate availability tradeoff,
not a suitable default for our resource-limited host. Fail closed on admission
faults; count queueing against the run deadline. Likewise, do not copy
per-researcher gathering allowances or extra steering rounds without charging
them to the shared envelope.
[Admission handling](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/orchestration/research-orchestration-service.ts),
[Limits](https://github.com/Lincoln504/pi-research/blob/ace5519000533c2bff1c11beb010eb3b795f77ca/src/constants.ts).

## How to judge the ideas without another sprawling program

Useful measurements are supported claims per model call, unsupported final
claims, information lost by digesting, prompt size by role, measured cache reuse,
queue and execution time, cancellation latency, and correct partial completion.
An accurate bounded answer with an admitted gap can be better than a longer run
that never concludes. A premature stop that hides missing evidence is not.

Offline fixtures can test digest truncation, missing metadata, stale evidence,
32K/128K synthesis envelopes, duplicate-operation recovery, exhausted budgets,
and cancellation. A future live comparison would need fresh approval and matched
model/surface identities; none is authorized by this assessment.

My recommendation is to simplify the existing research path around compact
validated coverage and a whole-run budget, while treating uncertain-operation
recovery as a prerequisite for dependable optimizer autonomy. Keep execution,
refinement, and evaluation separate. Defer browser/vector infrastructure and
additional autonomous layers unless a measured need emerges.

## Goal reset and unchanged state

The master goal document is now an empty active roadmap. G01–G05 are preserved
in [the retired archive](archive/retired-goals-2026-09-08.md), and the earlier
standalone goal/recommendation documents carry retirement notices. Retirement
does not claim those goals were achieved. Historical evidence and existing
implementation edits remain intact. Live goal ledgers and feature flags were
not changed; this document creates no new goals.
