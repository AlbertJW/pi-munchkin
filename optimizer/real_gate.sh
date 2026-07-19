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
# MODEL_CONTROL=llama expects an already-running OpenAI-compatible server;
# MODEL_CONTROL=pi-native delegates transport to Pi's provider registry. The default
# GATE_NETWORK=open restores cloud/network access but produces exploratory rows.
# Endpoint-restricted loopback runs can remain authoritative. Traps INT/TERM kill the
# in-flight Pi process group so Ctrl-C also cleans up tool grandchildren.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || dirname "$HERE")"
GEN="${GEN:-rg0}"; N="${N:-3}"
DD="${DD:-qwen36-35b-iq3s}"; PI_TIMEOUT="${PI_TIMEOUT:-1800}"
PI_MODEL="${PI_MODEL:-}"   # pi model id for the sessions (else pi uses its default — beware external defaults)
PI_PROVIDER="${PI_PROVIDER:-}"
GATE_NETWORK="${GATE_NETWORK:-open}"       # open (exploratory) | endpoint (loopback can be authoritative)
MODEL_CONTROL="${MODEL_CONTROL:-llama}"    # llama | pi-native
BASE="${BASE:-$HERE/prompt-lab/configs/baseline.json}"
CAND="${CAND:-$HERE/prompt-lab/configs/cand-cot.json}"
FIXTURE="${PI_TEST_FIXTURE:-$HERE/pi-test}"; T3_FILES="$HERE/ab-symbolect/t3-files"
FIXTURES="$HERE/real-gate-fixtures"
CONFIG="$HERE/prompt-lab/config.py"; METRICS="$HERE/ab-machinery/metrics.py"
FIXTURE_META="$HERE/prompt-lab/eval_fixture.py"; FINGERPRINT="$HERE/prompt-lab/serving_fingerprint.py"
EXEC_POLICY="$HERE/prompt-lab/execution_policy.py"
RESULTS="$HERE/prompt-lab/results/$GEN.jsonl"
RUNS="${REAL_GATE_RUNS:-$HOME/.pi/real-gate-runs}"

DRY=0; HARD=0; CALIB=0; ROBUSTNESS=0; EXPLORATORY=0; TASKS=()
for a in "$@"; do
	case "$a" in
		--dry) DRY=1 ;;
		--hard) HARD=1 ;;        # the hidden-test, harder tasks
		--calibrate) CALIB=1 ;;  # base config only (measure per-task difficulty; halves cost)
		--robustness) ROBUSTNESS=1 ;; # canonical + 3 equivalent prompts and one-shot controls
		--exploratory) EXPLORATORY=1 ;; # permit unapproved/expired/drifted fixtures; rows cannot affect verdicts
		*) TASKS+=("$a") ;;
	esac
done
# Dry-run validates wiring only and emits no evaluation row, so fixture approval
# cannot affect authority. Treat it as exploratory to keep the documented
# offline smoke command usable in a fresh clone.
[[ "$DRY" == 1 ]] && EXPLORATORY=1
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
case "$GATE_NETWORK" in open|endpoint) ;; *) echo "[real_gate] invalid GATE_NETWORK=$GATE_NETWORK (open|endpoint)" >&2; exit 2 ;; esac
case "$MODEL_CONTROL" in llama|pi-native) ;; *) echo "[real_gate] invalid MODEL_CONTROL=$MODEL_CONTROL (llama|pi-native)" >&2; exit 2 ;; esac
if [[ "$MODEL_CONTROL" == "pi-native" && -z "$PI_MODEL" ]]; then
	echo "[real_gate] MODEL_CONTROL=pi-native requires PI_MODEL (provider-qualified is recommended)" >&2
	exit 2
fi
if [[ "$MODEL_CONTROL" == "pi-native" && "$GATE_NETWORK" != "open" ]]; then
	echo "[real_gate] MODEL_CONTROL=pi-native requires GATE_NETWORK=open; provider traffic cannot use the llama endpoint jail" >&2
	exit 2
fi

MODEL_IP="managed"; MODEL_PORT="0"; MODEL_HOST="*"
if [[ "$MODEL_CONTROL" == "llama" ]]; then
	MODEL_ENDPOINT="$(python3 - "$LLAMA_URL" <<'PY'
import socket,sys,urllib.parse
u=urllib.parse.urlparse(sys.argv[1])
if not u.hostname: raise SystemExit("LLAMA_URL has no host")
print(socket.getaddrinfo(u.hostname, None, type=socket.SOCK_STREAM)[0][4][0], u.port or (443 if u.scheme == 'https' else 80))
PY
	)" || { echo "[real_gate] cannot resolve LLAMA_URL=$LLAMA_URL" >&2; exit 2; }
	read -r MODEL_IP MODEL_PORT <<< "$MODEL_ENDPOINT"
	# Seatbelt recognizes localhost but not a raw remote IP in this predicate.
	case "$MODEL_IP" in 127.*|::1|0.0.0.0) MODEL_HOST="localhost" ;; *) MODEL_HOST="*" ;; esac
fi

# Evaluation rows are fail-closed: absent human approval, expiry, instability,
# or artifact drift excludes a fixture unless the operator explicitly asks for
# exploratory rows (which reports ignore for verdicts).
for task in "${TASKS[@]}" ${HELDOUT:-}; do
	if ! python3 "$FIXTURE_META" state "$task" >/dev/null 2>&1 && [[ "$EXPLORATORY" != 1 ]]; then
		echo "[real_gate] fixture '$task' is non-authoritative; run fixture_admission.py check/review-packet/approve, or use --exploratory" >&2
		exit 2
	fi
done

# Seatbelt write-jail for the headless pi sessions (r/PiCodingAgent agent-lock pattern,
# macOS-native): kernel-denies writes outside {workdir, tmp, ~/.pi} and reads of
# the entire harness repository (including graders and Git objects). SANDBOX=off disables BOTH protections and makes
# hidden-task results invalid; auto-off when macOS sandbox-exec is unavailable.
SANDBOX="${SANDBOX:-on}"
case "$SANDBOX" in on|off) ;; *) echo "[real_gate] invalid SANDBOX=$SANDBOX (on|off)" >&2; exit 2 ;; esac
if [[ "$GATE_NETWORK" == "open" ]]; then
	GATE_SB="$HERE/real-gate-fixtures/gate-open.sb"
