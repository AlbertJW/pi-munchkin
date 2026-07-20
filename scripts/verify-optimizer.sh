#!/usr/bin/env bash
# Complete offline optimizer verification. No model, GPU, network, or live pi
# configuration is required; all scratch state is created under temporary dirs.
set -euo pipefail
export PYTHONDONTWRITEBYTECODE=1

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OPT="$ROOT/optimizer"

while IFS= read -r script; do bash -n "$script"; done < <(find "$OPT" -type f -name '*.sh' -print | sort)

python3 - "$OPT" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1])
for path in sorted(root.rglob("*.py")):
    compile(path.read_bytes(), str(path), "exec")
print("python syntax: OK")
PY

selftests=(
  munchkin.py
  ab-machinery/judge_diffs.py
  ab-machinery/metrics.py
  prompt-lab/calibrate.py
  prompt-lab/canary.py
  prompt-lab/config.py
  prompt-lab/context_telemetry.py
  prompt-lab/span_screen.py
  prompt-lab/execution_policy.py
  prompt-lab/fleet_report.py
  prompt-lab/fleet_verdict.py
  prompt-lab/gauntlet_report.py
  prompt-lab/harness_roi.py
  prompt-lab/jnoise/extract_moments.py
  prompt-lab/jnoise/score_moments.py
  prompt-lab/judge.py
  prompt-lab/propose.py
  prompt-lab/propose_screen.py
  prompt-lab/rft_harvest.py
  prompt-lab/sql_eval.py
  prompt-lab/trajectory_check.py
)
for script in "${selftests[@]}"; do python3 "$OPT/$script" --selftest; done
python3 -m unittest "$OPT/prompt-lab/test_span_screen.py"
python3 "$OPT/prompt-lab/integrity_selftest.py"
python3 "$OPT/prompt-lab/seatbelt_network_selftest.py"

node --test "$OPT"/pi-test/test/*.test.js
dry_output="$(cd "$OPT" && ./real_gate.sh --dry)"
printf '%s\n' "$dry_output"
grep -q 'execution: network=endpoint model_control=llama' <<< "$dry_output"

echo "optimizer verification: PASS"
