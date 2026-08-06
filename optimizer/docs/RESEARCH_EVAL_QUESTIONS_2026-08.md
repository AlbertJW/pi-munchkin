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