else
	GATE_SB="$HERE/real-gate-fixtures/gate.sb"
fi
if [[ "$SANDBOX" == "on" ]] && { [[ "$(uname)" != "Darwin" ]] || ! command -v sandbox-exec >/dev/null 2>&1 || [[ ! -f "$GATE_SB" ]]; }; then
	SANDBOX=off
fi
SANDBOX_AUTHORITATIVE=1
SANDBOX_AUTHORITY_REASON="filesystem read isolation enabled"
if [[ "$SANDBOX" != "on" ]]; then
	SANDBOX_AUTHORITATIVE=0
	SANDBOX_AUTHORITY_REASON="filesystem sandbox unavailable or explicitly disabled"
	echo "[real_gate] ================================================================" >&2
	echo "[real_gate] WARNING: SANDBOX=off; public-task rows are EXPLORATORY ONLY" >&2
	echo "[real_gate] Hidden graders remain blocked because read isolation is absent." >&2
	echo "[real_gate] ================================================================" >&2
fi
# Filesystem isolation is independent of egress authority. Open networking and
# remote endpoint wildcards are permitted, but their rows are exploratory.
if [[ "$SANDBOX" == "on" && "$GATE_NETWORK" == "open" ]]; then
	echo "[real_gate] GATE_NETWORK=open: unrestricted egress enabled; rows are non-authoritative (read-isolation intact)" >&2
elif [[ "$SANDBOX" == "on" && "$MODEL_IP" != "127.0.0.1" && "$MODEL_IP" != "::1" && "$MODEL_IP" != "0.0.0.0" ]]; then
	echo "[real_gate] endpoint mode + remote model $MODEL_IP: wildcard *:$MODEL_PORT; rows are non-authoritative" >&2
fi
# The hidden-test claim is invalid without read isolation. Refuse rather than
# emit benchmark-shaped rows that can inspect graders or recover them from Git.
if [[ "$SANDBOX" != "on" ]]; then
	for task in "${TASKS[@]}" ${HELDOUT:-}; do
		if is_hidden "$task"; then
			echo "[real_gate] hidden task '$task' requires SANDBOX=on with sandbox-exec; refusing an invalid run" >&2
			exit 2
		fi
	done
fi
# Authenticated endpoints (e.g. the box router) need a bearer token; /health is
# open so health() stays keyless. LLAMA_API_KEY empty -> no header (local zoo).
AUTH=(); [[ -n "${LLAMA_API_KEY:-}" ]] && AUTH=(-H "Authorization: Bearer $LLAMA_API_KEY")
loaded_alias() { curl -fsS -m 5 ${AUTH[@]+"${AUTH[@]}"} "$LLAMA_URL/v1/models" 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d[0]["id"] if d else "")' 2>/dev/null; }
ensure_model_loaded() {
	local state
	state="$(curl -fsS -m 5 ${AUTH[@]+"${AUTH[@]}"} "$LLAMA_URL/v1/models" 2>/dev/null | python3 -c 'import json,sys; m=sys.argv[1]; d=json.load(sys.stdin).get("data",[]); print(next((str((x.get("status") or {}).get("value", "")) for x in d if x.get("id")==m), ""))' "$MODEL" 2>/dev/null)"
	[[ "$state" == "loaded" || "$state" == "running" ]] && return 0
	echo "[real_gate] warming $MODEL so the pre-row fingerprint describes the loaded backend" >&2
	curl -fsS --max-time "$HEALTH_WAIT" ${AUTH[@]+"${AUTH[@]}"} "$LLAMA_URL/v1/chat/completions" -H 'Content-Type: application/json' \
		-d "$(python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"messages":[{"role":"user","content":"Reply OK."}],"max_tokens":1,"temperature":0}))' "$MODEL")" >/dev/null
}

if [[ "$DRY" == 1 ]]; then
	echo "== real_gate DRY ==  GEN=$GEN  N=$N  base=$(basename "$BASE")  cand=$(basename "$CAND")"
	echo "execution: network=$GATE_NETWORK model_control=$MODEL_CONTROL provider=${PI_PROVIDER:-auto} model=${PI_MODEL:-auto}"
	if [[ "$MODEL_CONTROL" == "llama" ]]; then
		echo "server: $(health && loaded_alias || echo DOWN)"
	else
		echo "server: pi-native (llama health/warm-up bypassed)"
	fi
	cfgs="[base, cand]"; nextcmd="./prompt-lab/fleet_report.py $GEN --baseline base --candidate cand"
	[[ "$CALIB" == 1 ]] && cfgs="[base only]" && nextcmd="./prompt-lab/calibrate.py $GEN"
	echo "would run, per config in $cfgs:  ${TASKS[*]}  x ${N} reps  -> gate-pass rows -> $RESULTS"
	[[ "$ROBUSTNESS" == 1 ]] && echo "robustness: canonical + 3 equivalent prompts; eligible one-shot arms (one request each)"
	echo "then: $nextcmd"
	exit 0
fi

CHILD=""
LOW_TOK_STREAK=0
# Kill a process AND its descendants. Scoped to OUR tree only — a global
# pkill -f on the pi cmdline pattern killed sibling fleet wings sharing the
# same PI_TIMEOUT (audit 2026-07-13).
kill_tree() {
	local p
	for p in $(pgrep -P "$1" 2>/dev/null); do kill_tree "$p"; done
	kill "$1" 2>/dev/null
}
cleanup() {
	# Group-kill first: a reparented orphan (node grandchild after `timeout` kills
	# pi) keeps its PGID but escapes a parent-based walk, so kill the whole group.
	[[ -n "$CHILD" ]] && { kill -- -"$CHILD" 2>/dev/null; kill_tree "$CHILD"; }
	local p
	for p in $(pgrep -P $$ 2>/dev/null); do kill_tree "$p"; done
}
trap 'echo "[real_gate] interrupted — tearing down in-flight pi" >&2; cleanup; exit 130' INT TERM

if [[ "$MODEL_CONTROL" == "llama" ]]; then
	health || { echo "[real_gate] no llama-compatible server at $LLAMA_URL" >&2; exit 1; }
