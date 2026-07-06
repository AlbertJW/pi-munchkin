#!/usr/bin/env bash
# Fleet sweep: run the prompt-surface eval across a fleet of local models, one at a
# time on :8080 (they share the port — see run-*.sh). Each model is launched, the
# eval auto-tags results by the loaded alias, then the server is stopped. Combined
# results land in one results/<GEN>.jsonl; analyze with fleet_report.py.
#
#   GEN=fleet0 ./fleet-eval.sh [model1 model2 ...]      # default fleet below
#   ./fleet-eval.sh --dry                               # print the plan, do nothing
#   ./fleet-eval.sh --no-launch                         # eval whatever server is up (1 model)
#   VARIANTS=A,F GEN=fleet0 ./fleet-eval.sh
#
# Each sweep is N sequential model loads — heavy, uses your GPU. Reuses run-<alias>.sh
# + stop-llama.sh. A model with no run-<alias>.sh is skipped with a warning.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="${GEN:-fleet0}"
VARIANTS="${VARIANTS:-A,F}"          # A = live prompts, F = none (governor on vs off)
N="${N:-4}"                          # promptlab reps per cell
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-300}"

DEFAULT_FLEET=(qwen36-35b-iq3s mellum2-12b-thinking)
BASE="${BASE:-$HERE/prompt-lab/configs/baseline.json}"
CAND="${CAND:-$HERE/prompt-lab/configs/cand-cot.json}"
DRY=0; NOLAUNCH=0; RT=0; RG=0; FLEET=()
for a in "$@"; do
	case "$a" in
		--dry) DRY=1 ;;
		--no-launch) NOLAUNCH=1 ;;
		--rt) RT=1 ;;   # register-tint candidate (A vs R on role tasks) instead of the baseline suite
		--real-gate) RG=1 ;;   # agentic gate: base vs cand config on real coding tasks (the FUEL)
		*) FLEET+=("$a") ;;
	esac
done
[[ ${#FLEET[@]} -eq 0 ]] && FLEET=("${DEFAULT_FLEET[@]}")

LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8080}"
health() { curl -fsS -m 5 "$LLAMA_URL/health" >/dev/null 2>&1; }
loaded_alias() { curl -fsS -m 5 "$LLAMA_URL/v1/models" 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d[0]["id"] if d else "")' 2>/dev/null; }

# Default suite = two surfaces: SQL (deterministic capability probe) + promptlab
# governor/role tasks (the real governor signal). --rt instead runs the register-tint
# candidate (pattern A vs R) on the role tasks only — the emoji-glyph experiment.
if [[ "$RG" == 1 ]]; then
	EVAL_DESC="real_gate ${GEN}-rg: base($(basename "$BASE")) vs cand($(basename "$CAND")) on agentic tasks, n=$N"
elif [[ "$RT" == 1 ]]; then
	EVAL_DESC="promptlab ${GEN}-rt register-tint A vs R (role tasks, n=$N)"
else
	EVAL_DESC="sql_eval ${GEN}-sql + promptlab ${GEN}-gov (variants $VARIANTS, n=$N)"
fi
run_evals() {
	if [[ "$RG" == 1 ]]; then
		GEN="${GEN}-rg" BASE="$BASE" CAND="$CAND" N="$N" bash "$HERE/real_gate.sh"
	elif [[ "$RT" == 1 ]]; then
		( cd "$HERE/prompt-lab" && python3 ./promptlab.py "${GEN}-rt" --patterns A,R \
			--tasks explorer_contract,verifier_verdict --n "$N" )
	else
		( cd "$HERE/prompt-lab" \
			&& python3 ./sql_eval.py "${GEN}-sql" --variants "$VARIANTS" \
			&& python3 ./promptlab.py "${GEN}-gov" --patterns "$VARIANTS" --n "$N" )
	fi
}
analyze_hint() {
	if [[ "$RG" == 1 ]]; then
		echo "analyze (does the candidate config write better code? -> baseline base, candidate cand):"
		echo "  ./prompt-lab/fleet_report.py ${GEN}-rg --baseline base --candidate cand"
	elif [[ "$RT" == 1 ]]; then
		echo "analyze (does the register tint help the roles? -> baseline A, candidate R):"
		echo "  ./prompt-lab/fleet_report.py ${GEN}-rt --baseline A --candidate R"
	else
		echo "analyze (does the governor help? -> baseline F, candidate A):"
		echo "  ./prompt-lab/fleet_report.py ${GEN}-sql --baseline F --candidate A"
		echo "  ./prompt-lab/fleet_report.py ${GEN}-gov --baseline F --candidate A"
	fi
}

if [[ "$DRY" == 1 ]]; then
	echo "== fleet-eval DRY ==  GEN=$GEN  VARIANTS=$VARIANTS  RT=$RT"
	echo "server on :8080: $(health && loaded_alias || echo DOWN)"
	for m in "${FLEET[@]}"; do
		if [[ -x "$HERE/run-$m.sh" || -f "$HERE/run-$m.sh" ]]; then
			echo "  would: launch run-$m.sh -> wait /health -> $EVAL_DESC -> stop"
		else
			echo "  SKIP $m (no run-$m.sh yet — wire it, then re-run)"
		fi
	done
	analyze_hint
	echo "(each model is a sequential load on :8080 — heavy, your GPU.)"
	exit 0
fi

if [[ "$NOLAUNCH" == 1 ]]; then
	health || { echo "no server on :8080 (and --no-launch given)" >&2; exit 1; }
	echo "== --no-launch: evaluating loaded model '$(loaded_alias)' =="
	run_evals
	echo; analyze_hint
	exit 0
fi

for m in "${FLEET[@]}"; do
	launcher="$HERE/run-$m.sh"
	[[ -f "$launcher" ]] || { echo "SKIP $m: no $launcher" >&2; continue; }
	echo "== $m: launching =="
	bash "$HERE/stop-llama.sh" >/dev/null 2>&1 || true
	( bash "$launcher" >"$HERE/.fleet-$m.log" 2>&1 ) &
	waited=0
	until health; do
		sleep 3; waited=$((waited+3))
		if [[ $waited -ge $HEALTH_TIMEOUT ]]; then echo "  $m: server not healthy after ${HEALTH_TIMEOUT}s — skipping" >&2; break; fi
	done
	if health; then
		echo "  $m: up as '$(loaded_alias)' — running eval"
		run_evals
	fi
	bash "$HERE/stop-llama.sh" >/dev/null 2>&1 || true
	sleep 2
done

echo; echo "sweep done -> results/${GEN}-sql.jsonl + results/${GEN}-gov.jsonl"
analyze_hint
