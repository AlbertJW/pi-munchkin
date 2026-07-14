# pi_munchkin

<p align="center">
  <img src="assets/pi-munchkin.png" alt="pi-munchkin mascot: a grinning gap-toothed munchkin knight in mismatched armor, oversized sword in hand, healing potion and a rubber chicken on the belt" width="320">
</p>

> Make a small, locally-served LLM a competent [pi](https://github.com/earendil-works/pi) coding
> agent — and prove that every change to the harness actually earns its place.

**pi-munchkin is two halves you can use independently:**

1. **[The harness](#the-harness)** — pi extensions that make a small model edit code reliably
   (tag-anchored edits, loop-breaking, verify-before-done, planning, guards).
2. **[The self-improvement loop](#the-self-improvement-loop)** — a measurement-gated optimizer that
   A/B-tests harness/governor changes and keeps only the ones that pass a statistical test.

> **Status — a validated loop with measured wins.** Headline result (n=36/arm, local 35B): pass
> rate rose *monotonically as governor prose was removed* — 5.2 KB governor 83%, lean 89%,
> **empty 97%** — so the shipped governor is a 1.4 KB minimal core. The same machinery rejected
> six plausible candidates that measured as noise. A tuning loop that mostly says **no** is the
> point — see [the honest finding](docs/THE-HONEST-FINDING.md).

---

## The harness

Pi extensions. Load them once; most work automatically, a few add commands or env knobs.

| Extension | What it does |
|---|---|
| **hashline** | line/tag-anchored edits instead of brittle exact-text matching — removes the #1 small-model edit failure; multi-file patches are transactional |
| **loop-breaker** | detects call / reason / outcome repetition, steers, then aborts a runaway |
| **verify-gate** | blocks a "done" claim until there is tool evidence for it |
| **plan-runner** | `/plan` — a model-owned TODO list with per-item verify gates |
| **reflect** | `/reflect` — a fresh-context adversarial review of the current plan |
| **drift-scanner** | after a commit, flags dead refs / stale docs the change introduced |
| **git-guard** | confirms before any command that would discard uncommitted work |
| **context-inlet-guard** | bounds oversized file reads before they flood context |
| **context-watcher** | auto-compacts when context crosses a threshold |
| **span-tools** | `search_spans` / `read_span` — bounded retrieval over large files |
| **compact-tool** | `/compact` — summarize and prune older context mid-task |
| **micro-gate** | *(opt-in)* parse/compile-checks just-edited files at turn end |
| **ketch** | web / code / docs search |

Plus a **governor** (`harness/APPEND_SYSTEM.md`) — a minimal system-prompt core (safety gates +
feature docs, no behavioral prose; the loop found prose *hurts* capable models).

### Install

The harness is a pi extension package (the repo-root `package.json` carries the pi manifest). Pi's
package manager runs npm under the hood, so the one dependency (`typebox`) installs automatically;
`@earendil-works/pi-coding-agent` is a peer your pi install already provides. Extensions are
TypeScript and load directly — no build step.

```sh
pi package install pi-munchkin                    # once published to npm
pi package install github:AlbertJW/pi-munchkin    # or straight from git
```

Manage with `pi package list | update | remove`. Manual alternative: copy `harness/extensions` +
`harness/lib` into `~/.pi/agent/extensions/` and `npm i typebox`.

The optional bundled `harness/vendor/pi-subagent` adds the `subagent` tool that `plan-runner` and
`reflect` use when present (they degrade gracefully without it).

### Use

Most extensions are automatic once loaded. The surfaces you invoke:

- **`/plan <request>`** then **`/plan-go`** — plan, then execute with per-step verify gates
  (`/plan <request> yolo` plans and runs in one shot).
- **`/reflect`** — adversarial review of the current plan or last answer (`/reflect help` lists modes).
- **`/compact`** — prune context mid-task.

Behavior knobs (all optional env vars, sensible defaults):

| Env | Effect |
|---|---|
| `LB_REPEAT_T1`, `LB_STREAK_SOFT` | loop-breaker sensitivity |
| `VERIFY_GATE=on\|off` | require evidence before "done" |
| `MICRO_GATE=on` | enable the post-edit parse check |
| `HASHLINE_TAG=hex\|slug` | edit tag style (word-slugs can copy better on tiny models) |
| `SPAN_TOOLS=on` | expose the bounded large-file tools |
| `DRIFT_SCANNER=off` | disable post-commit review |

---

## The self-improvement loop

The optimizer (`optimizer/`, Python) measures whether a change to the harness/governor actually
makes a model write better code, and adopts only changes that pass Fisher's exact test. It is
**human-gated**: a winning governor is written to `proposals/` for you to review and apply — it
never edits your live `~/.pi/agent/`.

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
winner → proposals/ for HUMAN review  (never auto-edits your live harness)
```

### Setup

1. Serve one model on an OpenAI-compatible endpoint at `:8080` — e.g. llama.cpp's `llama-server`
   (see `examples/run-model.example.sh`); copy `harness/models.example.json` /
   `settings.example.json` into your pi config and point them at it.
2. For candidate *proposal*, set `FRONTIER_BASE_URL` + `FRONTIER_API_KEY` (any OpenAI-compatible
   frontier model — used only to suggest edits, never to grade).

### Run a round

```sh
cd optimizer

# 1. find a model's discriminating band (skip tasks it always/never passes)
MODELS="my-model" TASKS="parens equil" N=4 ./fleet_round.sh calibrate
python3 prompt-lab/calibrate.py <gen>

# 2. A/B a set of candidate configs (one gate per candidate, base + candidates)
PI_MODEL=my-model N=6 python3 munchkin.py --gen r1 --tasks parens,equil \
  --candidates 2 --static prompt-lab/configs/static/c14-slug-tags.json,prompt-lab/configs/static/c21-micro-gate.json

# 3. read the verdict (add --manifest for completeness enforcement across a fleet)
python3 prompt-lab/fleet_verdict.py r1
```

**Verdicts:** `ADOPT-*` (significant gain), `NEUTRAL` (within noise — raise N or try a bigger
change), `REJECT` (do-no-harm regression), plus fleet guards `INCOMPLETE` / `MIXED-SIGNS` /
`TASK-REGRESSION`. Full options, task classes, and the candidate queue are in
[`optimizer/docs/HARNESS_SELF_IMPROVEMENT.md`](optimizer/docs/HARNESS_SELF_IMPROVEMENT.md).

### Verify offline (no GPU, no network)

```sh
cd optimizer
python3 munchkin.py --selftest
python3 prompt-lab/fleet_report.py --selftest
python3 prompt-lab/fleet_verdict.py --selftest
python3 prompt-lab/config.py --selftest
./real_gate.sh --dry
./munchkin.py --dry          # prints the GPU session-count estimate
```

---

## Docs

- **[The honest finding](docs/THE-HONEST-FINDING.md)** — why the *instrument*, not the optimizer,
  is the hard part.
- **[Research notes](docs/RESEARCH-NOTES.md)** — approaches evaluated, and why each was adopted,
  pocketed, or rejected.
- **[Full methodology & candidate queue](optimizer/docs/HARNESS_SELF_IMPROVEMENT.md)** — the living
  design doc: surfaces, statistics, instrument-integrity incidents, every candidate's disposition.

## License

MIT (`LICENSE`). Bundles the MIT-licensed `pi-subagent`; peer-depends on MIT-licensed pi — see
`NOTICE.md`.
