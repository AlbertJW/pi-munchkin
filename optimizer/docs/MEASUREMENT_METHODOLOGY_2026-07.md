# Measurement methodology: what a 2026-07-27 audit changed

> **ARCHIVE INTERPRETATION:** Recorded `NEUTRAL` labels predating this audit are preserved as
> historical data; their current interpretation is **UNTESTED**, not evidence of no effect.
> Restart (2026-08-15): the admission rule for new calibrations is
> `PREREG_FIXTURE_ADMISSION_2026-08.md`; the charter is `UNMOTHBALL_2026-08.md`. §15–§17 of this
> document (semantic-episode outcome, v3 rows, staged trial) remain current methodology.

This project's optimizer was built to be *trustworthy* — HMAC'd telemetry, surface hashes, serving
fingerprints, fixture admission gates, authority rules. All of that works. An audit of the full
1,466-row catalogue found the rigor was aimed at the wrong risk: it made every number defensible
without ever asking whether the number **could move**.

Seven findings, each reproducible from data already in `optimizer/prompt-lab/results/`.

## 1. The detection floor — most rounds could not have found a win

Smallest pass-rate improvement reaching p<0.05 by Fisher's exact test, at the sample sizes actually
used:

| n per arm | smallest detectable improvement |
|---|---|
| **3** (the 34-candidate sweep) | **none — no effect of any size** |
| **6** (the batch screen) | +83pp |
| 9 (most candidate rounds) | +56pp |
| 18 | +28pp |
| 20 | +25pp |

No harness intervention plausibly delivers +56pp. **A large fraction of the ledger's `NEUTRAL`
verdicts were guaranteed before the round started.** The 34-candidate gemma sweep at n=3 could not
have produced a significant result at any effect size, so every delta it reported — including the
headline ±44pp — sits below its own design's detection floor.

Reproduce: `effort_report.py` docstring, or the Fisher enumeration in `CANDIDATE_PRUNING_2026-07.md`.

## 2. Pass/fail is the wrong outcome variable

Almost every candidate targets **efficiency** — less flailing, fewer wasted turns, fewer bad edits.
The gate measures **capability** — can the model solve this task at all. Those come apart
completely.

c21-micro-gate stated its own signature in its config, before any of this:

> *"Expect pass-rate neutral-to-up with LOWER tokens… micro-gate.fired counts the mechanism."*

It delivered exactly that, and the screening rule filed it `PARK_EXPOSED_NO_SIGNAL` because it read
only the gate bit. At n=20/arm the same candidate shows −26% turns, −64% tool errors, −75% repeat
calls, five metrics at p<0.05. **One bit per session cannot see that.**

That the effect then failed to replicate on a second task (§7) does not weaken the point — the gate
bit was blind to a large, real, mechanism-confirmed change either way. Scoring effort is what made
both the apparent win *and* its non-replication visible at all.

Every session already records `trajectory.{turns,tool_calls,tool_errors,repeat_calls,
tool_result_chars}` and `usage.{input,output}_tokens`. Score them: `effort_report.py <gen>`.

## 3. Variance is the binding constraint, not sample size

Effort metrics have far more power than a binary, but session-to-session variance on a small model
is enormous — c21/parens base turns were `4, 25, 35, 56, 56, 119`, a 30× spread. Bootstrapped power
for the **largest effect in the entire dataset**:

| n/arm | power |
|---|---|
| 6 | **22%** |
| 20 | 58% |
| 40 | 84% |

A real 4× efficiency win is missed ~78% of the time at n=6. Budget for variance, not for optics.

## 4. You must be able to prove the mechanism fired

Before this audit, **40 of 45 candidates declared no `exposure` spec**, so `NEUTRAL` was
indistinguishable from *"the mechanism never engaged."* This is not hypothetical: in the batch
screen, `c24/parens` and `c7/parens` both scored a superficially encouraging **+1/6 while firing
zero events**. Without exposure counts, two non-measurements would have entered the ledger as mild
positives.

Related, and worse: across 1,465 sessions, **53 of 68 mechanism counters are identically zero** —
including all 21 counters of the c40–c45 planner family, and `plan_runner_delegation.{blocked,
delegated}` for the entire delegation cluster.

## 5. Exposure has three modes, and two of them are not "did it fire"

| mode | meaning | `targeted` means |
|---|---|---|
| `telemetry` | a declared event firing proves the mechanism acted | mechanism fired |
| `suppression` | candidate turns a mechanism **off**; sense of `target` is **inverted** | target event went to **zero** |
| `configuration` | the treatment *is* the config (prompt/wording); no firing exists | **config applied — NOT "fired"** |

