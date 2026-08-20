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
  prompt-lab/admission_rule.py
  prompt-lab/calibrate.py
  prompt-lab/canary.py
  prompt-lab/config.py
  prompt-lab/context_telemetry.py
  prompt-lab/effort_report.py
  prompt-lab/exposure.py
  prompt-lab/usage_probe.py
  prompt-lab/agent_overlay.py
  prompt-lab/agentic_judge.py
  prompt-lab/shadow_report.py
  prompt-lab/span_screen.py
  prompt-lab/execution_policy.py
  prompt-lab/fleet_report.py
  prompt-lab/fleet_verdict.py
  prompt-lab/grade_reporter.py
  prompt-lab/trial_validity.py
  prompt-lab/judge_render.py
  prompt-lab/failure_episode_trial.py
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
# Completeness guard for the hand-maintained list above: any optimizer .py that
# advertises --selftest must be registered here or named in the exclusion list
# with a reason. effort_report.py sat unregistered for weeks — its selftest had
# never once run under npm run verify (2026-07-30 triage #3/#17); a list a
# human maintains needs a check a human cannot forget.
python3 - "$OPT" "${selftests[@]}" <<'PY'
import pathlib, sys
root = pathlib.Path(sys.argv[1]); registered = set(sys.argv[2:])
# Excluded with reasons: run by other verify steps or not selftest-shaped.
excluded = {
    "prompt-lab/integrity_selftest.py",   # run directly below, no --selftest flag
    "prompt-lab/seatbelt_network_selftest.py",  # run directly below
    "prompt-lab/fixture_admission.py",    # verify subcommand exercised by integrity_selftest
}
missing = []
for path in sorted(root.rglob("*.py")):
    rel = str(path.relative_to(root))
    if rel in registered or rel in excluded or "__pycache__" in rel:
        continue
    text = path.read_text(errors="replace")
    if "--selftest" in text and "def selftest" in text:
        missing.append(rel)
if missing:
    sys.exit("selftests exist but are not registered in verify-optimizer.sh:\n  " + "\n  ".join(missing))
print(f"selftest registry complete: {len(registered)} registered, {len(excluded)} excluded with reasons")
PY
for script in "${selftests[@]}"; do python3 "$OPT/$script" --selftest; done
python3 -m unittest "$OPT/prompt-lab/test_span_screen.py"
python3 -m unittest "$OPT/prompt-lab/test_batch_screen.py"
python3 "$OPT/prompt-lab/integrity_selftest.py"
python3 "$OPT/prompt-lab/seatbelt_network_selftest.py"
python3 "$OPT/prompt-lab/grade_jail_selftest.py"

node --test "$OPT"/pi-test/test/*.test.js
dry_output="$(cd "$OPT" && ./real_gate.sh --dry)"
printf '%s\n' "$dry_output"
grep -q 'execution: network=endpoint model_control=llama' <<< "$dry_output"

echo "optimizer verification: PASS"
