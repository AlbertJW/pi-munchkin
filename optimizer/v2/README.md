# Optimizer V2

Optimizer V2 is the dark, Pi-native successor to the historical autoresearch
loop. It is an evaluation and candidate-selection system, not a deployment
system. It never commits, mirrors, installs, or adopts a selected candidate.

## Safety model

A campaign is one explicitly approved unit of autonomy. `prepare` strictly
resolves a `pi.optimizer-campaign/v2` JSON manifest and prints its canonical
SHA-256 without calling an optimizer provider or task model. `run` and `resume`
require that exact digest through `--approve-sha`; a changed manifest is a new
campaign. `selftest`, `dry`, `prepare`, `status`, `inspect`, and `replay` are
offline/read-only with respect to models.

The authoritative run state is `events.jsonl`. Each fsynced event has a stable
operation ID and a hash-chain link. Snapshots, metrics, and the candidate graph
are disposable projections rebuilt by `replay`. The run directory and files use
private permissions and default to `~/.pi/optimizer-v2/runs`, outside Git
ancestry. Set `PI_OPTIMIZER_V2_RUN_ROOT` or pass `--run-root` to choose another
private root.

Candidates are immutable content-addressed records. One candidate changes one
typed surface family and declares its hypothesis, predicted mechanism, exposure,
verified diff, and changed units. The `pi-harness-patch` adapter checks path
containment and family allowlists, materializes into an isolated disposable
workspace, applies the patch, and runs argv-only verification commands. A
composition is a fresh candidate and is refused if either parent was not already
accepted or their changed units conflict.

Scenario and surface behavior are plugin boundaries. Optimizer-provider sessions
use schema-validated `evolve`, `diagnose_patch`, and `reflect` results. The build
includes deterministic fake adapters for complete offline lifecycle and recovery
tests, an artifact-JSON provider for externally generated sessions, and an
OpenAI-compatible provider whose default network boundary is loopback. Unknown
plugins fail during preparation.

## Benchmark and selection rules

Benchmark packs are immutable and bind fixture-admission receipts. Train,
development, and opaque-test case IDs must be disjoint. Calibration selects only
the preregistered discrimination band and stops as `uninformative_benchmark` when
too few cases remain. Training comparisons require identical
`(case, seed, repetition)` cells. Binary metrics use an exact paired net-fix rule;
continuous campaigns use exact paired sign permutations. Improvement, mechanism
exposure, every hard guard, and stable serving identity are all required.

Development observations never enter provider payloads. Training survivors are
checked sequentially on declared guard models and then on development. Reflection
classifies fixed, regressed, still-failing, and still-passing matched cells. Final
selection uses development primary score, guard margin, verified diff size, and
stable candidate ID in that order. The only output with adoption implications is
a human review packet.

## Pi gate bridge

`PiGateScenario` keeps `real_gate.sh` as the trusted evaluator. Its offline `dry`
path characterizes the existing command, while its ingestion path accepts only
fresh `pi.eval-row/v4` files and their exact trial-validity sidecars. Rows must be
authoritative, complete, telemetry-authenticated, exposure-classified, stable on
one serving and parent-session identity, and bound to the campaign's config and
surface fingerprints. This first bridge deliberately does not refactor the Bash
gate or its grader/security boundary.

The CLI does not register live `pi-gate` campaign execution yet: preparing and
inspecting its manifests is supported, but `run` fails closed until candidate
materialization and the existing gate invocation are connected by a separately
reviewed campaign adapter. This prevents a nominal adapter from silently testing
the live harness instead of the immutable candidate workspace.

## Commands

```sh
python3 -m optimizer.v2.cli selftest
python3 -m optimizer.v2.cli prepare --manifest optimizer/v2/examples/campaign.json
python3 -m optimizer.v2.cli dry --manifest optimizer/v2/examples/campaign.json
python3 -m optimizer.v2.cli run --manifest optimizer/v2/examples/campaign.json --approve-sha <printed-sha> --run-root /private/path
python3 -m optimizer.v2.cli resume --manifest optimizer/v2/examples/campaign.json --approve-sha <same-sha> --run-root /private/path
python3 -m optimizer.v2.cli status --manifest optimizer/v2/examples/campaign.json --run-root /private/path
python3 -m optimizer.v2.cli replay --manifest optimizer/v2/examples/campaign.json --run-root /private/path
```

The example is deterministic and performs no network or model inference.

