#!/usr/bin/env bash
# fleet_round.sh — run a gate sweep across the model ZOO (llama-swap router),
# batched per model (never interleave: swaps cost a reload). Two modes:
#
#   Calibrate the fleet:   MODELS="m1 m2" TASKS="parens equil" N=4 ./fleet_round.sh calibrate
#   A/B a candidate:       MODELS="m1 m2" TASKS="parens" N=8 CAND=cfg.json ./fleet_round.sh ab
#
# Rows land in prompt-lab/results/$GEN.jsonl with the model column carrying the
# router id (real_gate labels rows from PI_MODEL). Analysis: per-model Fisher +
# cross-model sign test — generality over depth.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MODE="${1:?mode: calibrate | ab}"
GEN="${GEN:-fleet0}"
N="${N:-4}"
MODELS="${MODELS:?space-separated router model ids}"
TASKS="${TASKS:-parens equil bigdata}"
LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8080}"
CAND="${CAND:-}"

[[ "$MODE" == "ab" && -z "$CAND" ]] && { echo "ab mode needs CAND=<config.json>" >&2; exit 1; }

# Die WITH the children: a killed driver must not orphan its real_gate (which
# would keep spawning sessions nothing collects — seen live, fleet sweep 07-13).
trap 'pkill -P $$ 2>/dev/null; exit 130' INT TERM

for model in $MODELS; do
	echo "=== fleet: $model ($MODE) ==="
	# one warm-up completion so the swap cost lands outside the first session
	curl -fsS -m 180 ${LLAMA_API_KEY:+-H "Authorization: Bearer $LLAMA_API_KEY"} \
		-H 'Content-Type: application/json' "$LLAMA_URL/v1/chat/completions" \
		-d "{\"model\":\"$model\",\"messages\":[{\"role\":\"user\",\"content\":\"warm\"}],\"max_tokens\":2}" >/dev/null 2>&1
	if [[ "$MODE" == "calibrate" ]]; then
		GEN="$GEN" N="$N" LLAMA_URL="$LLAMA_URL" PI_MODEL="$model" HEALTH_WAIT="${HEALTH_WAIT:-3600}" \
			"$HERE/real_gate.sh" --calibrate $TASKS || { echo "[fleet] $model block failed — continuing with next model" >&2; }
	else
		GEN="$GEN" N="$N" LLAMA_URL="$LLAMA_URL" PI_MODEL="$model" HEALTH_WAIT="${HEALTH_WAIT:-3600}" \
			CAND="$CAND" "$HERE/real_gate.sh" $TASKS || { echo "[fleet] $model block failed — continuing with next model" >&2; }
	fi
done
echo "fleet rows -> $HERE/prompt-lab/results/$GEN.jsonl"
