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
