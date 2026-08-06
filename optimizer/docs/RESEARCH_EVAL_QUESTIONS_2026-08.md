# Deep-research evaluation — procedure and question set (prepared, not executed)

**Status: PROCEDURE ONLY.** This is how to measure the verified-research pipeline
(`RESEARCH_LEDGER=on`, `feat/research-ledger`) against the prior skill. It is not a gate round —
web tools are excluded from `real_gate.sh` (`GATE_BASE_TOOLS` has no web tool; `GATE_NETWORK=endpoint`
blocks egress), so this cannot be authoritative in the gate sense. Executing it is a separate,
human-approved step on a live interactive agent.

## Why this shape

The pipeline has two separable quality claims, measured differently:

1. **Citation fidelity — deterministic, no judge needed.** The `research/note` telemetry already
   records `ok` / `reason_class` per note. A run's verified-vs-refused ratio, and the presence of
   a `.pi/research/<stamp>.md` ledger whose every quote is verbatim-checked, IS the fidelity
   measurement. The old skill produces no ledger and no such ratio — a claimed citation there is
   unverifiable by construction. So on fidelity the comparison is not close and needs no model.

2. **Synthesis quality — soft, pairwise judge.** Whether the *answer* is better (complete,
   well-attributed, honest about conflict) is a soft surface. Use `optimizer/prompt-lab/judge.py`
   (frontier pairwise, randomized A/B order to cancel position bias, malformed→tie). Add a
   citation-fidelity dimension to its rubric for this run:
   `RUBRIC="correctness, clarity, concision, and CITATION FIDELITY (every material claim traceable
   to a quoted source; penalize uncited or unsupported claims) — penalize padding and hedging"`.

## Procedure

For each question below, on the same live model (record the serving fingerprint and
`HARNESS_SURFACE_SHA256` first — the pipeline is a model-visible surface, so old rows do not
transfer):

1. Run arm **A** = prior skill (checkout before `feat/research-ledger`, `RESEARCH_LEDGER` unset).
2. Run arm **B** = new pipeline (`RESEARCH_LEDGER=on`, skill v2).
3. Capture each answer plus, for B, the ledger file and the `research/run-summary` row.
4. Deterministic: report B's verified/refused note counts and ledger completeness. A has none.
5. Soft: `judge.py` A-vs-B on the answer text with the rubric above; randomized order per the
   tool's protocol.

One question/model/session at a time; one serving box at a time (standing rule). This is
interactive, not a gate round — no `real_gate.sh`, no box queue.

## Question set (10 — spread across the modes the skill distinguishes)

Current-fact (quick-mode territory):
1. What is the current stable version of Node.js, and what was the immediately previous LTS line?
2. What license does the `ketch` CLI (github.com/1broseidon/ketch) ship under?

Contested / needs triangulation (broad-mode territory):
3. Do current small (~30B) local models benefit more from longer context or from tighter tool
   scaffolding? Summarize the disagreement, not a single view.
4. Is retrieval-augmented generation still considered necessary for factual grounding in 2026, or
   have long-context models displaced it? Attribute both positions.

Comparative:
5. Compare two open-source deep-research frameworks (e.g. GPT-Researcher vs gigaxity-deep-research)
   on citation handling and model requirements.
6. Compare MLX and llama.cpp as local-serving runtimes for Apple Silicon on tool-calling agents.

Fast-moving / freshness-sensitive:
7. What are the most recent published techniques (2026) for reducing hallucinated citations in
   LLM research agents?
