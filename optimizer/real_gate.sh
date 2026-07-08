#!/usr/bin/env bash
# real_gate.sh — the FUEL: a config-driven AGENTIC gate. Does a candidate config
# actually make the model write passing code? Applies a config (project prompt + env)
# and runs the real coding tasks headless, N reps each, scoring gate-pass (node --test
# + task checks). Emits fleet_report-compatible rows {model, pattern, task, rep, score,
# split, out_chars} so the SAME significance/do-no-harm rule decides adoption.
#
#   GEN=rg0 BASE=configs/baseline.json CAND=configs/cand-cot.json N=3 ./real_gate.sh [t1..t4]
#   ./real_gate.sh --dry
#
# Server must already be up (one model; auto-detected via /v1/models). Focused on the
# DAILY DRIVER (DD) — bring it up, run this. Honors live knobs (prompt, scaffold,
# LB_*/VERIFY_GATE_* env); decoding/optillm need a relaunch/proxy (Phase 3).
# Robust: health-checks before each task (fails fast if the server died mid-run) and
# traps INT/TERM to kill the in-flight pi child, so Ctrl-C actually stops it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GEN="${GEN:-rg0}"; N="${N:-3}"
DD="${DD:-}"; PI_TIMEOUT="${PI_TIMEOUT:-1800}"
PI_MODEL="${PI_MODEL:-}"   # pi model id for the sessions (else pi uses its default — beware external defaults)
BASE="${BASE:-$HERE/prompt-lab/configs/baseline.json}"
CAND="${CAND:-$HERE/prompt-lab/configs/cand-cot.json}"
FIXTURE="${FIXTURE:-$HERE/pi-test}"; TASKS_DIR="$HERE/ab-symbolect/tasks"; T3_FILES="$HERE/ab-symbolect/t3-files"
FIXTURES="$HERE/real-gate-fixtures"
CONFIG="$HERE/prompt-lab/config.py"; METRICS="$HERE/ab-machinery/metrics.py"
RESULTS="$HERE/prompt-lab/results/$GEN.jsonl"
RUNS="${RUNS:-$HERE/real-gate-runs}"

DRY=0; HARD=0; CALIB=0; TASKS=()
for a in "$@"; do
	case "$a" in
		--dry) DRY=1 ;;
		--hard) HARD=1 ;;        # the hidden-test, harder tasks
		--calibrate) CALIB=1 ;;  # base config only (measure per-task difficulty; halves cost)
		*) TASKS+=("$a") ;;
	esac
