# Research notes

Approaches evaluated for the pi-munchkin substrate — recorded so the reasoning isn't re-litigated. Moved out of the top-level README; see [`optimizer/docs/HARNESS_SELF_IMPROVEMENT.md`](../optimizer/docs/HARNESS_SELF_IMPROVEMENT.md) for the full living queue.


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


## 2026-07-16 — the instrument matters more than the candidate

A full A/B round was voided and re-run this week; every lesson was about the measurement, not
the candidates:

- **A one-request-at-a-time endpoint turns any concurrent caller into arm bias.** An installed
  memory extension void-launched an uncancellable consolidation agent loop on `turn_end`; the
  abandoned request outlived pi and held the serving slot. 58/164 sessions died on their FIRST
  request with a 429 — and were recorded as `gate=0`, i.e. the server's concurrency limit was
  scored as the model's competence. Longer candidate sessions fire more `turn_end`s, so the
  damage was asymmetric across arms. Fixes now in the gate: consolidation forced passive in
  gate sessions; 429/rate-limit aborts the rep with no row written.
- **Proxies lie; controls catch them.** Three failure-attribution claims died in one day, each
  a cheap proxy (empty log = hang; touched-a-429 = killed-by-429; decoy path in transcript =
  poisoned-by-decoy). Each was killed the same way: running the detector on the PASSING
  population, and reading the actual bytes of the hits. The discipline is now house style:
  control group first, content over proxies, and an explicit "unclassified" bucket instead of
  a forced story.
- **A clean instrument moved the baseline more than any candidate has.** Post-fix, the target
  model saturated a task (8/8) whose "failures" had all been serving artifacts. Calibration
  before candidates is not optional.