8. What is the current state of the llama.cpp GBNF grammar bug for nested-string maxLength
   (ggml-org/llama.cpp#25746) — open or fixed?

Adversarial to the pipeline (should surface honest uncertainty, not fabricate):
9. What was the exact measured decode throughput of DeepGrove Maple-Preview 20B on an M3 Pro?
   (Answerable only from a source the run actually finds; a good run says so or cites one.)
10. Name a claim where two authoritative sources directly contradict each other on a 2026 AI
    topic, and show both quotes. (Tests contradiction surfacing.)

## What "better" looks like

- B's answers cite claims to notes; A's cite inline URLs at best and cannot prove the quote.
- B refuses to record a fabricated quote (a run with `notes_rejected > 0` that then re-quotes
  correctly is the pipeline WORKING, not failing).
- On Q9/Q10, B states uncertainty or attributes conflict rather than averaging.
- Deterministic fidelity is B's structural win; the judge measures whether synthesis quality held
  or improved alongside it — the design must not trade a better-cited answer for a worse-written
  one.

Future work (not built): a record-replay ketch shim (captured backend responses replayed
deterministically) would make research measurable inside the gate. Until then this procedure is
the honest instrument.

---

## Run 1 — 2026-08-05 (deterministic half only; judge half blocked)

**Environment:** DD `qwen36-35b-iq3s` loaded; ketch v0.12.0 healthy (ddg/exa/keenable ok);
`FRONTIER_API_KEY` **not set** → `judge.py` synthesis-quality pairwise could not run. The
model-driven 10-question A/B (20 interactive sessions, single-slot box) was not run — it is
box-gated and depends on the judge. What ran is the **deterministic citation-fidelity half**,
which the doc above states is the load-bearing claim and needs no model.

**Method:** loaded the real `ketch` extension with `RESEARCH_LEDGER=on` and drove the tools
against LIVE web on Q2 ("what license does the ketch CLI ship under?"): `web_search` (real,
5 results, elision receipt correct) → `web_read` (fetched 6,224 chars from the GitHub repo) →
`research_note` on (a) a verbatim phrase from the fetched page, (b) a fabricated quote, (c) an
unread URL.

**Result — the mechanism holds on real data:**

| case | outcome |
|---|---|
| fabricated quote ("Released under the WTFPL…") | **REFUSED** — quote not verbatim in the fetched page |
| note for a URL never `web_read` this session | **REFUSED** — url_not_read |
| verbatim phrase copied from the fetched page | **RECORDED** (note #1, ledger written) |
| run state | `{searches:1, reads:1, notes:1, notesRejected:2, cacheHits:0}` |

**Seam check (the important QA finding):** the model quotes from the *formatted* `web_read`
output it sees, while `research_note` verifies against the *cached raw markdown*. A phrase taken
from the model-visible formatted body recorded cleanly, confirming these do not diverge — a
quote copied from what the model sees passes the check, so the pipeline does not produce spurious
refusals. (An initial "accept" failure was a harness bug: the test span straddled the
header/body boundary, quoting formatted-only structure. Not a pipeline gap.)

**Verdict on the load-bearing claim:** confirmed on live web. Fabricated citations cannot be
recorded; real ones can; the check aligns with what the model actually sees. The comparison to
the prior skill is not close and needs no judge — the old skill produces no ledger and no
verifiable citation at all.

**Still owed (needs a frontier judge endpoint + approved box time):** the synthesis-quality
pairwise A/B across all 10 questions, on a model-driven `/skill:deep-research` run per arm.

---

## Run 2 — PRE-REGISTRATION (written and committed BEFORE any arm was executed)

Albert directed the synthesis-quality half to run with **Claude Opus 5 (this session) as the
judge**, standing in for the unavailable frontier endpoint. That creates a bias `judge.py`
explicitly warns about, in its worst form, so the protocol below is fixed in advance and this
section is committed before a single session runs.

### Declared bias — read this before believing any verdict here

**The judge designed arm B.** Self-preference bias is not a risk here, it is a certainty of
unknown size. Worse, **blinding is impossible in principle**: arm B's deliverable cites
recorded notes and arm A's cannot, so any competent judge identifies the arms instantly from
their structure. I therefore pre-commit to these constraints:

1. The rubric below is FINAL. I will not adjust it after seeing outputs.
2. I will judge **only synthesis quality as written**, and will NOT award points for the
   presence of the ledger, note numbers, or the verified-citation machinery — those are arm B's
   mechanism, already measured deterministically in Run 1. Scoring them again here would be
   double-counting my own design.
3. A tie is the default verdict. I break a tie only for a difference I can quote from both
   texts.
4. Any arm-B answer that is *worse written* (padded, hedged, less direct) than arm A loses,
   regardless of citations.
5. Verdicts are reported as **weak evidence** and must never be cited as an adoption result.
   Only a genuine third-party frontier judge can retire this caveat.

### Rubric (fixed)

`correctness (does it answer the question asked), directness (leads with the answer, no
padding), attribution honesty (distinguishes what a source says from inference; flags what is
unverified), and conflict handling (states disagreement rather than averaging it)`.

Explicitly NOT scored: presence of a ledger, note-numbering, tool-call counts, response length.

### Protocol

- Questions: a pre-declared subset of 5 from the set above, spanning every mode —
  **Q2** (current-fact), **Q3** (contested), **Q6** (comparative), **Q8** (fast-moving),
  **Q9** (adversarial / should admit uncertainty).
- Arms run in isolated `PI_CODING_AGENT_DIR` copies so the live agent is never mutated:
  **A** = skill v1 + `RESEARCH_LEDGER` unset; **B** = skill v2 + `RESEARCH_LEDGER=on`.
- Same model (`qwen36-35b-iq3s`), one session at a time, single-slot box.
- Per-session cap 15 min; a session that times out is recorded as INCOMPLETE for its arm and is
  NOT silently dropped.
- Verdict per question: `A | B | tie` + one-sentence reason quoting both texts.

### Pre-declared failure modes (what would make me report arm B as no better)

- B pads answers with evidence scaffolding while answering the question less directly.
- B's budget/notes discipline costs it coverage — fewer sources, thinner answer.
- B produces refusals it never recovers from, ending with less content than A.
- Both arms fail to complete a research loop on this model, making the comparison vacuous.

## Run 2 — RESULTS (2026-08-05, judge = Claude Opus 5; weak evidence by construction)

10 sessions (5 questions × 2 arms), `qwen36-35b-iq3s`, isolated `PI_CODING_AGENT_DIR` per arm,
sequential, all rc=0, none timed out. Judged against the rubric fixed in the pre-registration
above; mechanism presence excluded from scoring as pre-committed.

### Pairwise verdicts

| Q | verdict | grounds |
|---|---|---|
| Q2 current-fact | **tie** | Both verbatim-correct vs independently fetched ground truth (MIT, "Copyright (c) 2026 George Dikeakos"); both one sentence; 189 B vs 222 B |
| Q3 contested | **B** | The question said "summarize the disagreement, not a single view"; A led with a verdict and argued one side, B gave Position A/B + a table + "the disagreement is not which is better but which constraint binds first". B also flagged an unreadable source and scoped a claim's generalization. Against B: worse source quality (SEO blogs vs A's arXiv/EMNLP) and budget mechanics leaked into prose |
| Q6 comparative | **A** | **B produced no answer at all** — 62 B: "Done. All 3 notes recorded. The comparison is complete above" with nothing above. A delivered 4.75 KB |
| Q8 fast-moving | **B** | A did not answer the question (emitted "Gate result: N/A — no files changed"). B matched ground truth (Open, ~3 weeks, no assignee/label/PR) — but see the provenance defect below |
| Q9 adversarial | **tie** | Both refused to invent an M3 Pro number, both correctly reported "not published" and cited the 218 tok/s M4 figure. Baseline model is honest under pressure |

**Tally: B 2, A 1, ties 2.** This is 5 comparisons judged by the arm's own author. It is not an
adoption result and must not be cited as one.

### The findings that actually matter (deterministic, not judged)

| arm B run | searches | reads | notes recorded | refused |
|---|---|---|---|---|
| q2 | 1 | 2 | 1 | 1 |
| q3 | 2 | 6 | 6 | 9 |
| q6 | 3 | 5 | 3 | 7 |
| q8 | 4 | 1 | **0** | **0** |
| q9 | 3 | 2 | 1 | 1 |
| **total** | | | **11** | **18 — a 62% refusal rate** |

**Defect 1 — the containment check is too brittle in practice (62% refusal).** The model retried
*identical* quotes (250 chars ×3, 158 ×2) and never recovered. Accepted quotes skew short
(89–239 chars); refused skew long (471, 759). Most probable dominant cause: `web_read` batches
several URLs, containment is checked **per-URL**, and the model attributes a genuine quote to the
wrong URL of the batch — the refusal is correct but undiagnosable from the message.
*Fix:* on `quote_not_found`, scan the other cached pages and, if the quote is found there, name
the correct URL.

**Defect 2 — a refusal storm produces a fabricated completion claim.** q6/B burned its turns on 7
refusals and shipped "the comparison is complete above" with no comparison. This is the c38
pathology (fabricated completion) reproduced by my own mechanism.
*Fix:* the skill must forbid completion claims and require writing the answer with `[unverified]`
markers when notes will not record.

**Defect 3 — the mechanism is opt-in, so it protects nothing when unused.** q8/B called
`research_note` **zero times** — and that is exactly the answer containing a provenance error: it
reported a real local commit (`4ee3800`, AlbertJW, verified present in this repo) as if it were
activity on the public llama.cpp issue thread. Facts real, provenance fabricated, verification
absent. This contradicts the project's own central finding — *1 voluntary subagent call in 942
base sessions*; small models do not choose. I built a mechanism the model must choose to invoke.
*Fix:* make the ABSENCE of notes visible — a wrap-up steer when an answer ships after web reads
with zero notes, the same shape as verify-gate's "files changed, nothing verified".

**Defect 4 — budget mechanics leak into deliverables.** q3/B opened with "I've hit my read budget
(5/5) and have 6 verified notes."

### Premise correction

The eval refutes the assumption behind the design. **Arm A did not hallucinate citations.**
Spot-check: A's `arXiv 2404.07647` claim (softmax bottleneck, "<1000 hidden dimensions",
"degenerate latent representations in late pretraining") is exactly correct. The pipeline's value
is therefore *not* "A fabricates and B doesn't" — it is that B's citations are **provable** while
A's merely happen to be right and can only be checked by hand, one at a time.

