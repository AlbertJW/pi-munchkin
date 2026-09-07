# G03 Qwen 35B representative baseline — r2 handoff

## Status

Prepared and pushed, not executed. This addendum supersedes the identity
bindings in the r1 runbook while preserving its execution, stop, and
reconstruction procedure. It is a baseline measurement, not an optimizer
campaign or adoption decision. No model session has been started for r2.

## Exact frozen identities

- Subject: `local-llamacpp/qwen36-35b-iq3s` (Qwen 35B adoption cohort)
- Pack: `optimizer/v2/benchmarks/g03-representative-pilot-r2.json`
- Pack revision: `2026-09-07.r2`
- Pack file SHA-256: `bcb607346e68e97c26ec69f48543a79c1844c82e04b9f546a069af8a54d94f5e`
- Preregistration: `optimizer/v2/examples/g03-baseline-preregistration-r2.json`
- Preregistration canonical SHA-256: `b434c3029232ce9e430b0b8c62891dd4e501f8f8bfcadc01baaa78223788b43f`
- Source surface SHA-256: `9aed85c14ebae22b7f255d00fbe9eb7a8a90b023a450291837ef9cf40e67bc18`
- Loaded surface SHA-256: `f188bb01b175d1fec2b52a3142e615584cc2b14b5fe1ba883ea2b2b4e447a114`
- Baseline config SHA-256: `5306ecc5a68682ce8fe6d52d59e0171367cfae0f390965bc4956c0f9d706d379`
- Candidate config SHA-256: `47c9a04ca233ff552ff71e4e4f77003244cb148d8704f38fb62d2f5cf615b639`

The source commit is `66c3574`. The live mirror was checked after the push:
all 128 managed first-party files match and the loaded hash above was resolved
from that mirror. At the latest readiness check llama-swap listed Qwen as
`unloaded`; an unloaded model is not a valid execution receipt.

## Offline preflight

Run these checks immediately before requesting execution approval. They do not
contact a model or launch Pi:

```sh
npm run -s mirror:check
node --experimental-strip-types harness/scripts/surface-hash.ts /Users/Albert.Wessels/.pi/agent
python3 -m optimizer.v2.baseline --dry \
  --preregistration optimizer/v2/examples/g03-baseline-preregistration-r2.json
PI_MODEL=qwen36-35b-iq3s DD=qwen36-35b-iq3s ./optimizer/real_gate.sh --dry
```

The dry baseline must remain `model_quality_evidence=false`; the opaque test
cases remain quarantined. The gate dry output must identify the explicit Qwen
request and its actual state, rather than a router catalog fallback.

## Execution boundary

After a human explicitly approves the resolved identities and a pinned Qwen
35B serving state, execute the matched train/development cells using the r1
runbook's procedure. The parent runner must emit one private
`pi.research-trial/v1` artifact for each research cell before invoking
`optimizer/v2/research_baseline.py --reduce`; the shared
`optimizer/v2/real_baseline.py --ingest` reducer then joins all coding and
research rows. Every attempted cell, timeout, and exclusion must be retained.
Ling remains protocol-only and is never pooled with this cohort.

Stop on any source, loaded-surface, model/provider, serving, sidecar, fixture,
isolation, or telemetry drift. A complete-looking answer without a settled
plan and parent-validated citations is not a passing research trial. The run
produces a private review packet only; it cannot mirror, commit, or adopt a
candidate.

