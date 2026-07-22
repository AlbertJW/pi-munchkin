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

The active research and experiment backlog is maintained in
[the small-model improvement roadmap](optimizer/docs/SMALL_MODEL_IMPROVEMENT_ROADMAP.md).

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
| **context-watcher** | observes every compaction and, when enabled, auto-compacts at `CTX_WATCH_PCT` (default 70) |
| **context-surface** | passively hashes and aggregates the exact provider-bound context; never rewrites messages |
| **span-tools** | `search_spans` / `read_span` — bounded retrieval over large files |
| **compact-tool** | `compact_context` — model-requested structured compaction with one explicit post-compaction resume |
| **micro-gate** | *(opt-in)* parse/compile-checks just-edited files at turn end |
| **ketch** | always-on `web_search` / `web_read` for bounded public research; `KETCH=off` disables it |
| **did-you-mean** | suggests the nearest on-disk path after a mistyped file access |
| **pi-subagent** | bundled `subagent` tool for isolated exploration, execution, and review |

Plus a **governor** (`harness/APPEND_SYSTEM.md`) — a minimal system-prompt core (safety gates +
feature docs, no behavioral prose; the loop found prose *hurts* capable models).

### Install

The harness is a pi extension package (the repo-root `package.json` carries the pi manifest). Pi's
package manager runs npm under the hood, so the runtime dependency (`typebox`) installs
automatically; `@earendil-works/pi-coding-agent` is a peer your pi install already provides.
Extensions are TypeScript and load directly — no build step. Node.js 22.6 or newer is required.

```sh
pi package install pi-munchkin                    # once published to npm
pi package install github:AlbertJW/pi-munchkin    # or straight from git
```

Manage with `pi package list | update | remove`. Manual alternative: copy `harness/extensions` +
`harness/lib` into `~/.pi/agent/extensions/`, copy `skills/deep-research` into
`~/.pi/agent/skills/deep-research`, and run `npm i typebox` in the agent directory.

The bundled `harness/vendor/pi-subagent` adds the `subagent` tool that `plan-runner` and `reflect`
use. The harness still degrades gracefully if an installation chooses not to load that entry point.

The published package deliberately excludes `harness/extensions/chaos.ts`: it is a benchmark-only
fault injector and is never part of the default runtime manifest.

### Use

Most extensions are automatic once loaded. The surfaces you invoke:

- **`/plan <request>`** then **`/plan-go`** — plan, then execute with per-step verify gates
  (`/plan <request> yolo` plans and runs in one shot).
- **`/reflect`** — adversarial review of the current plan or last answer (`/reflect help` lists modes).
- **`/compact`** — prune context mid-task.
- **`/skill:deep-research <question>`** — bounded multi-source research with inline citations.
- **`/ketch-status`** — show the installed Ketch version and backend health.

Behavior knobs (all optional env vars, sensible defaults):

| Env | Effect |
|---|---|
| `LB_REPEAT_T1`, `LB_STREAK_SOFT` | loop-breaker sensitivity |
| `VERIFY_GATE=on\|off` | require evidence before "done" |
| `MICRO_GATE=on` | enable the post-edit parse check |
| `HASHLINE_TAG=hex\|slug` | edit tag style (word-slugs can copy better on tiny models) |
| `SPAN_TOOLS=on` | expose the bounded large-file tools |
| `KETCH=off` | remove the default-on web tools for offline/private sessions |
| `KETCH_BACKEND`, `KETCH_MULTI_BACKENDS` | quick backend (default `ddg`) and broad-search set (default `ddg,exa,keenable`) |
| `CONTEXT_WATCHER=on\|off`, `CTX_WATCH_PCT=60\|70\|80` | enable and tune proactive compaction; telemetry remains active when disabled |
| `DRIFT_SCANNER=off` | disable post-commit review |

### Platform and security notes

- Supported release platforms are Linux and macOS on Node.js 22.6 or newer; both run in CI.
- Extensions execute with the permissions of the pi process. Review the manifest and keep API keys,
  tokens, and machine-specific paths out of tracked settings.