fi
# Behind a router (llama-swap) /v1/models lists the whole zoo — [0] would mislabel
# every row. PI_MODEL is the requested member; it IS the row label there.
if [[ -n "$PI_MODEL" ]]; then
	MODEL="$PI_MODEL"
else
	MODEL="$(loaded_alias)"; [[ -n "$MODEL" ]] || MODEL=unknown
	MODEL="$(basename "$MODEL" .gguf)"; MODEL="${MODEL//[^a-zA-Z0-9._-]/-}"  # alias-less servers report the gguf path
fi
MODEL_SLUG="${MODEL//[^a-zA-Z0-9._-]/-}"

# Resolve metadata without exposing credentials. Native providers are identified
# from PI_PROVIDER, a provider-qualified PI_MODEL, or the custom models registry.
POLICY_JSON="$(python3 "$EXEC_POLICY" --network-mode "$GATE_NETWORK" --model-control "$MODEL_CONTROL" \
	--model "$MODEL" --provider "$PI_PROVIDER" --llama-url "$LLAMA_URL" --model-ip "$MODEL_IP" \
	--models-path "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/models.json")" || exit 2
policy_field() { python3 -c 'import json,sys; v=json.loads(sys.argv[1])[sys.argv[2]]; print(int(v) if isinstance(v,bool) else v)' "$POLICY_JSON" "$1"; }
MODEL_PROVIDER_RESOLVED="$(policy_field provider)"
ENDPOINT_IDENTITY_SHA256="$(policy_field endpoint_identity_sha256)"
FINGERPRINT_ENDPOINT="$(policy_field fingerprint_endpoint)"
NETWORK_AUTHORITATIVE="$(policy_field network_authoritative)"
NETWORK_AUTHORITY_REASON="$(policy_field authority_reason)"
PI_SELECT=()
[[ -n "$PI_PROVIDER" ]] && PI_SELECT+=(--provider "$PI_PROVIDER")
[[ -n "$PI_MODEL" ]] && PI_SELECT+=(--model "$PI_MODEL")
[[ "$MODEL" != "$DD" ]] && echo "[real_gate] WARNING: loaded model '$MODEL' != daily driver '$DD'" >&2
mkdir -p "$RUNS"
# The narrowed write-jail allows only these two ~/.pi subpaths; creating THEM would
# need a write on ~/.pi/agent (denied), so ensure they exist before any session starts.
mkdir -p "$HOME/.pi/agent/sessions" "$HOME/.pi/agent/telemetry"
# A direct invocation owns its result file and starts clean. Fleet orchestration
# explicitly selects append mode after truncating once at the round boundary.
# This prevents a reused GEN or rerun model from silently contaminating a verdict.
RESULTS_MODE="${RESULTS_MODE:-truncate}"
mkdir -p "$(dirname "$RESULTS")"
case "$RESULTS_MODE" in
	truncate) : > "$RESULTS" ;;
	append) touch "$RESULTS" ;;
	*) echo "[real_gate] invalid RESULTS_MODE=$RESULTS_MODE (truncate|append)" >&2; exit 2 ;;
esac
# Unique run id: workdir basenames feed telemetry sk, so re-running a gen label
# used to aggregate the OLD run's events into the new verdict (audit 2026-07-13).
# The id lands in workdir names (-> sk) and every result row (-> exact joins).
RUNID="${RUNID:-$(python3 -c 'import uuid; print(uuid.uuid4().hex[:6])')}"
echo "== real_gate: model=$MODEL provider=$MODEL_PROVIDER_RESOLVED network=$GATE_NETWORK sandbox=$SANDBOX control=$MODEL_CONTROL N=$N run=$RUNID tasks=${TASKS[*]} =="

# Per-session resource guard. A pi session's model runs REMOTELY, but the tools it
# invokes (node/awk/bash — bigdata literally asks it to write+run node aggregators)
# execute LOCALLY. `timeout` kills pi but its node/bash grandchildren get reparented
# and can keep running + ballooning RAM unattended (seen 2026-07-16: an overnight
# bigdata gate reached 50 GB and forced a restart). Fix: run each session in its OWN
# process group with (a) a memory watchdog that kills the group past a cap and
# (b) a guaranteed group sweep on exit so nothing orphans. PI_MEM_CAP_GB=0 disables.
PI_MEM_CAP_GB="${PI_MEM_CAP_GB:-12}"
TIMEOUT_TOOL="$(command -v timeout 2>/dev/null || command -v gtimeout 2>/dev/null || true)"
run_with_timeout() { # $1=seconds $2=kill grace, remaining args=command
	local limit="$1" grace="$2" pid timer rc; shift 2
	if [[ -n "$TIMEOUT_TOOL" ]]; then
		"$TIMEOUT_TOOL" -k "$grace" "$limit" "$@"
		return $?
	fi
	set +m # keep fallback children in the session process group for watchdog/cleanup
	"$@" & pid=$!
	( sleep "$limit"; kill -TERM "$pid" 2>/dev/null; sleep "$grace"; kill -KILL "$pid" 2>/dev/null ) & timer=$!
	wait "$pid"; rc=$?
	kill "$timer" 2>/dev/null; wait "$timer" 2>/dev/null || true
	return "$rc"
}