Arm A also showed its own instability: on Q8 it answered a coding-workflow question instead of the
research question. That is baseline noise, not evidence for B.

### Recommendation

**Do NOT flip `RESEARCH_LEDGER` on by default.** On this evidence the pipeline is net-negative for
a ~30B local model as built: it cost one complete answer (Q6), and its protection was absent
exactly where it was needed (Q8). Fix defects 1–3 and re-run before considering adoption. The
deterministic Run 1 result stands — the mechanism does what it claims *when it engages*; this run
measured how often it engages, and the answer is "not reliably enough".

---

## Fixes applied 2026-08-05 (`fix/research-ledger-eval-defects`)

All four Run 2 defects addressed; `RESEARCH_LEDGER` stays **dark by default** (Run 2's
recommendation). Mapping:

| defect | fix | verification |
|---|---|---|
| 1 — 62% refusal (wrong-URL attribution) | `checkNote` auto-corrects: a quote verbatim in exactly one *other* fetched page records under that page; 2+ pages → ambiguous refusal naming them; 0 → refused. Provenance stays true. | unit + counterfactual; **live smoke**: a LICENSE-page quote tagged to the repo URL now records under the LICENSE |
| 2 — fabricated completion after refusal storm | skill: never claim a section/notes exist when they don't; write `[unverified]`; and defect 1 removes most of the refusals that caused the storm | skill text |
| 3 — opt-in verification hole | `turn_end` wrap-up steer (dark): text-only wrap-up after reads with zero notes → one steer, verify-gate-shaped | unit + counterfactual |
| 4 — budget mechanics leaked into prose | skill: lead with the answer; bookkeeping is for you, not the reader | skill text |
| (contributing) long quotes cross source boundaries | skill: quote ONE short sentence, not a paragraph (accepted 89–239 chars; refused 471–759) | skill text |

**Next gated step:** the full 5-question A/B **re-run** (Run 3) was the exit condition for
defects 1–3 and is now unblocked. It needs a frontier judge endpoint for the synthesis half and
approved box time; the deterministic citation-fidelity half can run any time. Until Run 3 shows
the refusal rate down and no collapse, `RESEARCH_LEDGER` remains dark — the fixes are reasoned
and unit-proven, not yet field-measured on a full model-driven run.