- Ketch `0.12.0` or newer must be installed separately — macOS: `brew install 1broseidon/tap/ketch`;
  any platform: `bash scripts/install-deps.sh` (downloads the correct release binary from
  [ketch's releases](https://github.com/1broseidon/ketch/releases) and verifies its checksum; also
  checks the Node.js version requirement). The extension
  exposes only two compact tools: search finds leads and read fetches a selected public source set.
  Results are bounded and untrusted; material claims still need source URLs. Ketch runs with a
  reduced child environment that does not inherit model-provider credentials. Run `ketch config set backend
  ddg` for the keyless default, or `/ketch-status` to inspect backend health.
- Report vulnerabilities privately using [the security policy](.github/SECURITY.md).

### Verify a checkout or release candidate

Install exactly the locked development graph, then run the canonical verification lane:

```sh
npm ci
npm run verify
```

`verify` runs the complete Node test suite from a unique temporary telemetry sink and fails if the
default live telemetry file changes, plus a portable full-harness TypeScript check, the read-only
health check, an `npm pack` smoke test that verifies package contents and imports every manifest
extension, plus all offline optimizer self-tests, shell syntax checks, fixture tests, admission
integrity checks, and the documented `real_gate.sh --dry` wiring smoke. The health check automatically uses `harness/*.example.json` in a clean clone
and local `settings.json` / `models.json` when run from an installed harness. Individual lanes are
available as `npm test`, `npm run typecheck`, `npm run health`, `npm run pack:smoke`, and
`npm run verify:optimizer`.

---

## The self-improvement loop

The optimizer (`optimizer/`, Python) measures whether a change to the harness/governor actually
makes a model write better code, and adopts only changes that pass Fisher's exact test. It is
**human-gated**: a winning governor is written to `proposals/` for you to review and apply — it
never edits your live `~/.pi/agent/`.

The current bounded-retrieval screen is checked in as
[`prompt-lab/configs/span-screen.json`](optimizer/prompt-lab/configs/span-screen.json).
Preview or run its single interleaved span-tools off/on comparison:

```sh
python3 optimizer/prompt-lab/span_screen.py --dry
python3 optimizer/prompt-lab/span_screen.py
```

It uses the approved `bigdata` fixture, six reps/arm, and ordinary single-comparison α=0.05.
Candidate rows must actually call the span tools and carry an exhaustive receipt; otherwise the
aggregate mechanism report is `INELIGIBLE` and the command exits nonzero. Config and experiment
hashes bind each row even when prompt hashes match. The launcher computes the live extension/lib
surface before the session, and the running harness corroborates it with an authenticated receipt;
rows lacking that valid receipt remain blocked. Credentialed endpoints and explicit credential
passthrough are refused, and fresh confirmation remains mandatory before promotion.

```
gate baseline governor  ──►  if saturated (≥85% pass): stop, no headroom
        │
        ▼
frontier model proposes K one-surface candidates from VALIDATION failures
        │
        ▼
gate each candidate  ──►  Fisher's exact test vs. baseline (do-no-harm)
        │
        ▼
adopt only a significantly-better candidate  ──►  repeat until plateau
        │
        ▼
winner → proposals/ for HUMAN review + confirmation/canary  (never auto-edits your live harness)
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

# 0. admit the task fixtures (fail-closed: unapproved fixtures refuse to run).
#    Once per task; approval names a human reviewer and expires after 90 days.
#    In a hurry? add --exploratory to real_gate/fleet_round — rows are then
#    marked non-authoritative and excluded from verdicts.
python3 prompt-lab/fixture_admission.py check parens
python3 prompt-lab/fixture_admission.py approve parens --reviewer "Your Name"

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

Generated candidates carry a `pi.optimizer-candidate/v1` sidecar and append-only journal entry.
Exactly one contiguous governor diff, one config leaf, or one message-template leaf is allowed;
mixed/no-op/unknown candidates are recorded and rejected before evaluation. LLM judging is
diagnostic only and cannot override deterministic task outcomes or the held-out admission gates.

The admitted `context-pressure` fixture uses disjoint validation and held-out roots, generates
319 KB of hashed partitioned evidence, forces a red-to-green repair, and checks exact identifier
retention. It is the prerequisite for watcher, compaction, result-pruning, observational-memory,
and output-cap experiments; none of those message-changing behaviors is promoted by default.

### Operational guards

All automatic inside `real_gate.sh`; listed so you know they exist (each one paid for itself):

- **Seatbelt jail** (macOS): sessions can write only their workdir + pi's sessions/telemetry
  dirs, use a private per-run temp directory, and cannot read the harness, hidden graders,
  public mirror, or common host credential stores.
  Auto-off where `sandbox-exec` is unavailable — hidden tasks then refuse to run.
- **Reduced child environment** — headless Pi starts under `env -i`; unrelated frontier/cloud,
  SSH-agent, npm, and shell-hook secrets are removed. `PI_GATE_PASSTHROUGH_ENV=name,...`
  explicitly passes exceptional provider variables and forces exploratory-only rows.
- **Memory watchdog** — each session runs in its own process group; past `PI_MEM_CAP_GB`
  (default 12) the whole group is killed. Model-spawned `node` can't orphan or balloon.
- **Single-slot serving protections** — observational-memory consolidation is forced passive
  in gate sessions (a detached one holds a one-request-at-a-time endpoint and 429s the next
  session), and any 429/rate-limit aborts the rep with **no row written** — the endpoint's
  concurrency limit must never be scored as the model's competence.
- **Execution policy** — `GATE_NETWORK=open|endpoint`, `MODEL_CONTROL=llama|pi-native`.
  Open networking or a remote (non-loopback) endpoint ⇒ rows are non-authoritative;
  only a loopback endpoint jail can produce authoritative rows.

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
- **[Benchmark integrity](optimizer/prompt-lab/BENCHMARK-INTEGRITY.md)** — fixture admission,
  provenance schemas, serving fingerprints, and what "authoritative" means.
- `optimizer/prompt-lab/harness_roi.py` — measures the harness's *own* injected footprint
  (steer text as % of model output, per model, split by pass/fail).

## License

MIT (`LICENSE`). Bundles the MIT-licensed `pi-subagent`; peer-depends on MIT-licensed pi — see
`NOTICE.md`.