# INSTRUMENT PROPERTY — do not move this into prompt-lab/configs/*.json.
# pi-observational-memory void-launches a consolidation AGENT LOOP on agent_start and
# turn_end with no signal and no timeout (consolidation-trigger.ts:99-105,137). It is
# uncancellable and outlives pi: the abandoned request keeps generating on the server.
# Against a single-request-at-a-time endpoint that means the PREVIOUS session's ghost
# holds the slot when the next one opens -> 58/164 r6 sessions died on their first
# request with a 24-byte 429, and the main loop queueing behind one idles out at
# retry.provider.timeoutMs (20m) until PI_TIMEOUT kills it at 30m.
# PASSIVE=1 short-circuits maybeLaunchConsolidation (consolidation-trigger.ts:120).
# It must apply IDENTICALLY to both arms (it is the instrument, not a candidate
# dimension munchkin may flip), hence here and not in a config. Interactive pi keeps OM.
# $1 = prompt, $2 = redirect op (">" fresh session, ">>" retry-append). Sets CHILD.
run_guarded_session() {
	local prompt=$1 redir=${2:->}
	local cap_kb=$(( PI_MEM_CAP_GB * 1024 * 1024 ))
	set -m   # monitor mode: the backgrounded subshell becomes its own process-group leader
	if [[ "$redir" == ">>" ]]; then
		( cd "$wd" || exit
		  run_with_timeout "$PI_TIMEOUT" 30 ${sbx[@]+"${sbx[@]}"} /usr/bin/env -i \
		    "${session_env[@]}" "${session_base_env[@]}" PI_OBSERVATIONAL_MEMORY_PASSIVE=1 \
		    pi -p --approve ${PI_SELECT[@]+"${PI_SELECT[@]}"} --tools "$tools" "$prompt" ) </dev/null >> "$wd/run.log" 2>&1 &
	else
		( cd "$wd" || exit
		  run_with_timeout "$PI_TIMEOUT" 30 ${sbx[@]+"${sbx[@]}"} /usr/bin/env -i \
		    "${session_env[@]}" "${session_base_env[@]}" PI_OBSERVATIONAL_MEMORY_PASSIVE=1 \
		    pi -p --approve ${PI_SELECT[@]+"${PI_SELECT[@]}"} --tools "$tools" "$prompt" ) </dev/null > "$wd/run.log" 2>&1 &
	fi
	CHILD=$!
	set +m
	local watchdog=""
	if (( cap_kb > 0 )); then
		( while kill -0 "$CHILD" 2>/dev/null; do
			local pids rss
			pids=$(pgrep -g "$CHILD" 2>/dev/null | tr '\n' ',')
			pids=${pids%,}
			if [[ -n "$pids" ]]; then
				rss=$(ps -o rss= -p "$pids" 2>/dev/null | awk '{s+=$1} END{print s+0}')
				if (( rss > cap_kb )); then
					echo "[real_gate] MEMORY CAP: session $(basename "$wd") group hit $((rss/1024))MB > ${PI_MEM_CAP_GB}GB — killing" >&2
					kill -KILL -- -"$CHILD" 2>/dev/null
					break
				fi
			fi
			sleep 5
		done ) &
		watchdog=$!
	fi
	wait "$CHILD" 2>/dev/null || true
	kill -- -"$CHILD" 2>/dev/null                 # sweep any orphaned grandchildren in the group
	[[ -n "$watchdog" ]] && { kill "$watchdog" 2>/dev/null; wait "$watchdog" 2>/dev/null || true; }
	CHILD=""
}

