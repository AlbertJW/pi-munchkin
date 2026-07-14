#!/usr/bin/env bash
# gauntlet.sh — the agent-failure gauntlet: inject exactly ONE deterministic fault
# into an otherwise-solvable task and measure recovery, per model. The permanent
# regression suite for the harness's failure-handling (loop-breaker, verify-gate,
# editing protocol, retry policy) — models that look competent on clean tasks
# routinely collapse on tool-protocol and recovery failures.
#
#   MODELS=qwopus35-4b-mtp,qwen35-2b-opus-reasoning LLAMA_URL=http://... ./gauntlet.sh
#   GEN_PREFIX=gt2 FAULTS_ONLY=lying,ghost ./gauntlet.sh     # subset re-run
#
# Chaos faults ride the dormant ~/.pi/agent/extensions/chaos.ts (CHAOS env, one-shot
# block on the nth call of a tool). Deception faults are fixture-injected (lying:
# npm test exits 0 while printing FAILs; ghost: instructions point at a file that
# doesn't exist). One row per (model, fault): results/<GEN_PREFIX>-<model>-<fault>.jsonl.
# Analyze with:  ./prompt-lab/gauntlet_report.py <GEN_PREFIX>
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

MODELS="${MODELS:?comma-separated PI_MODEL ids}"
GEN_PREFIX="${GEN_PREFIX:-gt1}"
N="${N:-1}"
PI_TIMEOUT="${PI_TIMEOUT:-900}"

# fault|task|CHAOS-spec ("" = no injection). GTASK must be a task the model BOTH
# passes clean AND solves through the faulted tools — gt1 baseline lesson: on t1
# the 4B renamed via bash/sed and never called edit, so edit-anchored faults never
# fired (INVALID rows), and t1's control failed for both models. equil is the
# fleet's edit-rich in-band task (4B 5/6 clean, 9 edit calls/session; the 2B's
# only in-band task). Interpret recovery ONLY relative to the control row.
GTASK="${GTASK:-equil}"
FAULT_TABLE=(
	"control|$GTASK|"
	"perm-denied|$GTASK|edit:1:perm-denied"
	"stale-tag|$GTASK|edit:1:stale-tag"
	"missing-file|$GTASK|read:1:missing-file"
	"disconnect|$GTASK|bash:1:disconnect"
	"edit-noop|$GTASK|edit:1:edit-noop"
	"lying|lying|"
	"ghost|ghost|"
)

trap 'pkill -P $$ 2>/dev/null; exit 130' INT TERM

for model in ${MODELS//,/ }; do
	echo "== gauntlet: $model =="
	for rowspec in "${FAULT_TABLE[@]}"; do
		IFS='|' read -r fault task chaos <<< "$rowspec"
		if [[ -n "${FAULTS_ONLY:-}" && ",$FAULTS_ONLY," != *",$fault,"* ]]; then continue; fi
		gen="$GEN_PREFIX-$model-$fault"
		echo "-- $fault (task=$task chaos=${chaos:-none}) -> $gen"
		CHAOS="$chaos" GEN="$gen" N="$N" PI_MODEL="$model" PI_TIMEOUT="$PI_TIMEOUT" \
			bash "$HERE/real_gate.sh" --calibrate "$task" || {
			echo "[gauntlet] $gen aborted (harness-level) — row skipped, continuing" >&2
		}
	done
done

echo; echo "analyze: ./prompt-lab/gauntlet_report.py $GEN_PREFIX"