`configuration` mode is vacuously `targeted` by construction. Reading it as engagement is the
single easiest way to fool yourself with this system.

Suppression rows are also **not self-interpreting**: zero firings in cand proves nothing if base was
zero too. Use `exposure.suppression_confirmed(base_total, cand_total)` for the paired verdict, which
distinguishes *confirmed* from *unexercised*.

## What follows from this

- **Score effort by default**, pass rate as a do-no-harm guard. `effort_report.py`.
- **Declare exposure on every candidate.** A candidate that cannot prove it fired cannot be
  retired for failing to help.
- **Adoption needs power; retirement usually doesn't.** A mechanism that never fires on a fixture
  built to trigger it is retireable on six sessions with no statistics. This asymmetry is what
  makes a full roster verdict affordable — see `ADOPT_OR_RETIRE_PROTOCOL_2026-07.md`.
- **Pre-register decision rules.** A 650-comparison re-score (`effort_report.py --sweep`) is a
  shortlist generator; anything chosen after seeing results is hypothesis, not finding.
- **Check the fixture can express the effect.** A null on a fixture that floors or ceilings was
  never capable of being anything else. **Both examples this section used to name are now void,
  for different reasons — see §9 and §14, and do not re-cite either number:**
  `hygiene-shared-config-reread` (0/6) is a *harness artifact*, not a floor — the gate never
  copied `config/`, so its hidden grader died on `readFileSync("config/schema.json")` regardless
  of model; §9 forbids carrying that pass rate forward. `sv-ambiguous-spec` (1/6) was measured on
  a fixture that no longer exists (v3 removed the pre-implemented `src/refund.js`, `f6318c4`).

## The reframing

"0 of 44 candidates adopted" was read for weeks as evidence the candidates don't work. It is
better explained as the expected output of a design that could not see its own results. The roster
is a backlog of **untested** ideas, not rejected ones — which is why the first properly powered
round produced a candidate with 7/7 metrics moving the right way. That candidate then failed on a
second task (§7), so the corrected reading is narrower and more useful: the roster is untested, and
testing it properly mostly produces rejections — but *earned* ones.

Defensibility and informativeness are different properties. This project had the first and,
for a long time, not the second.

## 6. The real binding constraint is repeat spirals, not context (2026-07-27)

Re-derived from 1,505 sessions when the goal was restated as *"small models effective over long
multi-turn tasks, minimal context"*:

| | median | p90 | p99 | max |
|---|---|---|---|---|
| turns | 11 | 33 | 89 | **203** |
| tool errors | 3 | 12 | 34 | **150** |
| context tokens | 4,908 | 19,425 | 43,779 | 47,832 |

**Context is not the constraint.** The median session uses 4,908 tokens; the governor is 6.9% of
that. Minimal-context work on prompts optimises a rounding error.

**Repeat spirals are.** Errors in the longest decile: median 14; in the shortest half: 1. Repeat
calls track errors ~1:1 in the tail (150 errors / 164 repeats; 76/68; 62/49). The top 10% of
sessions carry **43% of all 7,673 wasted tool calls**.

And the cause was a live defect, not a missing feature: `loop-breaker` reset its episode on *any*
progress — including a turn with no tool calls — so `fail, fail, fail, one edit, repeat` never
tripped a tier. **8 of the 24 worst sessions passed.** They were not stuck, they were grinding.
Fixed in `64103be` with a session-cumulative counter.

**Consequence for candidate design:** an intervention that adds turns or context to a model failing
from too many turns and too much context is wrong by construction, regardless of how it measures.
That reasoning retired ~20 planning/delegation candidates and deleted the v4 family outright —
cheaper and more reliable than 13 h of probing would have been.

## 7. Pre-registration earned its keep immediately

c21-micro-gate was the single most promising candidate in the catalogue — ranked #1 **and** #2 by
the effort sweep, 7/7 metrics better at n=20 on `parens`. On its second task it managed 4/7 with
input tokens significantly *worse*, and pass rate down on both. It stays dark.

The rule was written a day before those numbers existed. Written afterwards, 4/7-with-a-regression
is exactly the shape that becomes "directionally positive, adopt with monitoring".

## 8. A comparability boundary in `tool_errors` (2026-07-30)