done
if [[ ${#TASKS[@]} -eq 0 ]]; then
	if [[ "$HARD" == 1 ]]; then
		# every hidden task is one $FIXTURES/hidden/<id>.test.js — derive the list, no hardcoding
		TASKS=(); for f in "$FIXTURES"/hidden/*.test.js; do [[ -e "$f" ]] && TASKS+=("$(basename "$f" .test.js)"); done
	else
		TASKS=(t1 t2 t3 t4 t5 t6)
	fi
fi

# A HIDDEN-test task (SWE-bench style): the model gets a prose spec only and never sees the
# grading test; the fixture's own test/ is the visible Pass-to-Pass set, and the hidden
# Fail-to-Pass test is installed only at grading. Data-driven: a task is hidden iff it has a
# hidden grader, and uses its own fixture dir $FIXTURES/<id>/ if one exists (else the default).
is_hidden() { [[ -f "$FIXTURES/hidden/$1.test.js" ]]; }
fixture_for() { case "$1" in h3) echo "$FIXTURES/hard-bracket" ;; *) [[ -d "$FIXTURES/$1" ]] && echo "$FIXTURES/$1" || echo "$FIXTURE" ;; esac; }

# Shown-test tasks: (re)install the authoritative test — before the run (model sees the
# spec) AND after (anti-tamper). Hidden tasks are handled separately at grading time.
install_tests() {  # $1=task $2=workdir
	case "$1" in
		t3) cp "$T3_FILES/align.test.js" "$2/test/" ;;
		t5) cp "$FIXTURES/toCSV.test.js" "$2/test/" ;;
		t6) cp "$FIXTURES/quoting.test.js" "$2/test/" ;;
	esac
}

LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8080}"   # point at a remote llama-server (e.g. http://192.168.1.50:8080)
HEALTH_WAIT="${HEALTH_WAIT:-1800}"                # max seconds to wait out a mid-sweep server outage (e.g. OOM restart)
health() { curl -fsS -m 5 "$LLAMA_URL/health" >/dev/null 2>&1; }

# Seatbelt write-jail for the headless pi sessions (r/PiCodingAgent agent-lock pattern,
# macOS-native): kernel-denies writes outside {workdir, tmp, ~/.pi}. Reads/exec/network
# untouched. SANDBOX=off to disable; auto-off when not on macOS / sandbox-exec missing.
SANDBOX="${SANDBOX:-on}"
GATE_SB="$HERE/real-gate-fixtures/gate.sb"
if [[ "$SANDBOX" == "on" ]] && { [[ "$(uname)" != "Darwin" ]] || ! command -v sandbox-exec >/dev/null 2>&1 || [[ ! -f "$GATE_SB" ]]; }; then
	SANDBOX=off
fi
loaded_alias() { curl -fsS -m 5 "$LLAMA_URL/v1/models" 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d[0]["id"] if d else "")' 2>/dev/null; }

if [[ "$DRY" == 1 ]]; then
	echo "== real_gate DRY ==  GEN=$GEN  N=$N  base=$(basename "$BASE")  cand=$(basename "$CAND")"
	echo "server: $(health && loaded_alias || echo DOWN)"
	cfgs="[base, cand]"; nextcmd="./prompt-lab/fleet_report.py $GEN --baseline base --candidate cand"
	[[ "$CALIB" == 1 ]] && cfgs="[base only]" && nextcmd="./prompt-lab/calibrate.py $GEN"
	echo "would run, per config in $cfgs:  ${TASKS[*]}  x ${N} reps  -> gate-pass rows -> $RESULTS"
	echo "then: $nextcmd"
	exit 0
fi

CHILD=""
cleanup() {
	[[ -n "$CHILD" ]] && kill "$CHILD" 2>/dev/null
	pkill -P $$ 2>/dev/null
	pkill -f "timeout $PI_TIMEOUT pi -p --approve" 2>/dev/null
}
trap 'echo "[real_gate] interrupted — tearing down in-flight pi" >&2; cleanup; exit 130' INT TERM

health || { echo "no server on :8080" >&2; exit 1; }
MODEL="$(loaded_alias)"; [[ -n "$MODEL" ]] || MODEL=unknown
MODEL="$(basename "$MODEL" .gguf)"; MODEL="${MODEL//[^a-zA-Z0-9._-]/-}"  # alias-less servers report the gguf path
[[ -n "$DD" && "$MODEL" != "$DD" ]] && echo "[real_gate] WARNING: loaded model '$MODEL' != expected '$DD'" >&2
mkdir -p "$RUNS"
echo "== real_gate: model=$MODEL  N=$N  tasks=${TASKS[*]} =="

run_one() {  # $1=config-path  $2=pattern(base|cand)  $3=task  $4=rep
	local cfg="$1" pat="$2" task="$3" rep="$4"
	local wd="$RUNS/$GEN-$MODEL-$pat-$task-$rep"
	local fix; fix="$(fixture_for "$task")"
	rm -rf "$wd"; mkdir -p "$wd"
	cp -R "$fix/src" "$fix/test" "$fix/package.json" "$wd/"
	[[ "$task" == "t3" ]] && cp "$T3_FILES/align.js" "$wd/src/"   # the buggy source to fix (before only)
	is_hidden "$task" || install_tests "$task" "$wd"             # shown tasks only; hidden tasks withhold the test

	# server died mid-sweep (e.g. OOM): wait for it to come back (server side should
	# auto-restart) instead of killing a multi-hour sweep; abort only past HEALTH_WAIT.
	local waited=0
	while ! health; do
		[[ "$waited" -eq 0 ]] && echo "[real_gate] $LLAMA_URL down before $pat/$task — waiting up to ${HEALTH_WAIT}s for recovery" >&2
		[[ "$waited" -ge "$HEALTH_WAIT" ]] && { echo "[real_gate] server still down after ${waited}s — aborting" >&2; exit 1; }
		sleep 30; waited=$((waited + 30))
	done
	[[ "$waited" -gt 0 ]] && echo "[real_gate] server back after ~${waited}s — resuming" >&2

	# apply the config: writes $wd/.pi/APPEND_SYSTEM.md, returns env lines
	local envlines; envlines="$(python3 "$CONFIG" --apply "$cfg" --workdir "$wd")"
	local tools="read,edit,bash"; [[ "$task" == "t4" ]] && tools="read,edit,bash,subagent"

	# jail: render the per-run Seatbelt profile (absolute paths; Seatbelt has no env)
	local sbx=()
	if [[ "$SANDBOX" == "on" ]]; then
		sed -e "s|__WORKDIR__|$wd|" -e "s|__PI_STATE__|$HOME/.pi|" "$GATE_SB" > "$wd/.gate.sb"
		sbx=(sandbox-exec -f "$wd/.gate.sb")
	fi

	# run pi in the background + wait, so the INT trap can kill it instantly
	( cd "$wd"
	  while IFS= read -r line; do [[ "$line" == *=* && "$line" != ENDPOINT=* && "$line" != LABEL=* ]] && export "${line?}"; done <<< "$envlines"
	  ${sbx[@]+"${sbx[@]}"} timeout "$PI_TIMEOUT" pi -p --approve ${PI_MODEL:+--model "$PI_MODEL"} --tools "$tools" "$(cat "$TASKS_DIR/$task.txt")" ) > "$wd/run.log" 2>&1 &
	CHILD=$!; wait "$CHILD" || true; CHILD=""

	# grading: restore authoritative tests so the model can't have tampered with them
	if is_hidden "$task"; then
		rm -f "$wd"/test/*.test.js                       # drop any model-added/edited tests
		cp "$fix"/test/*.test.js "$wd/test/"             # pristine Pass-to-Pass set
		cp "$FIXTURES/hidden/$task.test.js" "$wd/test/"  # the HIDDEN Fail-to-Pass grader
	else
		install_tests "$task" "$wd"                      # shown-test anti-tamper
	fi
	local gate=1
	( cd "$wd" && node --test ) > "$wd/gate.log" 2>&1 || gate=0
	[[ "$task" == "t1" ]] && grep -rq "parseCSV" "$wd/src" "$wd/test" && gate=0
	[[ "$task" == "t4" ]] && ! grep -rq "trim" "$wd/test" && gate=0
	local tout; tout="$(python3 "$METRICS" "$wd" | cut -f7)"; [[ -n "$tout" ]] || tout=0

	python3 - "$RESULTS" "$MODEL" "$pat" "$task" "$rep" "$gate" "$tout" <<'PY'
import json,sys
out,model,pat,task,rep,gate,tout=sys.argv[1:8]
rec={"task":task,"pattern":pat,"rep":int(rep),"model":model,"split":"val",
     "score":int(gate),"out_chars":int(tout),"think_chars":0}
open(out,"a").write(json.dumps(rec)+"\n")
PY
	echo "  $pat/$task rep$rep -> gate=$gate (out_tok=$tout)"
}

SPECS=("base:$BASE" "cand:$CAND"); [[ "$CALIB" == 1 ]] && SPECS=("base:$BASE")
for spec in "${SPECS[@]}"; do
	pat="${spec%%:*}"; cfg="${spec#*:}"
	for task in "${TASKS[@]}"; do
		for rep in $(seq 1 "$N"); do run_one "$cfg" "$pat" "$task" "$rep"; done
	done
done

echo; echo "rows -> $RESULTS"
if [[ "$CALIB" == 1 ]]; then
	echo "calibrate: ./prompt-lab/calibrate.py $GEN   (keep tasks in the 20-85% band for this model)"
else
	echo "analyze: ./prompt-lab/fleet_report.py $GEN --baseline base --candidate cand"
fi