run_one() {  # $1=config $2=arm $3=task $4=rep [$5=split] [$6=prompt-variant]
	local cfg="$1" pat="$2" task="$3" rep="$4" split="${5:-val}" variant="${6:-canonical}"
	local variant_slug="${variant//[^a-zA-Z0-9._-]/-}"
	local wd="$RUNS/$GEN-$RUNID-$MODEL_SLUG-$pat-$task-$rep"
	[[ "$variant" != "canonical" ]] && wd="$wd-$variant_slug"
	local fix; fix="$(fixture_for "$task")"
	local rowctx="$wd.row-context.json"
	local context_args=(); [[ "$EXPLORATORY" == 1 ]] && context_args+=(--exploratory)
	python3 "$FIXTURE_META" row-context "$task" --variant "$variant" ${context_args[@]+"${context_args[@]}"} > "$rowctx"
	local task_prompt; task_prompt="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["prompt_text"])' "$rowctx")"
	rm -rf "$wd"; mkdir -p "$wd"
	cp -R "$fix/src" "$fix/test" "$fix/package.json" "$wd/"
	[[ -d "$fix/data" ]] && cp -R "$fix/data" "$wd/"   # data-backed tasks (e.g. bigdata) ship their corpus
	[[ "$task" == "t3" ]] && cp "$T3_FILES/align.js" "$wd/src/"   # the buggy source to fix (before only)
	is_hidden "$task" || install_tests "$task" "$wd"             # shown tasks only; hidden tasks withhold the test

	# server died mid-sweep (e.g. OOM): wait for it to come back (server side should
	# auto-restart) instead of killing a multi-hour sweep; abort only past HEALTH_WAIT.
	local waited=0
	if [[ "$MODEL_CONTROL" == "llama" ]]; then
		while ! health; do
			[[ "$waited" -eq 0 ]] && echo "[real_gate] $LLAMA_URL down before $pat/$task — waiting up to ${HEALTH_WAIT}s for recovery" >&2
			[[ "$waited" -ge "$HEALTH_WAIT" ]] && { echo "[real_gate] server still down after ${waited}s — aborting" >&2; exit 1; }
			sleep 30; waited=$((waited + 30))
		done
		[[ "$waited" -gt 0 ]] && echo "[real_gate] server back after ~${waited}s — resuming" >&2
	fi

	# Apply the config and load its validated NUL-delimited environment. Arrays preserve
	# multiline steering text without eval or line-oriented export injection.
	local envfile="$wd/.config-env" entry
	local session_env=()
	python3 "$CONFIG" --apply "$cfg" --workdir "$wd" --env-null > "$envfile" || exit 2
	while IFS= read -r -d '' entry; do session_env+=("$entry"); done < "$envfile"
	local env_span_tools=""
	for entry in "${session_env[@]}"; do [[ "$entry" == SPAN_TOOLS=* ]] && env_span_tools="${entry#*=}"; done
	env_span_tools="${env_span_tools:-${SPAN_TOOLS:-off}}"
	if [[ "${TRAJECTORY:-off}" == "on" && "$env_span_tools" != "on" ]]; then
		echo "[real_gate] TRAJECTORY=on requires SPAN_TOOLS=on for $pat/$task; refusing argument-only evidence" >&2
		exit 2
	fi
	local tools="read,edit,bash"; [[ "$task" == "t4" ]] && tools="read,edit,bash,subagent"
	[[ "$env_span_tools" == "on" ]] && tools="$tools,search_spans,read_span"
	# Candidate env the PARENT shell must see: the exports below happen inside the pi
	# subshell only, so checking ${RETRY_FRESH} out here read the parent's env and the
	# c18 retry never fired for candidates that enable it (audit 2026-07-13 — the f4
	# c18 arm measured nothing). Parse the values from the validated array instead.
	local env_retry_fresh=""
	for entry in "${session_env[@]}"; do [[ "$entry" == RETRY_FRESH=* ]] && env_retry_fresh="${entry#*=}"; done
	env_retry_fresh="${env_retry_fresh:-${RETRY_FRESH:-off}}"
	local env_retry_mode=""
	for entry in "${session_env[@]}"; do [[ "$entry" == RETRY_MODE=* ]] && env_retry_mode="${entry#*=}"; done
	env_retry_mode="${env_retry_mode:-${RETRY_MODE:-fresh}}"

	# Child tools receive a deliberately minimal environment. Frontier, cloud,
	# SSH-agent, npm, and shell-hook secrets never enter the fully-approved Pi
	# process. Operators may explicitly pass a provider variable by name when a
	# non-default transport requires it; LLAMA_API_KEY is the only automatic
	# credential because the configured llama endpoint may require bearer auth.
	local gate_tmpdir="$wd/.tmp" key value
	mkdir -p "$gate_tmpdir"
	local session_base_env=("HOME=$HOME" "PATH=$PATH" "TMPDIR=$gate_tmpdir")
	for key in LANG LC_ALL SYSTEMROOT WINDIR PI_CODING_AGENT_DIR XDG_CONFIG_HOME; do
		[[ -n "${!key:-}" ]] && session_base_env+=("$key=${!key}")
	done
	if [[ -n "${LLAMA_API_KEY:-}" ]]; then
		session_base_env+=("LLAMA_API_KEY=$LLAMA_API_KEY")
		echo "[real_gate] WARNING: LLAMA_API_KEY is required by the selected endpoint and visible to child tools; rows are exploratory" >&2
		SANDBOX_AUTHORITATIVE=0
		SANDBOX_AUTHORITY_REASON="endpoint credential is present in the approved child environment"
	fi
	local -a passthrough_keys=()
	IFS=',' read -r -a passthrough_keys <<< "${PI_GATE_PASSTHROUGH_ENV:-}"
	for key in "${passthrough_keys[@]}"; do
		[[ -z "$key" ]] && continue
		[[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "[real_gate] invalid PI_GATE_PASSTHROUGH_ENV name: $key" >&2; exit 2; }
		value="${!key-}"; session_base_env+=("$key=$value")
		echo "[real_gate] WARNING: explicitly passing $key into approved child tools; rows are exploratory" >&2
		SANDBOX_AUTHORITATIVE=0
		SANDBOX_AUTHORITY_REASON="operator passed credential/environment variable into child tools"
	done

	# jail: render the per-run Seatbelt profile (absolute paths; Seatbelt has no env)
	local sbx=()
	if [[ "$SANDBOX" == "on" ]]; then
		python3 - "$GATE_SB" "$wd/.gate.sb" "$wd" "$HOME/.pi/agent" "${GATE_MIRROR_DENY:-$REPO_ROOT}" "$REPO_ROOT" "$MODEL_PORT" "$MODEL_HOST" "$gate_tmpdir" "$HOME" <<'PY'
import json,re,sys
src,dst,*values=sys.argv[1:]
tokens=("__WORKDIR__","__PI_AGENT__","__MIRROR__","__HARNESS__","__MODEL_PORT__","__MODEL_HOST__","__TMPDIR__","__HOME__")
text=open(src,encoding="utf-8").read()
escaped={}
for token,value in zip(tokens,values):
    if "\x00" in value or "\n" in value: raise SystemExit(f"unsafe Seatbelt substitution for {token}")
    # Tokens can be either the whole Seatbelt string or a substring such as
    # "__MODEL_HOST__:__MODEL_PORT__".  Insert a JSON-escaped string fragment
    # so both forms remain one valid, injection-safe Seatbelt string.
    escaped[token]=json.dumps(value,ensure_ascii=True)[1:-1]
placeholder=re.compile(r"__[A-Z][A-Z0-9_]*__")
def substitute(match):
    token=match.group(0)
    if token not in escaped:
        raise SystemExit(f"unresolved Seatbelt placeholder(s): {token}")
    return escaped[token]
# One pass over the original template: placeholder-looking text inside a
# replacement value is data and must never be substituted again.
text=placeholder.sub(substitute,text)
open(dst,"w",encoding="utf-8").write(text)
PY
		sbx=(sandbox-exec -f "$wd/.gate.sb")
	fi

	if [[ "$MODEL_CONTROL" == "llama" ]]; then
		ensure_model_loaded || { echo "[real_gate] could not load $MODEL for fingerprinting" >&2; exit 1; }
	fi
	python3 "$FINGERPRINT" capture --endpoint "$FINGERPRINT_ENDPOINT" --model "$MODEL" --output "$wd/fingerprint-pre.json"
	# run pi in the background (own process group + memory watchdog) so the INT trap
	# can kill it instantly and no model-spawned grandchild can orphan/balloon.
	run_guarded_session "$task_prompt" ">"

	# HARNESS error != MODEL failure. If pi never reached the model, scoring this run
	# would record a task result for a measurement that never happened (a no-op scores
	# whatever the pristine fixture scores). Abort loudly; munchkin hard-stops on it.
	if grep -q "Connection error." "$wd/run.log" 2>/dev/null; then
		echo "[real_gate] pi could not reach the model ($pat/$task rep$rep) — aborting, no rows written." >&2
		echo "[real_gate]   check the selected Pi provider/model credentials and network policy" >&2
		exit 1
	fi
	# A rejected request is a SERVING failure, not a model failure. Left unguarded it
	# scores the endpoint's concurrency limit as the model's competence: a 429 session
	# emits ~24 output chars, which trips the low-output check but does NOT abort (only
	# two CONSECUTIVE near-empty sessions do), so the row fell through and was written
	# gate=0 — 58/164 r6 rows were this. Refuse the row instead.
	# Pattern is deliberately the MESSAGE shape, never a bare "429": bigdata aggregates
	# 4000 numeric records and could legitimately print 429, and a false abort kills a
	# good run. Observed live content is exactly: 429 "Too many requests"
	if grep -Eq 'Too many requests|HTTP 429|status[": ]+429|rate.?limit(ed|ing)?\b' "$wd/run.log" 2>/dev/null; then
		echo "[real_gate] model endpoint rejected the request (429/rate-limit) at $pat/$task rep$rep — aborting, no rows written." >&2
		echo "[real_gate]   the endpoint serves one request at a time; check for a concurrent caller" >&2
		echo "[real_gate]   (pi-observational-memory consolidation is the known offender — PASSIVE=1 is set for gate sessions)" >&2
		exit 1
	fi

	# c18 fresh-context retry: an outcome-loop abort means the session poisoned itself
	# (failed-attempt residue anchoring retries — 12-factor "dumb zone"). RETRY_FRESH=on
	# grants ONE fresh session in the SAME workdir (work done persists) with a distilled
	# handoff instead of the raw pile. Fires only where the alternative was certain fail.
	local retried=0
	local telfile="${TELEMETRY_FILE:-$HOME/.pi/agent/telemetry/events.jsonl}"
	if [[ "$env_retry_fresh" == "on" ]] && \
	   grep -Eq "\"sk\":\"$(basename "$wd")\".*\"kind\":\"(outcome-)?abort\"" "$telfile" 2>/dev/null; then
		retried=1
		local retry_prompt
		if [[ "$env_retry_mode" == "locality" ]]; then
			# c18b: Agentless-style constrained handoff — the fresh session gets the
			# task + the ACTUAL failing verification output + an exact verify command
			# and a localize -> one bounded patch -> verify protocol, instead of an
			# open-ended second attempt. Targets the measured perm-denied/ghost
			# failure class (gt2: re-read-then-different-approach never happens
			# unprompted on small models).
			local failout
			failout="$( (cd "$wd" && run_with_timeout 60 5 node --test 2>&1 | tail -20) 2>/dev/null )"
			echo "  $pat/$task rep$rep aborted — RETRY locality second session" >&2
			retry_prompt="$task_prompt

A previous attempt in this workdir was stopped; its partial work is present. Follow this protocol EXACTLY:
1. LOCALIZE: from the failing output below, identify the ONE file and smallest span responsible.
2. REPAIR: make ONE bounded edit to that span.
3. VERIFY: run exactly \`node --test\` and read its output.
Repeat only if verification still fails. Do not restructure anything else.

Most recent failing verification output:
$failout"
		else
			echo "  $pat/$task rep$rep aborted — RETRY_FRESH second session" >&2
			retry_prompt="$task_prompt

NOTE: a previous attempt in this workdir was stopped for repeating the same failing approach. The partial work is present. Inspect the current state first, then take a DIFFERENT approach to whatever kept failing."
		fi
		run_guarded_session "$retry_prompt" ">>"
	fi
	python3 "$FINGERPRINT" capture --endpoint "$FINGERPRINT_ENDPOINT" --model "$MODEL" --output "$wd/fingerprint-post.json"

	# grading: restore authoritative tests so the model can't have tampered with them
	if is_hidden "$task"; then
		rm -f "$wd"/test/*.test.js                       # drop any model-added/edited tests
		cp "$fix"/test/*.test.js "$wd/test/"             # pristine Pass-to-Pass set
		cp "$FIXTURES/hidden/$task.test.js" "$wd/test/"  # the HIDDEN Fail-to-Pass grader
		[[ "$task" == "bigdata" ]] && cp "$fix/data/events.jsonl" "$wd/data/events.jsonl"
	else
		install_tests "$task" "$wd"                      # shown-test anti-tamper
	fi
	local gate=1
	( cd "$wd" && node --test ) > "$wd/gate.log" 2>&1 || gate=0
	[[ "$task" == "t1" ]] && grep -rq "parseCSV" "$wd/src" "$wd/test" && gate=0
	[[ "$task" == "t4" ]] && ! grep -rq "trim" "$wd/test" && gate=0
	# t2's own tests pass on an untouched fixture — node --test alone scores a no-op as
	# success. The F2P grader asserts the behavior the task actually asks for.
	[[ "$task" == "t2" ]] && ! ( cd "$wd" && node "$FIXTURES/t2-check.mjs" ) >/dev/null 2>&1 && gate=0
	# c23 trajectory assertion (grader integrity): a passing END STATE reached by a
	# lucky broken PATH is still a failure (e.g. bigdata answered from a head-peek,
	# never scanning the file). Opt-in for calibration: TRAJECTORY=on ANDs it in;
	# base-off vs base-on delta = the lucky-pass rate. Only ever ADDS strictness.
	[[ "${TRAJECTORY:-off}" == "on" && "$gate" == 1 ]] && ! python3 "$HERE/prompt-lab/trajectory_check.py" "$wd" "$task" && gate=0
	local mrow; mrow="$(python3 "$METRICS" "$wd")"
	local tin tout usage_exact output_chars health_output
	tin="$(cut -f6 <<< "$mrow")"; [[ -n "$tin" ]] || tin=0
	tout="$(cut -f7 <<< "$mrow")"; [[ -n "$tout" ]] || tout=0
	usage_exact="$(cut -f10 <<< "$mrow")"; [[ -n "$usage_exact" ]] || usage_exact=0
	output_chars="$(cut -f11 <<< "$mrow")"; [[ -n "$output_chars" ]] || output_chars=0

	# Degraded-model tripwire: a server can keep serving HTTP while the model behind it
	# is broken (hot-swap/reload) — sessions then return near-zero tokens and the
	# connection-error guard never fires. Two consecutive near-empty sessions = abort.
	health_output="$tout"; [[ "$usage_exact" != 1 ]] && health_output="$output_chars"
	if [[ "$health_output" -lt "${MIN_SESSION_OUTPUT:-100}" ]]; then
		LOW_TOK_STREAK=$((LOW_TOK_STREAK + 1))
		if [[ "$LOW_TOK_STREAK" -ge 2 ]]; then
			echo "[real_gate] $LOW_TOK_STREAK consecutive sessions under ${MIN_SESSION_OUTPUT:-100} output units (exact tokens or character proxy) — model looks degraded, aborting (this row not written)." >&2
			exit 1
		fi
	else
		LOW_TOK_STREAK=0
	fi

	python3 - "$RESULTS" "$MODEL" "$pat" "$task" "$rep" "$gate" "$retried" "$RUNID" "$tin" "$tout" "$output_chars" "$split" "$usage_exact" "${FLEET_EXPECTED_MODELS:-}" "$rowctx" "$wd/fingerprint-pre.json" "$wd/fingerprint-post.json" "$GATE_NETWORK" "$MODEL_CONTROL" "$MODEL_PROVIDER_RESOLVED" "$ENDPOINT_IDENTITY_SHA256" "$NETWORK_AUTHORITATIVE" "$NETWORK_AUTHORITY_REASON" "$SANDBOX_AUTHORITATIVE" "$SANDBOX_AUTHORITY_REASON" "$EXEC_POLICY" <<'PY'
import importlib.util,json,sys
out,model,pat,task,rep,gate,retried,runid,tin,tout,outchars,split,usage_exact,expected_models,ctxpath,prepath,postpath,network_mode,model_control,provider,endpoint_sha,network_auth,network_reason,sandbox_auth,sandbox_reason,policy_path=sys.argv[1:27]
ctx=json.load(open(ctxpath)); pre=json.load(open(prepath)); post=json.load(open(postpath))
stable=pre.get("fingerprint_sha256") == post.get("fingerprint_sha256")
serving_complete=pre.get("status") == post.get("status") == "complete"
execution_authoritative=bool(int(network_auth)) and bool(int(sandbox_auth))
execution_reason=network_reason if bool(int(sandbox_auth)) else f"{network_reason}; {sandbox_reason}"
spec=importlib.util.spec_from_file_location("execution_policy", policy_path); policy=importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
authoritative,status,authority_reason=policy.row_decision(ctx["authoritative"],ctx["authority_reason"],stable,serving_complete,
    execution_authoritative,execution_reason,ctx.get("exploratory_override",False))
exact=bool(int(usage_exact))
usage={"source":"provider" if exact else "char_proxy", "exact":exact,
       "input_tokens":int(tin) if exact else None, "output_tokens":int(tout) if exact else None,
       "output_chars":int(outchars)}
rec={"schema":"pi.eval-row/v2", "task":task,"pattern":pat,"arm":pat,"rep":int(rep),
     "repetition":int(rep),"model":model,"split":split,"score":int(gate),
     "retried":int(retried),"run":runid,"fixture":{"cohort":ctx["cohort"],"version":ctx["version"]},
     "authoritative":authoritative,"status":status,"authority_reason":authority_reason,
     "execution":{"network_mode":network_mode,"model_control":model_control,"provider":provider,
                  "endpoint_identity_sha256":endpoint_sha,"network_authoritative":bool(int(network_auth)),
                  "sandboxed":bool(int(sandbox_auth)),"authoritative":execution_authoritative},
     "prompt":{"variant":ctx["prompt_variant"],"semantic_group":ctx["semantic_group"],"sha256":ctx["prompt_sha256"]},
     "serving":{"pre":pre,"post":post,"stable":stable},"usage":usage,
     # compatibility aliases for historical readers; dimensions stay honest.
     "out_chars":int(outchars),"think_chars":0,"in_tok":int(tin) if exact else 0,
     "out_tok":int(tout) if exact else 0,"token_usage_exact":exact}
if expected_models:
    rec["fleet_expected_models"] = sorted(expected_models.split())
open(out,"a").write(json.dumps(rec)+"\n")
PY
	echo "  $pat/$task rep$rep/$variant -> gate=$gate (out_tok=$tout output_chars=$output_chars)"
}

run_one_shot() { # $1=task $2=rep $3=variant; always diagnostic robustness split
	local task="$1" rep="$2" variant="$3" pat="one-shot" split="robustness"
	local slug="${variant//[^a-zA-Z0-9._-]/-}"
	local wd="$RUNS/$GEN-$RUNID-$MODEL_SLUG-$pat-$task-$rep-$slug"
	rm -rf "$wd"; mkdir -p "$wd"
	local rowctx="$wd/row-context.json" result="$wd/control.json"
	local context_args=(); [[ "$EXPLORATORY" == 1 ]] && context_args+=(--exploratory)
	python3 "$FIXTURE_META" row-context "$task" --variant "$variant" ${context_args[@]+"${context_args[@]}"} > "$rowctx"
	local eligible; eligible="$(python3 -c 'import json,sys; print(int(json.load(open(sys.argv[1]))["one_shot"]["eligible"]))' "$rowctx")"
	[[ "$MODEL_CONTROL" == "pi-native" ]] && eligible=0
	python3 "$FINGERPRINT" capture --endpoint "$FINGERPRINT_ENDPOINT" --model "$MODEL" --output "$wd/fingerprint-pre.json"
	if [[ "$eligible" == 1 ]]; then
		python3 "$HERE/prompt-lab/one_shot_control.py" "$task" --variant "$variant" --endpoint "$FINGERPRINT_ENDPOINT" --model "$MODEL" --output "$result" >/dev/null || true
	else
		python3 - "$result" "$MODEL_CONTROL" <<'PY'
import json,sys
reason="pi-native providers are not supported by the true direct one-shot arm" if sys.argv[2]=="pi-native" else "fixture context exceeds 48 KiB or is explicitly ineligible"
json.dump({"score":0,"requests":0,"error":reason,
           "usage":{"source":"missing","exact":False,"input_tokens":None,"output_tokens":None,"output_chars":0}},open(sys.argv[1],"w"))
PY
	fi
	python3 "$FINGERPRINT" capture --endpoint "$FINGERPRINT_ENDPOINT" --model "$MODEL" --output "$wd/fingerprint-post.json"
	python3 - "$RESULTS" "$MODEL" "$task" "$rep" "$RUNID" "$rowctx" "$result" "$wd/fingerprint-pre.json" "$wd/fingerprint-post.json" "$eligible" "$GATE_NETWORK" "$MODEL_CONTROL" "$MODEL_PROVIDER_RESOLVED" "$ENDPOINT_IDENTITY_SHA256" "$NETWORK_AUTHORITATIVE" "$NETWORK_AUTHORITY_REASON" "$SANDBOX_AUTHORITATIVE" "$SANDBOX_AUTHORITY_REASON" "$EXEC_POLICY" <<'PY'
import importlib.util,json,sys
out,model,task,rep,runid,ctxp,resultp,prep,postp,eligible,network_mode,model_control,provider,endpoint_sha,network_auth,network_reason,sandbox_auth,sandbox_reason,policy_path=sys.argv[1:20]
ctx=json.load(open(ctxp)); result=json.load(open(resultp)); pre=json.load(open(prep)); post=json.load(open(postp))
stable=pre.get("fingerprint_sha256")==post.get("fingerprint_sha256")
complete=pre.get("status")==post.get("status")=="complete"
execution_authoritative=bool(int(network_auth)) and bool(int(sandbox_auth))
execution_reason=network_reason if bool(int(sandbox_auth)) else f"{network_reason}; {sandbox_reason}"
spec=importlib.util.spec_from_file_location("execution_policy", policy_path); policy=importlib.util.module_from_spec(spec); spec.loader.exec_module(policy)
authoritative,status,authority_reason=policy.row_decision(ctx["authoritative"],ctx["authority_reason"],stable,complete,
    execution_authoritative,execution_reason,ctx.get("exploratory_override",False),eligible=="1")
usage=result["usage"]
rec={"schema":"pi.eval-row/v2","task":task,"pattern":"one-shot","arm":"one-shot","rep":int(rep),"repetition":int(rep),
     "model":model,"split":"robustness","score":int(result["score"]),"run":runid,
     "fixture":{"cohort":ctx["cohort"],"version":ctx["version"]},"authoritative":authoritative,"status":status,
     "authority_reason":authority_reason,"prompt":{"variant":ctx["prompt_variant"],"semantic_group":ctx["semantic_group"],"sha256":ctx["prompt_sha256"]},
     "execution":{"network_mode":network_mode,"model_control":model_control,"provider":provider,
                  "endpoint_identity_sha256":endpoint_sha,"network_authoritative":bool(int(network_auth)),
                  "sandboxed":bool(int(sandbox_auth)),"authoritative":execution_authoritative},
     "serving":{"pre":pre,"post":post,"stable":stable},"usage":usage,"control":{"requests":result["requests"],"error":result.get("error")},
     "out_chars":usage["output_chars"],"in_tok":usage["input_tokens"] or 0,"out_tok":usage["output_tokens"] or 0,
     "token_usage_exact":usage["exact"]}
open(out,"a").write(json.dumps(rec)+"\n")
PY
	echo "  one-shot/$task rep$rep/$variant -> recorded"
}

SPECS=("base:$BASE" "cand:$CAND"); [[ "$CALIB" == 1 ]] && SPECS=("base:$BASE")
if [[ ${#SPECS[@]} -eq 1 || "${INTERLEAVE:-on}" == "off" ]]; then
	# single-arm (calibrate/munchkin) or explicit legacy ordering
	for spec in "${SPECS[@]}"; do
		pat="${spec%%:*}"; cfg="${spec#*:}"
		for task in "${TASKS[@]}"; do
			for rep in $(seq 1 "$N"); do run_one "$cfg" "$pat" "$task" "$rep"; done
		done
	done
else
	# Interleaved + counterbalanced (audit: sequential arm blocks confound the
	# comparison with anything drifting over the run — server state, cache,
	# thermal). Both arms run ADJACENTLY per (task, rep) cell, alternating which
	# goes first, so drift hits both arms symmetrically. INTERLEAVE=off restores
	# block order.
	cell=0
	for task in "${TASKS[@]}"; do
		for rep in $(seq 1 "$N"); do
			if (( cell % 2 == 0 )); then order=(0 1); else order=(1 0); fi
			for i in "${order[@]}"; do
				spec="${SPECS[$i]}"; pat="${spec%%:*}"; cfg="${spec#*:}"
				run_one "$cfg" "$pat" "$task" "$rep"
			done
			cell=$((cell + 1))
		done
	done
fi

# HELD-OUT tasks (audit: the overfit gate was inactive because every row was
# split "val"). HELDOUT="rle saddle" runs those tasks AFTER the main sweep with
# split=heldout — they must NEVER appear in TASKS or be used for candidate
# selection; fleet_report's uplift-decay gap + decide()'s overfit gate reactivate
# when these rows exist. Opt-in per round (adds len(HELDOUT) x N sessions/arm).
if [[ -n "${HELDOUT:-}" ]]; then
	held_cell=0
	for task in ${HELDOUT}; do
		case " ${TASKS[*]} " in *" $task "*) echo "[real_gate] $task is in TASKS — held-out contamination; aborting" >&2; exit 2 ;; esac
		for rep in $(seq 1 "$N"); do
			if [[ ${#SPECS[@]} -eq 1 || "${INTERLEAVE:-on}" == "off" ]]; then
				order=(); for i in "${!SPECS[@]}"; do order+=("$i"); done
			elif (( held_cell % 2 == 0 )); then order=(0 1); else order=(1 0); fi
			for i in "${order[@]}"; do
				spec="${SPECS[$i]}"; pat="${spec%%:*}"; cfg="${spec#*:}"
				run_one "$cfg" "$pat" "$task" "$rep" heldout
			done
			held_cell=$((held_cell + 1))
		done
	done
fi

# Explicit robustness sweep. Canonical harness cells above remain the only val
# evidence. Equivalent wording rows are split=robustness, and the one-shot arm
# is diagnostic only, so neither can inflate adoption Fisher sample sizes.
if [[ "$ROBUSTNESS" == 1 ]]; then
	for task in "${TASKS[@]}"; do
		for rep in $(seq 1 "$N"); do
			for variant in equivalent-1 equivalent-2 equivalent-3; do
				for spec in "${SPECS[@]}"; do
					pat="${spec%%:*}"; cfg="${spec#*:}"; run_one "$cfg" "$pat" "$task" "$rep" robustness "$variant"
				done
			done
			for variant in canonical equivalent-1 equivalent-2 equivalent-3; do run_one_shot "$task" "$rep" "$variant"; done
		done
	done
	python3 "$HERE/prompt-lab/robustness_report.py" "$GEN" --baseline base --candidate cand
fi

echo; echo "rows -> $RESULTS"
if [[ "$CALIB" == 1 ]]; then
	echo "calibrate: ./prompt-lab/calibrate.py $GEN   (keep tasks in the 20-85% band for this model)"
else
	echo "analyze: ./prompt-lab/fleet_report.py $GEN --baseline base --candidate cand"
fi