`ab-machinery/metrics.py` derives `tool_errors` from `isError` on each toolResult message.
Until 2026-07-30, `plan_write` and `plan_go` signalled their semantic rejections by *returning*
`{isError: true}` — and pi only sets that flag when `execute()` **throws** ("returning a value
never sets the error flag regardless of what properties you include", extensions.md:1959). So
every plan-tool rejection was recorded as a *successful* tool call.

**Consequence, stated precisely**: pre-2026-07-30 rows **under-count** `tool_errors`, and they
do so *asymmetrically* — only in arms where plan tools actually run and get rejected, i.e. the
plan-heavy candidate arms (`FORCE_PLAN_WRITE`, the c25/c31/c37/c38/c39 family and their
combos). Baseline arms, which rarely call `plan_write` at all, are essentially unaffected. A
cross-boundary comparison of `tool_errors` between a pre-fix candidate arm and a post-fix one
would therefore show an increase that is pure instrumentation, not behaviour.

**Rule**: rows remain valid *within* their own round — both arms of any single round were
measured on one surface, so every published verdict stands. Do not make `tool_errors` claims
that span the boundary. The boundary is machine-checkable: rows carry
`harness.surface_sha256`, and the post-fix surface is `642902d5503d…`.

Partial rows from the rounds interrupted by this work (`c48-view-35b`, 36 rows;
`c50-trap-4b`, 15 rows) were **discarded** rather than kept, because they straddle the change
— the same never-mix-surfaces rule that voided the partial `c26-4b` round. Both rounds re-run
from zero on the post-fix surface; their pre-registrations are unchanged and still valid.

## §9 — INVALIDITY BOUNDARY: fixtures whose reference docs were never materialized (2026-07-30)

**84 rows across 10 rounds are invalid, not neutral.** The gate never copied the reference
material those tasks were built around, so the model was asked to conform to a specification
that did not exist in its working directory.

### The defect

`real_gate.sh:437-439` materializes a fixture with an **allowlist**:

```
cp -R "$fix/src" "$fix/test" "$fix/package.json" "$wd/"
[[ -d "$fix/data" ]] && cp -R "$fix/data" "$wd/"
[[ -d "$fix/scripts" ]] && cp -R "$fix/scripts" "$wd/"
```

`docs/` and `config/` are not on it. `fixture_admission.py:141-147` materializes the **whole
tree** via `shutil.copytree`. So every fixture is admitted against one filesystem and measured
against a different, smaller one. Admission structurally cannot catch this class: it validates
a world the model never sees.

### Affected fixtures and rows

| fixture | dropped | rows | rounds |
|---|---|---:|---|
| `retry-trap` | `docs/naming.md` | 42 | c48-trap-4b, c48-view-35b, c50-trap-4b |
| `hygiene-shared-config-reread` | `config/` | 24 | c26-hygiene, c27-hygiene, c30-hygiene, legacy-signal-cal |
| `access-log-triage` | `docs/fields.md` | 18 | alt-4b-c26, alt-4b-c27, alt-4b-c29 |
| `audit-sweep` | `docs/audit-notes.md` | 0 | never run — would have been invalid identically |

### Why these rows cannot be reinterpreted

`retry-trap` is the clearest case and it is not merely "harder without the doc". The gold patch
touches only `data/charmap.json`, and the required mappings live **exclusively** in
`docs/naming.md` — which deliberately specifies `ä å → a` and `ö ø → o`, *contradicting* the
usual German `ae`/`oe` convention. The fixture's whole design is that convention-guessing must
fail and only reading the spec can succeed. Removing the spec makes it unpassable by anything
but luck. `c50-trap-4b` scoring **0/9 in both arms** is exactly what that predicts.

### The claim this retracts

c50 (`spec-adherence`) was motivated by an observation recorded as *"12/12 sessions on the 4B
edited the right file with invented mappings while `docs/naming.md` sat unread."* **That
observation was an artifact.** The models did not ignore an available spec; the harness never
gave them one. The candidate's entire premise is withdrawn pending a valid measurement, and its
`unexposed` result is correctly read as "the mechanism could not arm because the file it looks
for was absent", not as evidence about the mechanism.

### Observed pass rates — the severity is NOT uniform

Checked rather than assumed, because the theory ("no spec → unpassable") predicts a floor and
one fixture does not show one:

| fixture | observed | reading |
|---|---|---|
| `retry-trap` | **1/42** | floored. Matches "unguessable by design" exactly. Verdicts unusable. |
| `hygiene-shared-config-reread` | **3/24** | floored. Verdicts unusable. |
| `access-log-triage` | **12/18 (67%)** | **not floored** — `docs/fields.md` was not required to pass. |

So `access-log-triage` rows are **confounded, not invalid**: the prompt named a file that did
not exist, which can waste turns and distort trajectory metrics, but it did not prevent the
task from being solved and its pass rates are not obviously meaningless. Treat its deltas with
suspicion; do not throw them out.

`retry-trap` and `hygiene-shared-config-reread` are the invalid ones. Their pass-rate verdicts
must be discarded and the rounds re-run after the fix. This distinction matters: claiming all
84 rows were invalid would have been the same overreach in the other direction, and the data
does not support it.

### Status of rows

Rows stay on disk and remain valid **within their own round** for metrics that do not depend on
the missing material (token counts, trajectory shape, tool-error rates). No pass-rate claim on
`retry-trap` or `hygiene-shared-config-reread` may be made or carried forward across this
boundary.

### Fix

Make the gate materialize what admission materializes — copy the fixture tree and exclude
`node_modules`/`.git` — rather than extending the allowlist one directory at a time, which
would only defer the next instance. Gold patches, hidden tests and review packets live outside
the fixture directory (`patches/`, `hidden/`, `review-packets/`), so copying the tree leaks
nothing. Deferred while `c49-nat-35b` is mid-round: editing a running bash script is unsafe,
and `real_gate.sh` must never change mid-round regardless.

## §10 — c49-nat-35b: an INERT candidate measured −4%. That is the noise floor.

`c49-nat-35b` (tool-call-rescue, qwen36-35b-iq3s, parens/equil/bigdata, N=9/arm) reported
base **100% (27/27)**, candidate **96%**, Δ **−4%**, verdict NEUTRAL.

**The candidate did nothing at all.** All 27 candidate rows are `status: "unexposed"` with
`tool-call-rescue/detected = 0` and `tool-call-rescue/steered = 0`. The extension never fired
once: the 35B does not emit pseudo-tool-calls on these tasks, which is the failure mode the
candidate exists to catch. So the two arms were, mechanically, the same harness.

This makes the round unusually valuable as a **calibration**, and it should be used that way
rather than filed as another neutral:

1. **Empirical noise floor.** A provably inert change produced a 4-point pass-rate swing (1
   failure in 27) and moved task-stratified all-pass from 3/3 to 2/3. Any future single-round
   delta of this size on a saturated fixture set is indistinguishable from nothing. The
   all-pass metric is the more alarming one — it swung 33 points on one flipped session, so on
   k=9 with 3 task groups it is far noisier than its precision suggests.
2. **Saturation confirmed at the top.** Base 27/27 means parens/equil/bigdata cannot show
   improvement on the 35B at all — only regression. Running a *helper* candidate against a
   100% baseline can produce no positive result by construction. This is the retrospective's
   central point, now with a clean number attached.
3. **The verdict text is misleading here and should not be followed literally.** It advises
   "raise n (deep run) or try a bigger change". Both are wrong for this round: with zero
   mechanism events, more n measures the noise floor more precisely and a bigger change still
   has nothing to act on. The correct response is a fixture where the targeted failure mode
   actually occurs, or a model that exhibits it.

**Disposition.** c49 `tool-call-rescue` is **not refuted** — it is untested on this fleet, for
the specific and checkable reason that the behaviour it targets did not occur. Its real test
needs a model that produces pseudo-tool-calls (the measured artifact came from smaller qwen
variants, not the 35B). Do not carry the −4% forward as evidence against it.

**Standing rule this supports.** Read `exposure.status` BEFORE reading any delta. Two of the
three rounds run on 2026-07-30 (c49, c50) came back `unexposed`, and in both cases the pass-rate
delta was pure noise around an inert arm. Without the exposure counter both would have entered
the ledger as ordinary neutrals and been read as evidence about mechanisms that never ran.

## §11 — The three 2026-07-30 rounds produced ZERO information. Why, precisely.

All three completed, all three reported NEUTRAL, and none of them tested anything. The reasons
differ, and the differences are the useful part.

| round | candidate | exposure | fixtures | why it is uninformative |
|---|---|---|---|---|
| `c48-view-35b` | state lens | **targeted** (148 `view-injected`) | parens, equil, retry-trap | mechanism fired, but **saturated where valid** and **invalid where it moved** |
| `c49-nat-35b` | tool-call-rescue | **unexposed** (0 detected) | parens, equil, bigdata | targeted failure mode never occurred; base 27/27 |
| `c50-trap-4b` | spec-adherence | **unexposed** (0 armed) | retry-trap | spec withheld by the gate; and the mechanism was dead code anyway |

**c48 deserves the closest reading, because it is the one that looks like a result.** Headline:
67% → 72%, **+6%**. Split by fixture:

```
equil        base 6/6   cand 6/6
parens       base 6/6   cand 6/6
retry-trap   base 0/6   cand 1/6   <-- INVALID: docs/naming.md was never materialized
```

The two valid fixtures are **perfectly saturated in both arms** — 24 sessions carrying exactly
zero information. The entire +6% is **one lucky session on a task that could not be passed**,
because the spec it requires was absent from the workdir. A candidate whose mechanism
demonstrably fired 148 times still produced a number built entirely from a broken fixture.

This is the retrospective's thesis with all three failure modes in one day, and worth naming
separately because they need different fixes:
1. **Saturation** — the fixture cannot express improvement (c48 on parens/equil, c49 throughout).
2. **Non-occurrence** — the mechanism is fine but its trigger never happens (c49).
3. **Invalidity** — the task was impossible (c48's retry-trap rows, c50 entirely).

Only (1) is fixed by harder fixtures. (2) needs a fixture or model that exhibits the behaviour.
(3) needed the materialization bug fixed, which it now is.

**Standing rule.** A fleet-level pass rate that mixes saturated and unsaturated fixtures hides
which fixture moved. Before reading any headline delta, **split by fixture** — the one-liner is
in this file's git history at §11. If every valid fixture is at 100% or 0% in both arms, the
round produced no information regardless of what the aggregate says.

**Dispositions.** c48 state-lens: untested (saturated + invalid), re-run needed on unsaturated
valid fixtures. c49 tool-call-rescue: untested, needs a model that emits pseudo-tool-calls.
c50 spec-adherence: untested, needs the mirrored `args` fix plus the materialization fix — both
of which have now landed.

## §12 — The graded instrument: why a binary gate could never have shown a win

Built 2026-07-31 (`31611d1`, `a37494a`). This section states the problem it solves, because the
problem is the reason ~50 candidates produced one adoption.

### The gate is a one-sided regression detector

Fisher exact, one-sided, recomputed directly:

| design | best case | p |
|---|---|---|
| n=9/arm, base **5/9** (the best in-band fixture that exists) | cand 9/9 | **0.041** (two-sided 0.082 — nothing) |
| n=9/arm, base 5/9 | cand 8/9 | 0.147 |
| n=9/arm, base **9/9** (most of the corpus) | cand 5/9 | **0.041 — a REGRESSION is detectable** |
| n=20/arm, base 15/20 | cand 19/20 | 0.091 |

From a ceiling only harm is visible; from the one in-band fixture only perfection is. **Every
round could return NEUTRAL or HARMFUL and nothing else.** That explains "8 decisively tested, 1
adopted" without any theory about candidate quality — and it predicts the observation that the
only statistically significant candidate result in the whole ledger is a harm (c38 −56pp,
p=0.029). See `CANDIDATE_STRATEGY_2026-07-31.md` §1.

### What partial credit changes

A fixture's hidden grader may emit `.<name>-grade.json` = `{fixed, total, defects}`.
`real_gate.sh` reads it into an **optional** `subscores` row block; `score` remains the strict
binary gate bit, so every historical row stays valid and no cross-round pass-rate claim moves.

Demonstrated on `audit-sweep`'s real grader across its three admission states:

| state | binary `score` | graded |
|---|---|---|
| pristine | 0 (fail) | **0/8 = 0.000** |
| shortcut mutant | 0 (fail) | **2/8 = 0.250** |
| gold | 1 (pass) | 8/8 = 1.000 |

**The binary bit scores pristine and shortcut identically.** Graded separates them. That is the
entire point: a candidate taking a floored fixture from 1/8 defects to 6/8 currently reads as
NEUTRAL, and would read as a large, significant improvement under `--graded` (verified on a
synthetic round where both arms score 0/9 and the graded view separates at p<0.001).

### Rules for using it

- **`graded_rate` (fixed/total) is the primary outcome where it exists; it is the only
  HIGHER-is-better metric** in `effort_report.py`. Every effort metric is lower-is-better, and
  mixing the two silently inverts a verdict.
- **Coverage is reported, never assumed.** An ungraded round says so and still prints effort
  metrics. A *partially* graded round warns that the graded rows are a subset which may not be
  comparable to the full arm — find out why the rest are missing before using it.
- `score` is unchanged. Do not restate a graded result as a pass rate, and do not compare a
  graded round's `graded_rate` against another fixture's — `total` differs per fixture.
- A graded round whose sessions all fail yields **zero rows under `--only-passing`**. Use
  `--graded` without it, or the graded signal disappears exactly where it is most needed.

### What this does NOT fix

Graded scoring raises the ceiling on what a round can detect; it does not create a fixture that
can express the effect. **The binding blocker is still that no fixture sits in a 30–70% band for
the two models that matter, locally**: `path-near-miss` (50%) and `sv-commit-sha-guard` (33%) are
remote (non-authoritative); `sv-convention-provenance` (50%) is local at n=6. `audit-sweep` is
graded and has **never been run** — its band is unknown, and finding out is the cheapest next
measurement available.

---

## §13 — `prefix_stable` cannot see a context-injecting candidate. It reads 1.0 anyway.

A deep-QA lens claimed `STATE_LENS=view` drives `prefix_stable_rate` to zero, making a required
row metric a harness artifact. **Measured, and refuted** — but the truth is worse than the claim.

| round | arm | lens injections | `prefix_stable_rate` | `appended_only_rate` |
|---|---|---|---|---|
| `c48-view-35b` | base (n=18) | 0 | 1.0 | 1.0 |
| `c48-view-35b` | cand (n=18) | **148** | **1.0** | **1.0** |
| `c48-trap-4b` | base (n=6) | 0 | 1.0 | 1.0 |
| `c48-trap-4b` | cand (n=6) | **117** | **1.0** | **1.0** |

The receipt is computed *before* the lens exists. The gate loads extensions by `readdir` from
`~/.pi/agent/extensions`, where `context-surface.ts` is index 6 and `session-blackboard.ts` is
index 19, so `context-surface` hashes the message array on its way past and the lens is appended
afterwards. (`package.json`'s declared order is irrelevant — it is not the live venue.)

**So the 1.0 is false reassurance, not a pass.** `session-blackboard.ts:164-172` states plainly
that the lens *does* break the serving-side prefix on every call: the view is per-call, so on call
N+1 the message that was last on call N has lost its lens tail and llama.cpp re-prefills from that
position. The cost is real, accepted, and **structurally invisible to the metric named after it**.

Consequences, in order of how much they can hurt:

1. `c26` and `c30` both pre-register "`prefix_stable` must NOT regress" as their non-regression
   guardrail (`configs/static/c26-read-dedup.json:3`, `c30-context-brief.json:3`). That guardrail
   is blind to the one candidate *known* to violate it. Combining c48 with either is currently
   unfalsifiable on the axis both preregs chose.
2. Any c48 token or latency number carries an unmeasured re-prefill cost. Do not read c48's
   `in_tok` as if the prefix were reused.

**No reorder.** Moving `session-blackboard` after `context-surface` would change what the receipt
measures without changing what the server does, trading an invisible cost for a visible number
that is equally wrong. What is required is a **lens-aware prefix metric** — one computed on the
messages actually sent to the endpoint, after every `context` handler has run — before
`prefix_stable` may serve as a guardrail for any context-injecting candidate. Until that exists,
treat `prefix_stable_rate = 1.0` on a c48/c26/c30 arm as *unmeasured*, not as *stable*.

---

## §14 — Neither "floor" was a floor. Both readings are void.

For weeks two fixtures were cited as proof that the local 4B floors, and used to excuse nulls:
`hygiene-shared-config-reread` (0/6) and `sv-ambiguous-spec` (1/6). §2 of this document listed
them under "check the fixture can express the effect". **Both numbers are void, for different
reasons, and neither fixture has been calibrated in its working form.**

### `hygiene-shared-config-reread` 0/6 — a harness artifact, not a model result

The 0/6 came from `legacy-signal-cal`, one of the rounds §9 invalidates: the gate materialized
fixtures through an allowlist (`src`, `test`, `package.json`, `data`, `scripts`) and **never
copied `config/`**. The hidden grader opens `config/schema.json` on its first line. Replaying the
old allowlist reproduces it exactly:

```
Error: ENOENT: no such file or directory, open 'config/schema.json'
```

That is a failure **no model could avoid** — the file was not on disk. §9 already forbids
carrying this fixture's pass rate across the boundary; §2 was citing the number anyway, 140 lines
earlier in the same file. The gate now copies the whole tree (`real_gate.sh`, `tar -C "$fix"`), so
the fixture works — and has **never been run since**.

### `sv-ambiguous-spec` 1/6 — measured on a fixture that no longer exists

`f6318c4` (2026-07-31) rebuilt it to v3, removing the pre-implemented `src/refund.js` and
`refundBatch.js` that let a session pass without doing the work. The 1/6 describes v2. Comparing
a v3 round against it is comparing two different tasks.

### The consequence

The project's stated reason for having no in-band local venue was "the 4B floors on the only
hard fixtures". **That reason does not survive.** Both may sit in the 30–70% band; nobody has
looked. Re-calibrating `hygiene-shared-config-reread` is now the cheapest route to the in-band
fixture the programme spent months believing it lacked — see `MOTHBALLED_2026-08-03.md`.

**Rule.** A pass rate is a property of *(fixture version, harness surface, model)*. Before citing
one as a floor or a ceiling, confirm all three still hold. Both failures here were the same
mistake: quoting a number long after the thing it measured had changed.

---

## §15 — Semantic overrun has a fixed window and a correlated diagnostic

The preregistered primary trajectory outcome remains `semantic_failure_overrun`. It increments
once for every tool call that **starts while any semantic failure episode has already recorded at
least two failures**. It is a session-window metric: unrelated recovery work counts, multiple
simultaneously exposed episodes still count one call globally, and the eventual successful
recovery call counts because its outcome is not known when it starts. The window closes only when
the episode's defined recovery is observed, on settlement, reset, or manual `/loop-resume`.

`correlated_failure_overrun` is a narrower diagnostic, not a replacement outcome. For each call in
the same exposed window, it increments once when the call's pre-result **tool family + target hash
+ active-plan-item hash** matches at least one exposed episode. Failure class is intentionally
absent: assigning it before the result would leak future information into the metric. Each matching
episode also records `correlatedCallsAfterSecond`; a single global call is never multiplied merely
because multiple episodes coexist.

Both counters use tool-call start state and persist only hashes and counts. Calls made with no
exposed episode return before argument bounding, hashing, or episode-array allocation. These are
observational changes only: the 2/4/6 semantic tiers, exact-call walls, 7/11/28 cumulative tiers,
and highest-tier collision rule are unchanged. Do not pool either metric across harness surface
hashes, and do not reinterpret the correlated diagnostic as the preregistered primary outcome.

The ephemeral failure snapshot is v4. Its call-variant hashes record only changed bounded tool
arguments; they do not establish that the model changed its reasoning strategy.
Verification/compiler recovery is scoped explicitly. When
an exact project gate is known (or gate discovery is unavailable), only verified exact-gate
evidence after the latest mutation closes the episode. When discovery positively reports that no
project gate exists, only the same normalized verifier may close it. Non-Bash assertion episodes,
including `research_note`, retain same-target recovery. This prevents a convenient generic suite
from shortening an exact-gate failure window. Session settlement, compaction reset, tracker reset,
and `/loop-resume` close the exposed window without pretending that verification recovered.

---

## §16 — Verification frontier is diagnostic, never verification authority

`pi.context-telemetry/v4` adds one authenticated `verification_frontier` settlement summary.
The reducer consumes only internally consistent Node TAP terminal summaries produced by the
normalized exact detected project gate after the latest mutation boundary. Generic suites,
malformed or partial TAP, missing execution events, overlapping mutations, and plan-gate
receipts without result counts contribute no frontier observation.

The frontier advances when the recognized passed count rises, or—at the same passed count—the
failed count falls. The first recognized summary establishes the baseline. An unchanged failed
frontier increments `plateau_streak`; exact green clears the streak. This remains observational:
exit status and verification ordering still own the gate verdict, and frontier counts can never
verify a run or close a semantic episode.

`verification_plateau_overrun` counts tool calls starting after the third consecutive unchanged
failed frontier until an advance or exact green clears the plateau. It is a diagnostic alongside,
not a replacement for, the preregistered `semantic_failure_overrun`. V3 and v4 rows remain
separate canonical generations and must never be pooled.

---

## §17 — Powered episode studies require authenticated rows

`pi.eval-row/v3` is the first row generation that carries the semantic-episode outcome through
the gate's parent-owned HMAC reducer. Its `pi.context-telemetry/v3` payload contains count-only
episode settlement, recovery, tier, intervention, and provider-timing aggregates. It contains no
commands, arguments, output, errors, URLs, paths, endpoints, hostnames, or credentials.
`pi.eval-row/v4` is the current writer generation and additionally requires exactly one complete
authenticated verification-frontier settlement. V3 and v4 are separate populations.

A powered episode row is complete only when the authenticated stream contains exactly one valid
`failure-episode/settled` summary. Missing or duplicate summaries make the row incomplete for the
primary outcome; missing provider timing makes latency unavailable but does not invalidate the
episode or correctness outcomes. The gate writes incomplete rows for auditability instead of
silently dropping them.

V2 remains readable as historical evidence but is ineligible for semantic-enforcement trials.
V2, v3, v4, and schema-less historical rows are distinct analysis populations and must never be mixed.
Raw gate JSONL is not authenticated after its ephemeral HMAC key is gone; only the reduced row
written while the parent still owns that key carries authenticated episode evidence.

---

## §18 — Ling Tiny study stages and serving strata

The semantic-enforcement study uses `failure_episode_trial.py`, not an ad hoc shell loop. Its
stages are `preflight → calibrate → power → primary → primary-report → replication → final-report`,
and each stage is a separate operator action. Only calibration, primary, and replication accept
`--execute`; none automatically starts a later stage. State and result rows are private artifacts,
and completed `(stage, fixture, arm, repetition)` cells are skipped on resume.

Calibration is exactly six shadow sessions per fixture. Admission remains fixed at 2–4 correct
sessions and semantic-episode exposure in at least two sessions, with complete authenticated v4
settlement and exact token usage throughout. At least two fixtures must qualify. Power uses the
zero-inclusive calibration distribution, a 30% binomial-thinning alternative, 500 simulated
trials with 1,000 bootstrap resamples each, candidate sizes 40/48/56/64/72/80 per arm, and selects
the first size reaching 80% estimated bootstrap power. Failure at
80 stops the study rather than weakening admission.

Every row binds the study-manifest, surface, model-registry, fixture, config, rendered-governor,
prompt, and serving identities. `pi.serving-fingerprint/v2` provides semantic, performance, and
full hashes. Pre/post hashes must match within every session and all rows in a stage must share
one serving contract. A Mac replication is therefore a separate stratum even if it uses the same
model bytes; results may be compared but are never pooled with the network box.

The primary outcome and adoption threshold remain those in §15: at least 20% reduction in mean
all-session semantic overrun with the 95% bootstrap interval for candidate minus control below
zero. Correctness may fall by at most five percentage points, intervention exposure must reach
20%, and token usage must show no statistically significant regression. The second eligible
fixture must agree in direction without violating the correctness or token guards. Reports never
turn those rules into an automatic default flip.

---

## §19 — Structured working memory is an untrusted, separately measured candidate

`WORKING_MEMORY=on` exposes an explicit, bounded per-run notebook. Its contents are model-authored
hypotheses, not reasoning traces, evidence, plans, verification, or trusted instructions. The
default `off` state registers no tool, command, handler, schema, or prompt text. V1 performs no
automatic context injection.

The mechanism screen requires at least one write in 20% of six candidate-only sessions and a
later list, resolution, or supersession in at least half of writing sessions. Authenticated study
rows may retain only write/list/resolution/supersession counts, stale-active counts, and byte
totals; note text and artifact locations are forbidden. A preregistered trial manifest must name
the working-memory telemetry events in v4's authenticated exposure map; the row does not acquire
note text or trust the notebook. Working memory and plateau enforcement are first tested separately.

---

## §20 — Strict verification plateaus pair mutation with exact-gate evidence

`VERIFICATION_PLATEAU=shadow` is the default observational mode. A strict plateau epoch requires
one successful source mutation, followed by one ordered, recognized Node TAP failure from the
exact project gate, under the same hashed active plan item and gate identity, with no frontier
advance. One gate consumes at most one mutation. Unknown TAP, overlapping mutations, missing
events, changed plan items, and unpaired repeat gates cannot manufacture epochs. Exact green or a
frontier advance clears the streak; an advance does not close a semantic failure episode.

At three unchanged epochs, shadow mode records `verification-plateau/observed` and changes no
model input. Dark `enforce` proposes one bounded correction through the existing control arbiter;
at five epochs it emits only an additive recovery capability request if `subagent` exists. It
never names an inactive tool and never aborts solely for a plateau. Exact-call, repeated-outcome,
semantic, and session-tail policies remain independent.

The mechanism screen declares `verification-plateau/observed` in the authenticated v4 exposure
map and also requires a complete authenticated frontier settlement. Exposure must reach 20% of
six candidate-only sessions, and at least one non-plateau session must demonstrate a real frontier
advance. The strict event count is not interchangeable with the broader
`verification_plateau_overrun` window introduced in §16.
