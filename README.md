# pi_munchkin

<p align="center">
  <img src="assets/pi-munchkin.png" alt="pi-munchkin mascot: a grinning gap-toothed munchkin knight in mismatched armor, oversized sword in hand, healing potion and a rubber chicken on the belt" width="340">
</p>

Harness extensions for the [pi](https://github.com/earendil-works/pi) coding agent, plus a
**measurement-gated, significance-aware self-improvement loop** for tuning them against small,
locally-served LLMs.

Two halves:

- **`harness/`** — the thing being tuned: a set of pi extensions (an anti-loop breaker with
  outcome-loop escalation, a pre-"done" verify gate, a plan runner, drift/context/git guards,
  bounded span tools for large files, a fresh-context `/reflect` plan reviewer, fail-open
  telemetry, subagents) and a system-prompt *governor* (`APPEND_SYSTEM.md`).
- **`optimizer/`** — the loop that measures whether a change to the governor actually makes a model
  write better code, and only adopts changes that pass a statistical test.

> **Status: a validated loop with measured wins.** The headline result (dd1, n=36/arm on a local
> 35B): pass-rate rose **monotonically as governor prose was removed** — full 5.2KB governor 83%
> (with 9 loop-breaker aborts), lean 89%, *empty* 97% (p=0.053) — so the live governor is now a
> 1.4KB minimal core (safety gates + feature docs), adopted through the loop's own human-gated
> process. The same machinery killed six plausible candidates that measured as noise, rejected a
> popular context extension as architecturally incompatible (and in doing so proved hash-anchored
> editing is load-bearing for weak models). A tuning loop that mostly says **no** is the point;
> see "The honest finding" for why the instrument is the hard part.

## How the optimizer works

```
gate baseline governor  ──►  if saturated (≥85% pass): stop, no headroom
        │
        ▼
frontier model proposes K minimal governor edits from the FAILING traces
        │
        ▼
gate each candidate  ──►  Fisher's exact test vs. baseline (do-no-harm)
        │
        ▼
adopt only a significantly-better candidate  ──►  repeat until plateau
        │
        ▼
winner written to proposals/ for HUMAN review  (never auto-edits your live harness)
```

- **Gate** (`optimizer/real_gate.sh`): applies a governor, runs real coding tasks headless N reps
  each, scores pass/fail (`node --test` + hidden-test differential grading), emits rows.
- **Significance** (`optimizer/prompt-lab/fleet_report.py`): Fisher's exact test, not point deltas —
  robust to 1-of-N noise, sensitive to real effects at small N. Verdicts: REJECT / NEUTRAL /
  ADOPT-*.
- **Propose** (`optimizer/prompt-lab/propose.py`): a frontier model reads the failures and proposes
  minimal, tagged governor edits.
- **Loop** (`optimizer/munchkin.py`): ties it together. Pure + injectable, so `--selftest` proves
  the control flow offline with no GPU/network.

The whole loop is **human-gated**: a winning governor is written to `proposals/` for you to review
and apply by hand. It never edits your live `~/.pi/agent/APPEND_SYSTEM.md`.

## The honest finding

The hard part isn't the optimizer — it's finding a **(model, task) pair in the discriminating
band** (roughly 20–85% pass rate). Empirically:

- Capable models **saturate** bounded tasks (100% pass) → no headroom to optimize against.
- Tiny models are **bimodal** (0% / 100%) → no gradient either.
- You need a model that *sometimes* solves a task but not reliably. That pairing is the prerequisite
  for any measurable harness gain, and it's narrow.

`optimizer/prompt-lab/calibrate.py` exists to find that band per model before you spend GPU hours
optimizing.

The second honest finding, learned the hard way: **the instrument fails more often than the
hypothesis.** Every result above survived only because the gate distinguishes "the model failed
the task" from "the harness never measured anything": tasks that score a no-op as success,
sessions that never reached the model, a silently hot-swapped model, an orphaned sweep writing
rows into the next run's files. Each has a dedicated guard now (`t2-check` fail-to-pass grading,
connection-error abort, a degraded-model token tripwire, gate-process reaping) — budget as much
effort for instrument integrity as for candidates.

## Setup

1. Install [pi](https://github.com/earendil-works/pi) (`@earendil-works/pi-coding-agent`).
2. Serve one model on an OpenAI-compatible endpoint at `:8080` — e.g. llama.cpp's `llama-server`
   (see `examples/run-model.example.sh`). Copy `harness/models.example.json` /
   `settings.example.json` into your pi config and point them at it.
3. Point pi at the extensions in `harness/` (and `harness/vendor/pi-subagent`).
4. For `propose`/`munchkin`, set `FRONTIER_BASE_URL` + `FRONTIER_API_KEY` (any
   OpenAI-compatible frontier model, used only to *suggest* edits).

`GOVERNOR=/path/to/your/APPEND_SYSTEM.md` overrides which governor the optimizer reads (defaults to
the bundled `harness/APPEND_SYSTEM.md`).

## Verify offline (no GPU, no network)

```sh
cd optimizer
python3 munchkin.py --selftest
python3 prompt-lab/fleet_report.py --selftest
python3 prompt-lab/config.py --selftest
python3 prompt-lab/sql_eval.py --selftest
python3 prompt-lab/propose.py --selftest
python3 ab-machinery/metrics.py --selftest
./real_gate.sh --dry
./munchkin.py --dry          # prints the GPU session-count estimate
```

## Research notes

Approaches evaluated for this substrate — recorded so the reasoning isn't re-litigated:

- **AgentBench** (THUDM) — rejected as a task source: wrong skill axis (bash/SQL agency, not
  library edits), non-hermetic grading (live Docker + MySQL per task), and the published numbers
  put small models at the floor (3–12%), not in the band.
- **design.md** (Google Labs) — not adopted (frontend-specific, no benchmarks). Pocketed two
  ideas: a *design-fidelity task class* (edge-case-rich, deterministically lintable — candidate
  in-band fuel for models that saturate clean single-function tasks) and the `add-rationale`
  operator hypothesis (see Queued candidates in `optimizer/docs/HARNESS_SELF_IMPROVEMENT.md`).
- **nuclear-grade-context-engineering** (FlyFission) — rejected wholesale: it encodes discipline
  as process prose for the model to follow, while this harness encodes the same load-bearing
  ideas as mechanisms the model can't bypass (hidden tests = independent checker, verify-gate =
  evidence before done, human-gated adoption = explicit verdict). Its evidence is author-judged
  only. One nugget queued: the evidence-first claim rule as a governor candidate.
- **Verified in code** (corrects an earlier unverified review finding): subagents DO load the
  global governor — the child `pi` appends the role prompt (`--append-system-prompt`), it does
  not replace `APPEND_SYSTEM.md`. No `subagent_governor` search dimension is needed.
- **pi ecosystem finds** (r/PiCodingAgent unreachable from tooling; verified via npm/GitHub):
  *pi-lean-ctx* (Apache-2.0) does token-saving tool-output routing — evaluate it before
  building an equivalent; *oh-my-pi* (16k-star fork) independently uses hash-anchored edits,
  validating this repo's hashline approach.
- **Gate-session write jail** (r/PiCodingAgent's agent-lock pattern) — the Linux-only BPF-LSM
  tool itself doesn't fit, but it flagged a real gap: headless gate sessions ran unrestricted
  bash. Adopted natively via macOS Seatbelt (`sandbox-exec`) fencing writes to the task
  workdir; kernel-enforced, no model-visible prose.
- **"Applications" / scoped agent views** (r/LocalLLaMA) — not adopted: the menu-verb idea
  (model never retypes exact strings) is what hashline already does for edits, and subagents
  cover scoped-context isolation. Pocketed one telemetry-gated candidate: the thread's
  anti-signal that a tail-pinned persistent plan block made a small model avoid its planning
  tools — test plan-injection placement if telemetry shows plan-steer non-compliance.
- **jlens / J-Space** (Anthropic's global-workspace paper, `anthropics/jacobian-lens`) —
  rejected: needs HF safetensors + a CUDA GPU (fleet is GGUF on llama.cpp; no CUDA box),
  base→fine-tune lens transfer unvalidated, and the readout is a cleaner view of known
  intermediate-layer representations rather than a new capability. Pocketed for a hardware
  change: J-space probe as a cheap steer-wording pre-screen ahead of the real gate (Fisher
  remains the adoption authority); pre-fitted lenses exist at HF `neuronpedia/jacobian-lens`
  for the fleet's Qwen bases.

## License

MIT (`LICENSE`). Bundles the MIT-licensed `pi-subagent` and peer-depends on MIT-licensed pi — see
`NOTICE.md`.
