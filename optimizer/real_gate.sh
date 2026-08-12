#!/usr/bin/env bash
# real_gate.sh — the FUEL: a config-driven AGENTIC gate. Does a candidate config
# actually make the model write passing code? Applies a config (project prompt + env)
# and runs the real coding tasks headless, N reps each, scoring gate-pass (node --test
# + task checks). Emits fleet_report-compatible rows {model, pattern, task, rep, score,
# split, out_chars} so the SAME significance/do-no-harm rule decides adoption.
#
#   GEN=rg0 BASE=configs/baseline.json CAND=configs/static/c46-prompt-lean.json N=3 ./real_gate.sh [parens equil bigdata]
#   ./real_gate.sh --dry
#
# MODEL_CONTROL=llama expects an already-running OpenAI-compatible server;
# MODEL_CONTROL=pi-native delegates transport to Pi's provider registry. The default
# GATE_NETWORK=endpoint is the fail-closed default and permits only the selected
# loopback model endpoint. GATE_NETWORK=open is an explicit exploratory override.
# Traps INT/TERM kill the
# in-flight Pi process group so Ctrl-C also cleans up tool grandchildren.
set -uo pipefail

append_gate_tool() { # $1=list $2=tool
	local list="$1" tool="$2"
	[[ ",$list," == *",$tool,"* ]] && { printf '%s\n' "$list"; return; }
	printf '%s,%s\n' "$list" "$tool"
}

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(git -C "$HERE" rev-parse --show-toplevel 2>/dev/null || dirname "$HERE")"
GEN="${GEN:-rg0}"; N="${N:-3}"
ARM="${ARM:-both}"                 # base | cand | both
# The unconditional tool surface of EVERY gate session, both arms. This must match
# the live agent's standard surface (minus deliberate exclusions) or rounds measure
# a harness that doesn't exist — see the resolution block in run_one() for the
# 2026-07-23 (plan_write) and 2026-07-28 (subagent, write) incidents this encodes.
# 2026-08-07: plan_go + span tools joined the base list when their flags went
# default-on in the harness (ADR-0001: gate tools must mirror the harness
# surface). A suppression arm setting PLAN_TOOL_GO=off / SPAN_TOOLS=off strips
# them again below, keeping --tools consistent with what the extension registers.
GATE_BASE_TOOLS="read,edit,write,bash,plan_write,subagent,plan_go,search_spans,read_span"
DD="${DD:-qwen36-35b-iq3s}"; PI_TIMEOUT="${PI_TIMEOUT:-1800}"
PI_MODEL="${PI_MODEL:-}"   # pi model id for the sessions (else pi uses its default — beware external defaults)
PI_PROVIDER="${PI_PROVIDER:-}"
GATE_NETWORK="${GATE_NETWORK:-endpoint}"   # endpoint (authoritative loopback default) | open (exploratory)
MODEL_CONTROL="${MODEL_CONTROL:-llama}"    # llama | pi-native
BASE="${BASE:-$HERE/prompt-lab/configs/baseline.json}"
CAND="${CAND:-$HERE/prompt-lab/configs/static/c46-prompt-lean.json}"
FIXTURE="${PI_TEST_FIXTURE:-$HERE/pi-test}"; T3_FILES="$HERE/ab-symbolect/t3-files"
FIXTURES="$HERE/real-gate-fixtures"
CONFIG="$HERE/prompt-lab/config.py"; METRICS="$HERE/ab-machinery/metrics.py"
FIXTURE_META="$HERE/prompt-lab/eval_fixture.py"; FINGERPRINT="$HERE/prompt-lab/serving_fingerprint.py"
EXEC_POLICY="$HERE/prompt-lab/execution_policy.py"
RESULTS="$HERE/prompt-lab/results/$GEN.jsonl"
RUNS="${REAL_GATE_RUNS:-$HOME/.pi/real-gate-runs}"
EXPERIMENT_MANIFEST="${EXPERIMENT_MANIFEST:-}"
EXPERIMENT_MANIFEST_SHA256="${EXPERIMENT_MANIFEST_SHA256:-}"
EXPERIMENT_BASE_CELL="${EXPERIMENT_BASE_CELL:-base}"
EXPERIMENT_CAND_CELL="${EXPERIMENT_CAND_CELL:-cand}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
# An orchestrator (batch_screen.py) may PIN the registry hash it resolved when it
# built the run-private overlay. Recomputing unconditionally made that pin dead
# env — the row silently recorded whatever models.json said at gate time, so an
# overlay mutated between resolve and run went undetected. Verify instead.
AGENT_MODELS_SHA256_PIN="${AGENT_MODELS_SHA256:-}"
AGENT_MODELS_SHA256=""
if [[ -f "$AGENT_DIR/models.json" ]]; then
	AGENT_MODELS_SHA256="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$AGENT_DIR/models.json")"
fi
if [[ -n "$AGENT_MODELS_SHA256_PIN" && "$AGENT_MODELS_SHA256_PIN" != "$AGENT_MODELS_SHA256" ]]; then
	echo "[real_gate] pinned AGENT_MODELS_SHA256 does not match $AGENT_DIR/models.json — the model registry changed since the caller resolved it; refusing to measure a moved instrument" >&2
	exit 2
fi
if [[ -n "$EXPERIMENT_MANIFEST" ]]; then
	[[ -f "$EXPERIMENT_MANIFEST" ]] || { echo "[real_gate] experiment manifest not found: $EXPERIMENT_MANIFEST" >&2; exit 2; }
	manifest_actual="$(python3 -c 'import hashlib,sys; print(hashlib.sha256(open(sys.argv[1],"rb").read()).hexdigest())' "$EXPERIMENT_MANIFEST")"
	[[ -n "$EXPERIMENT_MANIFEST_SHA256" && "$manifest_actual" == "$EXPERIMENT_MANIFEST_SHA256" ]] || {
		echo "[real_gate] experiment manifest hash mismatch" >&2; exit 2;
	}
fi

DRY=0; HARD=0; CALIB="${CALIB:-0}"; ROBUSTNESS=0; EXPLORATORY=0; TASKS=()
ARM_NEXT=0
DEFAULT_TASKS=(parens equil bigdata)
for a in "$@"; do
	if [[ "$ARM_NEXT" == 1 ]]; then ARM="$a"; ARM_NEXT=0; continue; fi
	case "$a" in
		--dry) DRY=1 ;;
		--arm) ARM_NEXT=1 ;;
		--arm=*) ARM="${a#*=}" ;;
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
		TASKS=("${DEFAULT_TASKS[@]}")
	fi
fi

# A HIDDEN-test task (SWE-bench style): the model gets a prose spec only and never sees the
# grading test; the fixture's own test/ is the visible Pass-to-Pass set, and the hidden
# Fail-to-Pass test is installed only at grading. Data-driven: a task is hidden iff it has a
# hidden grader, and uses its own fixture dir $FIXTURES/<id>/ if one exists (else the default).
hidden_test_for() {
	if [[ -f "$FIXTURES/hidden/$1.test.js" ]]; then echo "$FIXTURES/hidden/$1.test.js"; return; fi
	# t4 predates the hidden/<task>.test.js convention; its grader still lives at
	# admission-tests/t4.test.mjs (also the source fixture_admission.py's own
	# manifest-overlay path uses). Named explicitly rather than folded into the
	# generic eval_fixture.py fallback below, which is scoped to context_pressure
	# manifests only — broadening it would wrongly reclassify t1/t2/t3/t5/t6 (which
	# also carry a tests.fail_to_pass overlay for admission, but are graded here via
	# their own install_tests()/bespoke-check path, not the hidden-task path) as hidden.
	if [[ "$1" == "t4" && -f "$FIXTURES/admission-tests/t4.test.mjs" ]]; then echo "$FIXTURES/admission-tests/t4.test.mjs"; return; fi
	local relative; relative="$(python3 "$FIXTURE_META" hidden-test "$1" 2>/dev/null)"
	[[ -n "$relative" ]] && echo "$HERE/$relative"
}
is_hidden() { [[ -n "$(hidden_test_for "$1")" ]]; }
fixture_for() {
	local relative; relative="$(python3 "$FIXTURE_META" fixture-root "$1" 2>/dev/null)"
	[[ -n "$relative" && -d "$HERE/$relative" ]] && echo "$HERE/$relative" || echo "$FIXTURE"
}

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
[[ "$ARM_NEXT" == 0 ]] || { echo "[real_gate] --arm requires base, cand, or both" >&2; exit 2; }
case "$ARM" in base|cand|both) ;; *) echo "[real_gate] invalid ARM=$ARM (base|cand|both)" >&2; exit 2 ;; esac
# Authenticated endpoints (e.g. the box router) need a bearer token; /health is
# open so health() stays keyless. LLAMA_API_KEY empty -> no header (local zoo).
# The token is passed via a fresh `-K <(...)` process substitution at each call
# site (never as a literal -H argv token) so it never appears in `ps aux`; a
# pre-built array reusing one process substitution across calls would also
# fail (each is a one-shot pipe).
loaded_alias() { curl -fsS -m 5 ${LLAMA_API_KEY:+-K <(printf 'header = "Authorization: Bearer %s"\n' "$LLAMA_API_KEY")} "$LLAMA_URL/v1/models" 2>/dev/null | python3 -c 'import sys,json;d=json.load(sys.stdin)["data"];print(d[0]["id"] if d else "")' 2>/dev/null; }
ensure_model_loaded() {
	local state
	state="$(curl -fsS -m 5 ${LLAMA_API_KEY:+-K <(printf 'header = "Authorization: Bearer %s"\n' "$LLAMA_API_KEY")} "$LLAMA_URL/v1/models" 2>/dev/null | python3 -c 'import json,sys; m=sys.argv[1]; d=json.load(sys.stdin).get("data",[]); print(next((str((x.get("status") or {}).get("value", "")) for x in d if x.get("id")==m), ""))' "$MODEL" 2>/dev/null)"
	[[ "$state" == "loaded" || "$state" == "running" ]] && return 0
	echo "[real_gate] warming $MODEL so the pre-row fingerprint describes the loaded backend" >&2
	curl -fsS --max-time "$HEALTH_WAIT" ${LLAMA_API_KEY:+-K <(printf 'header = "Authorization: Bearer %s"\n' "$LLAMA_API_KEY")} "$LLAMA_URL/v1/chat/completions" -H 'Content-Type: application/json' \
		-d "$(python3 -c 'import json,sys; print(json.dumps({"model":sys.argv[1],"messages":[{"role":"user","content":"Reply OK."}],"max_tokens":1,"temperature":0}))' "$MODEL")" >/dev/null
}

if [[ "$DRY" == 1 ]]; then
	echo "== real_gate DRY ==  GEN=$GEN  N=$N  base=$(basename "$BASE")  cand=$(basename "$CAND")"
	echo "execution: network=$GATE_NETWORK model_control=$MODEL_CONTROL provider=${PI_PROVIDER:-auto} model=${PI_MODEL:-auto}"
	echo "tools: $GATE_BASE_TOOLS (PLAN_TOOL_GO=off / SPAN_TOOLS=off strip their tools)"
	if [[ "$MODEL_CONTROL" == "llama" ]]; then
		echo "server: $(health && loaded_alias || echo DOWN)"
	else
		echo "server: pi-native (llama health/warm-up bypassed)"
	fi
	cfgs="[base, cand]"; nextcmd="./prompt-lab/fleet_report.py $GEN --baseline base --candidate cand"
	[[ "$CALIB" == 1 ]] && cfgs="[base only]" && nextcmd="./prompt-lab/calibrate.py $GEN"
	[[ "$ARM" != "both" ]] && cfgs="[$ARM only]"
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
mkdir -p "$AGENT_DIR/sessions" "$AGENT_DIR/telemetry"
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
	# LLAMA_API_KEY (when present) is handed to the child via FD 4 + an export
	# inside a tiny bash -c wrapper, never as a literal env-var token on env -i's
	# own argv — that argv is fully visible to `ps aux` for the whole session
	# lifetime (unlike a curl call, this child runs for minutes). The child
	# process's actual environment still gets LLAMA_API_KEY (child tools may
	# legitimately need it, per the WARNING above) — only the ps-visible argv
	# leak is closed.
	if [[ "$redir" == ">>" ]]; then
		# The only caller that genuinely knows it's re-running the SAME interrupted
		# task in the SAME workdir; plan-runner's session-start resume notice
		# surfaces any .pi/plan-state.json the aborted first session left behind.
		# --no-skills (2026-07-29): skills are part of the descriptor/hash, but gate
		# prompts deliberately exclude them so skill discovery cannot add a task-
		# dependent prompt variable. The receipt still identifies the installed
		# surface rather than silently reverting to the pre-2026-08-11 hash epoch.
		( cd "$wd" || exit
		  exec 3<<<"$telemetry_key"
		  exec 4<<<"${LLAMA_API_KEY:-}"
		  exec 5< "${passthrough_file:-/dev/null}"
		  run_with_timeout "$PI_TIMEOUT" 30 ${sbx[@]+"${sbx[@]}"} /usr/bin/env -i \
		    ${session_env[@]+"${session_env[@]}"} "${session_base_env[@]}" PI_OBSERVATIONAL_MEMORY_PASSIVE=1 \
		    bash -c 'k="$(cat <&4)"; [[ -n "$k" ]] && export LLAMA_API_KEY="$k"; while IFS= read -r -d "" kv <&5; do [[ -n "$kv" ]] && export "$kv"; done; exec pi -p --approve "$@"' _ \
		    ${PI_SELECT[@]+"${PI_SELECT[@]}"} --no-skills --tools "$tools" "$prompt" ) </dev/null >> "$wd/run.log" 2>&1 &
	else
		( cd "$wd" || exit
		  exec 3<<<"$telemetry_key"
		  exec 4<<<"${LLAMA_API_KEY:-}"
		  exec 5< "${passthrough_file:-/dev/null}"
		  run_with_timeout "$PI_TIMEOUT" 30 ${sbx[@]+"${sbx[@]}"} /usr/bin/env -i \
		    ${session_env[@]+"${session_env[@]}"} "${session_base_env[@]}" PI_OBSERVATIONAL_MEMORY_PASSIVE=1 \
		    bash -c 'k="$(cat <&4)"; [[ -n "$k" ]] && export LLAMA_API_KEY="$k"; while IFS= read -r -d "" kv <&5; do [[ -n "$kv" ]] && export "$kv"; done; exec pi -p --approve "$@"' _ \
		    ${PI_SELECT[@]+"${PI_SELECT[@]}"} --no-skills --tools "$tools" "$prompt" ) </dev/null > "$wd/run.log" 2>&1 &
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
	# Materialize the WHOLE fixture tree, matching fixture_admission.py's copytree.
	# This was an allowlist (src/test/package.json/data/scripts) until 2026-07-30, and it
	# silently withheld docs/ and config/ from FOUR fixtures whose prompts name the file
	# inside them -- admission validated a filesystem the model never saw. That floored
	# retry-trap (1/42) and hygiene-shared-config-reread (3/24) and manufactured c50's
	# entire premise. See MEASUREMENT_METHODOLOGY_2026-07.md section 9.
	# An allowlist here is the defect, not the specific missing directory: extending it
	# one dir at a time just defers the next instance. Gold patches, hidden tests and
	# review packets live OUTSIDE the fixture root, so a tree copy leaks nothing --
	# integrity_selftest.test_gate_materializes_everything_admission_does asserts both
	# that the tree is copied and that no fixture root holds solution-shaped material.
	tar -C "$fix" --exclude node_modules --exclude .git --exclude .DS_Store -cf - . | tar -C "$wd" -xf -
	[[ "$task" == "t3" ]] && cp "$T3_FILES/align.js" "$wd/src/"   # the buggy source to fix (before only)
	is_hidden "$task" || install_tests "$task" "$wd"             # shown tasks only; hidden tasks withhold the test

	# Surface provenance is PER RUN, after the fixture exists and before Pi starts.
	# The cwd argument makes project-local .pi/extensions part of the same topology
	# Pi will load; computing this once at launcher startup silently omitted them.
	local HARNESS_HASH_BLOCKER="No valid launcher-computed surface receipt is available; this row cannot be promoted until the running extension corroborates one in authenticated telemetry."
	local HARNESS_SURFACE_SHA256=""
	if HARNESS_SURFACE_SHA256="$(node --experimental-strip-types "$REPO_ROOT/harness/scripts/surface-hash.ts" "$AGENT_DIR" "$wd" 2>/dev/null)"; then
		HARNESS_HASH_BLOCKER=""
	else
		HARNESS_SURFACE_SHA256=""
		echo "[real_gate] WARNING: harness surface hash computation failed for $pat/$task; rows keep the explicit blocker" >&2
	fi

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
	local telfile="$wd/context-telemetry.jsonl"
	local telemetry_key; telemetry_key="$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
	# Keep raw telemetry in an unlinked parent-owned descriptor. Pi inherits fd 8,
	# while evaluated tool subprocesses receive only stdio and cannot open,
	# truncate, replay, or forge the evidence by pathname. HMAC is a second
	# fail-closed boundary if descriptor behavior ever regresses.
	: > "$telfile"; exec 8<>"$telfile"; rm -f "$telfile"
	local session_env=()
	python3 "$CONFIG" --apply "$cfg" --workdir "$wd" --env-null > "$envfile" || exit 2
	# Exposure is declared by the candidate config and counted for both arms. Keep
	# only event names in the child-visible spec; payloads remain behind the
	# authenticated telemetry reducer.
	local exposure_events_file="$wd/.exposure-events"
	python3 - "$CAND" "$exposure_events_file" <<'PY'
import json,sys
cfg=json.load(open(sys.argv[1], encoding="utf-8"))
spec=cfg.get("exposure") or {}
events=list(spec.get("target") or []) + list(spec.get("diagnostic") or [])
open(sys.argv[2], "w", encoding="utf-8").write("".join(f"{event}\n" for event in events))
PY
	local exposure_args=()
	while IFS= read -r entry; do [[ -n "$entry" ]] && exposure_args+=(--exposure-event "$entry"); done < "$exposure_events_file"
	while IFS= read -r -d '' entry; do session_env+=("$entry"); done < "$envfile"
	local env_span_tools=""
	for entry in ${session_env[@]+"${session_env[@]}"}; do [[ "$entry" == SPAN_TOOLS=* ]] && env_span_tools="${entry#*=}"; done
	# Default flipped 2026-08-07 with the harness adoption: unset now means ON.
	env_span_tools="${env_span_tools:-${SPAN_TOOLS:-on}}"
	if [[ "${TRAJECTORY:-off}" == "on" && "$env_span_tools" == "off" ]]; then
		echo "[real_gate] TRAJECTORY=on requires span tools (now default-on; this arm sets SPAN_TOOLS=off) for $pat/$task; refusing argument-only evidence" >&2
		exit 2
	fi
	# SPAWN_DELEGATION rewords delegation advice, but
	# the advice is meaningless if there is no subagent tool to advise toward.
	# (PLAN_DELEGATE_ALL retired 2026-08-03.) Either needs the escape hatch in the
	# session's tool list, not just t4's, or the candidate is instructing an
	# unavailable tool (c37's own remote-box round measured nothing useful before
	# this was caught — every blocked call fell through to the no-subagent path).
	local env_spawn_delegation=""
	local env_force_plan_write="" env_plan_uncertainty="" env_plan_item_guidance_v2=""
	local env_plan_tool_go="" # c39: standalone flag, not folded into the subagent-family branch below
	for entry in ${session_env[@]+"${session_env[@]}"}; do
		[[ "$entry" == SPAWN_DELEGATION=* ]] && env_spawn_delegation="${entry#*=}"
		[[ "$entry" == FORCE_PLAN_WRITE=* ]] && env_force_plan_write="${entry#*=}"
		[[ "$entry" == PLAN_UNCERTAINTY=* ]] && env_plan_uncertainty="${entry#*=}"
		[[ "$entry" == PLAN_ITEM_GUIDANCE_V2=* ]] && env_plan_item_guidance_v2="${entry#*=}"
		[[ "$entry" == PLAN_TOOL_GO=* ]] && env_plan_tool_go="${entry#*=}"
	done
	# plan_write is part of the standard harness surface in every real
	# interactive session; omitting it here measured a harness that doesn't
	# exist — the c31/c38 rounds of 2026-07-23 were confounded exactly this way
	# (the model diagnosed "plan_write is not in my available tools list" and
	# deadlocked against c38's block). Unconditional on BOTH arms: flag-gating
	# it would recreate the c36-style asymmetry. Plan gates still run
	# engine-side inside plan_write, so this grants no verification bypass.
	# 2026-07-28: subagent and write joined the unconditional base list
	# (GATE_BASE_TOOLS, defined at the top of this file) by the same principle
	# as plan_write above — both are standard live surface: real interactive
	# sessions call write routinely and delegate via subagent (observed live
	# 2026-07-27), yet subagent used to be appended only under delegation
	# flags, so ZERO baseline delegations were recorded across 1,466 rows and
	# the explorer was never measured once (EXPLORER_BACKSTOP_RESEARCH_2026-07.md
	# blocker 1), while write's absence pushed models to bash heredocs the live
	# agent never needs. Deliberate exclusions from the base surface: web tools
	# (network nondeterminism). plan_go and span tools joined the base list
	# 2026-08-07 when their harness flags went default-on (ADR-0001); an
	# explicit =off suppression arm strips them here so --tools always mirrors
	# what the extensions actually register under that arm's env.
	local tools="$GATE_BASE_TOOLS"
	if [[ "$env_plan_tool_go" == "off" ]]; then
		tools="${tools//,plan_go/}"
	fi
	if [[ "$env_span_tools" == "off" ]]; then
		tools="${tools//,search_spans/}"; tools="${tools//,read_span/}"
	fi
	# Base-surface regression guard (unconditional, both arms, checked at the point
	# $tools is finalized): a future edit that re-gates a base tool or replaces
	# $tools wholesale must fail loudly here instead of silently measuring a harness
	# that doesn't exist — the exact failure mode of the plan_write (2026-07-23) and
	# subagent/write (2026-07-28) incidents.
	local required_tool
	for required_tool in read edit write bash plan_write subagent; do
		if [[ ",$tools," != *",$required_tool,"* ]]; then
			echo "[real_gate] base surface tool '$required_tool' missing from --tools '$tools' for $pat/$task — refusing to measure a nonexistent harness surface" >&2
			exit 2
		fi
	done
	# Instrument-consistency check (UPGRADE_MAP.md Tier 1 #1): every candidate flag that
	# steers the model toward a specific tool must have that tool actually granted in
	# $tools, checked HERE — at the exact point $tools is finalized, on every real
	# invocation — not in a separate static-analysis script that can drift out of sync
	# with this file's own logic. This is the general form of tonight's bug: plan_write
	# silently missing from every gate session's --tools while c31/c34/c38 steered the
	# model straight at it, caught only via a live transcript after wasted box time (the
	# model itself reported "plan_write is not in my available tools list" after
	# retry-looping a block 76/102 times). Fails closed: a flag pointing at a tool the
	# session doesn't actually have means the row would measure a harness that doesn't
	# exist, exactly like c37/c38 were confounded.
	if [[ ( "$task" == "t4" || "$env_spawn_delegation" != "off" ) && \
	      ",$tools," != *",subagent,"* ]]; then
		echo "[real_gate] task==t4/SPAWN_DELEGATION requires 'subagent' but --tools resolved to '$tools' for $pat/$task — refusing to measure a nonexistent harness surface" >&2
		exit 2
	fi
	if [[ "$env_span_tools" != "off" && ( ",$tools," != *",search_spans,"* || ",$tools," != *",read_span,"* ) ]]; then
		echo "[real_gate] SPAN_TOOLS=on requires 'search_spans,read_span' but --tools resolved to '$tools' for $pat/$task — refusing to measure a nonexistent harness surface" >&2
		exit 2
	fi
	# plan_write is meant to be unconditional in the base list above (now that the
	# t4/subagent branch appends instead of replacing), so this should never actually
	# trip today — it exists as a regression guard against exactly the kind of silent
	# drift that caused tonight's bug: a future edit re-gating plan_write, or a new
	# branch that replaces $tools wholesale instead of appending, would trip it.
	if [[ ( "$env_force_plan_write" != "off" || "$env_plan_uncertainty" != "off" || \
	        "$env_plan_item_guidance_v2" != "off" ) && \
	      ",$tools," != *",plan_write,"* ]]; then
		echo "[real_gate] FORCE_PLAN_WRITE/PLAN_UNCERTAINTY/PLAN_ITEM_GUIDANCE_V2 requires 'plan_write' but --tools resolved to '$tools' for $pat/$task — refusing to measure a nonexistent harness surface" >&2
		exit 2
	fi
	if [[ "$env_plan_tool_go" != "off" && ",$tools," != *",plan_go,"* ]]; then
		echo "[real_gate] PLAN_TOOL_GO=on requires 'plan_go' but --tools resolved to '$tools' for $pat/$task — refusing to measure a nonexistent harness surface" >&2
		exit 2
	fi
	# Child tools receive a deliberately minimal environment. Frontier, cloud,
	# SSH-agent, npm, and shell-hook secrets never enter the fully-approved Pi
	# process. Operators may explicitly pass a provider variable by name when a
	# non-default transport requires it; LLAMA_API_KEY is the only automatic
	# credential because the configured llama endpoint may require bearer auth.
	local gate_tmpdir="$wd/.tmp" key value
	mkdir -p "$gate_tmpdir"
	# Each session owns an authenticated telemetry descriptor. This prevents
	# concurrent gates, interactive Pi activity, and evaluated code from
	# contaminating retries or result-row joins.
	local session_base_env=("HOME=$HOME" "PATH=$PATH" "TMPDIR=$gate_tmpdir" "TELEMETRY=on" "TELEMETRY_SOURCE=gate" "TELEMETRY_HMAC_FD=3" "TELEMETRY_FD=8")
	[[ -n "$HARNESS_SURFACE_SHA256" ]] && session_base_env+=("HARNESS_SURFACE_SHA256=$HARNESS_SURFACE_SHA256")
	for key in LANG LC_ALL SYSTEMROOT WINDIR PI_CODING_AGENT_DIR XDG_CONFIG_HOME; do
		[[ -n "${!key:-}" ]] && session_base_env+=("$key=${!key}")
	done
	if [[ -n "${LLAMA_API_KEY:-}" ]]; then
		# Delivered to the child via FD 4 + export in run_guarded_session's bash -c
		# wrapper, not appended here — session_base_env's array becomes literal
		# env -i argv, which `ps aux` can read for the child's entire lifetime.
		echo "[real_gate] WARNING: LLAMA_API_KEY is required by the selected endpoint and visible to child tools; rows are exploratory" >&2
		SANDBOX_AUTHORITATIVE=0
		SANDBOX_AUTHORITY_REASON="endpoint credential is present in the approved child environment"
	fi
	# Passthrough VALUES go via FD 5 (null-delimited KEY=VALUE pairs exported
	# inside the bash -c wrapper), NEVER onto session_base_env — that array is
	# env -i's literal argv, readable in `ps aux` for the child's whole lifetime.
	# This is the exact leak the LLAMA_API_KEY comment above describes; the first
	# version of this loop reintroduced it for every passthrough variable
	# (2026-07-30 triage #14). The staging file lives in the run's private tmpdir,
	# mode 600, and is removed right after the child is launched.
	local passthrough_file="$gate_tmpdir/.passthrough.env"
	: > "$passthrough_file"; chmod 600 "$passthrough_file"
	local -a passthrough_keys=()
	IFS=',' read -r -a passthrough_keys <<< "${PI_GATE_PASSTHROUGH_ENV:-}"
	for key in ${passthrough_keys[@]+"${passthrough_keys[@]}"}; do
		[[ -z "$key" ]] && continue
		[[ "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "[real_gate] invalid PI_GATE_PASSTHROUGH_ENV name: $key" >&2; exit 2; }
		value="${!key-}"; printf '%s=%s\0' "$key" "$value" >> "$passthrough_file"
		echo "[real_gate] WARNING: explicitly passing $key into approved child tools; rows are exploratory" >&2
		SANDBOX_AUTHORITATIVE=0
		SANDBOX_AUTHORITY_REASON="operator passed credential/environment variable into child tools"
	done

	# jail: render the per-run Seatbelt profile (absolute paths; Seatbelt has no env)
	local sbx=()
	if [[ "$SANDBOX" == "on" ]]; then
		python3 - "$GATE_SB" "$wd/.gate.sb" "$wd" "$AGENT_DIR" "${GATE_MIRROR_DENY:-$REPO_ROOT}" "$REPO_ROOT" "$MODEL_PORT" "$MODEL_HOST" "$gate_tmpdir" "$HOME" <<'PY'
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
	local retried=0 # retained row field for historical schema compatibility; retry candidates are retired
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

	python3 "$FINGERPRINT" capture --endpoint "$FINGERPRINT_ENDPOINT" --model "$MODEL" --output "$wd/fingerprint-post.json"

	# grading: restore authoritative tests so the model can't have tampered with them
	if is_hidden "$task"; then
		rm -f "$wd"/test/*.test.js                       # drop any model-added/edited tests
		cp "$fix"/test/*.test.js "$wd/test/"             # pristine Pass-to-Pass set
		cp "$(hidden_test_for "$task")" "$wd/test/"  # the HIDDEN Fail-to-Pass grader
		[[ "$task" == "bigdata" ]] && cp "$fix/data/events.jsonl" "$wd/data/events.jsonl"
	else
		install_tests "$task" "$wd"                      # shown-test anti-tamper
	fi
	local gate=1
	( cd "$wd" && node --test ) > "$wd/gate.log" 2>&1 || gate=0
	[[ "$task" == "t1" ]] && grep -rq "parseCSV" "$wd/src" "$wd/test" && gate=0
	# t4's real correctness check is now the hidden fail-to-pass grader installed
	# above (is_hidden() recognizes t4 via admission-tests/t4.test.mjs) and scored
	# by the `node --test` a few lines up. The grep this replaced was a tautology:
	# it merely checked the literal word "trim" appears somewhere under test/,
	# trivially satisfied by the model naming a test/comment after the prompt's
	# own vocabulary regardless of whether the trim option actually works.
	# t2's own tests pass on an untouched fixture — node --test alone scores a no-op as
	# success. The F2P grader asserts the behavior the task actually asks for.
	[[ "$task" == "t2" ]] && ! ( cd "$wd" && node "$FIXTURES/t2-check.mjs" ) >/dev/null 2>&1 && gate=0
	# c23 trajectory assertion (grader integrity): a passing END STATE reached by a
	# lucky broken PATH is still a failure (e.g. bigdata answered from a head-peek,
	# never scanning the file). Opt-in for calibration: TRAJECTORY=on ANDs it in;
	# base-off vs base-on delta = the lucky-pass rate. Only ever ADDS strictness.
	[[ "${TRAJECTORY:-off}" == "on" && "$gate" == 1 ]] && ! python3 "$HERE/prompt-lab/trajectory_check.py" "$wd" "$task" && gate=0
	local mrow; mrow="$(python3 "$METRICS" "$wd")"
	local context_telemetry="$wd/context-telemetry.json"
	python3 "$HERE/prompt-lab/context_telemetry.py" "fd:8" "$(basename "$wd")" --key-stdin ${exposure_args[@]+"${exposure_args[@]}"} <<<"$telemetry_key" > "$context_telemetry" || {
		echo "[real_gate] authenticated context telemetry verification failed" >&2; exec 8>&-; exit 1;
	}
	exec 8>&-
	# Diagnostic-only treatment compliance. This receipt check never changes the
	# task score; span_screen.py decides whether the experiment was actually exposed.
	local span_receipt_success=0
	if [[ "$task" == "bigdata" ]] && python3 "$HERE/prompt-lab/trajectory_check.py" "$wd" "$task" >/dev/null 2>&1; then
		span_receipt_success=1
	fi
	local tin tout usage_exact output_chars health_output
	tin="$(cut -f6 <<< "$mrow")"; [[ -n "$tin" ]] || tin=0
	tout="$(cut -f7 <<< "$mrow")"; [[ -n "$tout" ]] || tout=0
	usage_exact="$(cut -f10 <<< "$mrow")"; [[ -n "$usage_exact" ]] || usage_exact=0
	output_chars="$(cut -f11 <<< "$mrow")"; [[ -n "$output_chars" ]] || output_chars=0
	if [[ "${REQUIRE_EXACT_USAGE:-0}" == "1" && "$usage_exact" != "1" ]]; then
		echo "[real_gate] exact provider usage is required for this batch, but $pat/$task rep$rep has no exact usage; refusing the row" >&2
		exit 2
	fi

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

	python3 - "$RESULTS" "$MODEL" "$pat" "$task" "$rep" "$gate" "$retried" "$RUNID" "$tin" "$tout" "$output_chars" "$split" "$usage_exact" "${FLEET_EXPECTED_MODELS:-}" "$rowctx" "$wd/fingerprint-pre.json" "$wd/fingerprint-post.json" "$GATE_NETWORK" "$MODEL_CONTROL" "$MODEL_PROVIDER_RESOLVED" "$ENDPOINT_IDENTITY_SHA256" "$NETWORK_AUTHORITATIVE" "$NETWORK_AUTHORITY_REASON" "$SANDBOX_AUTHORITATIVE" "$SANDBOX_AUTHORITY_REASON" "$EXEC_POLICY" "$mrow" "$span_receipt_success" "$cfg" "$CONFIG" "$EXPERIMENT_MANIFEST" "$EXPERIMENT_MANIFEST_SHA256" "$EXPERIMENT_BASE_CELL" "$EXPERIMENT_CAND_CELL" "$HARNESS_HASH_BLOCKER" "$context_telemetry" "$wd/.pi/APPEND_SYSTEM.md" "${AGENT_MODELS_SHA256:-}" "$tools" "$wd" <<'PY'
import hashlib,importlib.util,json,os,sys
(out,model,pat,task,rep,gate,retried,runid,tin,tout,outchars,split,usage_exact,expected_models,
 ctxpath,prepath,postpath,network_mode,model_control,provider,endpoint_sha,network_auth,network_reason,
 sandbox_auth,sandbox_reason,policy_path,mrow,span_receipt,cfg_path,config_path,experiment_manifest,
 experiment_sha,base_cell,cand_cell,harness_blocker,context_telemetry_path,rendered_governor_path,agent_models_sha,tools_csv,
 workdir) = sys.argv[1:41]
ctx=json.load(open(ctxpath)); pre=json.load(open(prepath)); post=json.load(open(postpath))
# Loaded once and reused for both "harness" and "context" below — the surface hash
# in the row is pulled ONLY from this already-HMAC-verified blob, never from the
# raw HARNESS_SURFACE_SHA256 env var directly, so no code path can launder an
# unverified value into a row.
context_data=json.load(open(context_telemetry_path))
harness_surface_sha256=context_data.get("harness_surface_sha256")
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
metric_names=("turns","edits","edit_err","reads","subag","in_tok","out_tok","lb_fires","vg_fires","usage_exact","output_chars",
              "tool_calls","tool_errors","repeat_calls","repeat_reads","tool_result_chars","first_mutation_turn","compactions","unique_reads",
              "search_spans","read_span")
metric_values=mrow.split("\t")
if len(metric_values) != len(metric_names):
    raise SystemExit(f"metrics row has {len(metric_values)} fields, expected {len(metric_names)}")
metrics={name:int(value) for name,value in zip(metric_names,metric_values)}
trajectory={name:metrics[name] for name in ("turns","tool_calls","tool_errors","reads","unique_reads","repeat_calls","repeat_reads",
                                             "tool_result_chars","first_mutation_turn","compactions","search_spans","read_span")}
# subag was always extracted by metrics.py but dropped here — with subagent now on
# the base surface, delegation usage is a first-class trajectory dimension.
trajectory["subagent_calls"]=metrics["subag"]
cfg_bytes=open(cfg_path,"rb").read(); cfg=json.loads(cfg_bytes)
cspec=importlib.util.spec_from_file_location("prompt_lab_config",config_path)
cmod=importlib.util.module_from_spec(cspec); cspec.loader.exec_module(cmod)
# config.py's apply_to_workdir() always writes this file (empty for a governor-less
# variant) BEFORE the session starts, so it's always present here. The JSON config
# hash alone doesn't prove which BYTES actually loaded — a changed live governor, or
# a modified candidate file at the same path, changes behavior with no change to
# the config hash. Hash the rendered file too, not just its JSON source.
rendered_governor_sha256=hashlib.sha256(open(rendered_governor_path,"rb").read()).hexdigest()
config_binding={"sha256":hashlib.sha256(cfg_bytes).hexdigest(),"declared_env":cmod.config_env(cfg),
                "rendered_governor_sha256":rendered_governor_sha256}
experiment=None
if experiment_manifest:
    manifest_bytes=open(experiment_manifest,"rb").read()
    actual=hashlib.sha256(manifest_bytes).hexdigest()
    if actual != experiment_sha: raise SystemExit("experiment manifest hash drift while writing row")
    experiment={"manifest_sha256":actual,"cell":base_cell if pat=="base" else cand_cell}
# GRADED SUBSCORES (optional, additive). A fixture's hidden grader may emit a
# `.<name>-grade.json` artifact of {fixed, total, defects} alongside its exit code.
# `score` stays the strict binary gate bit, so rows without a grader are unchanged
# and no cross-round pass-rate comparison shifts. This exists because the gate is a
# one-sided regression detector on a binary outcome (CANDIDATE_STRATEGY_2026-07-31
# section 1): partial credit is what lets a round show improvement at all.
#
# The name is PINNED by the fixture manifest, not discovered by globbing: the workdir is
# model-writable all session, so a decoy sorting ahead of the real artifact would have been
# read instead. grade_artifact.extract refuses on anything that is not exactly the declared
# file — see its module docstring for why `rm -f` before grading does not close the hole.
sys.path.insert(0, os.path.dirname(os.path.abspath(config_path)))
import grade_artifact as _grade_artifact
subscores, subscores_blocked = _grade_artifact.extract(workdir, ctx.get("grade_artifact"))
rec={"schema":"pi.eval-row/v2", "task":task,"pattern":pat,"arm":pat,"rep":int(rep),
     "repetition":int(rep),"model":model,"split":split,"score":int(gate),
     "retried":int(retried),"run":runid,"fixture":{"cohort":ctx["cohort"],"version":ctx["version"]},
     "authoritative":authoritative,"status":status,"authority_reason":authority_reason,
     "execution":{"network_mode":network_mode,"model_control":model_control,"provider":provider,
                  "endpoint_identity_sha256":endpoint_sha,"network_authoritative":bool(int(network_auth)),
                  "sandboxed":bool(int(sandbox_auth)),"authoritative":execution_authoritative,
                  "agent_models_sha256":agent_models_sha or None},
     "prompt":{"variant":ctx["prompt_variant"],"semantic_group":ctx["semantic_group"],"sha256":ctx["prompt_sha256"]},
     "serving":{"pre":pre,"post":post,"stable":stable},"usage":usage,"trajectory":trajectory,
     "span_receipt_success":bool(int(span_receipt)),"config":config_binding,"experiment":experiment,
     "harness":{"surface_sha256":harness_surface_sha256,
                "hash_blocker":harness_blocker if harness_surface_sha256 is None else "",
                # The resolved --tools list, verbatim: the subagent gap hid for
                # 1,466 rows precisely because no row said which surface it measured.
                "tools":tools_csv.split(",")},
     "context":context_data,
     # compatibility aliases for historical readers; dimensions stay honest.
     "out_chars":int(outchars),"think_chars":0,"in_tok":int(tin) if exact else 0,
     "out_tok":int(tout) if exact else 0,"token_usage_exact":exact}
if subscores is not None:
    rec["subscores"]=subscores
if subscores_blocked:
    # Loud, so a zero-graded round is never mistaken for a fixture that has no grader.
    rec["subscores_blocked"]=subscores_blocked
# Import the single source of truth rather than reimplementing it. This block used to
# duplicate exposure.py's status logic, which silently inverts the moment a mode is added
# (suppression arms would have recorded "targeted" for a mechanism that still fired).
import exposure as _exposure
exposure_spec=_exposure.validate_spec(cfg.get("exposure"))
rec["exposure"]=_exposure.row_exposure(exposure_spec, pat, context_data.get("exposure") or {},
                                       configured=(pat != "base"))
if expected_models:
    rec["fleet_expected_models"] = sorted(expected_models.split())
open(out,"a").write(json.dumps(rec)+"\n")
PY
	local row_writer_rc=$?
	[[ "$row_writer_rc" == 0 ]] || { echo "[real_gate] row writer failed for $pat/$task rep$rep; refusing silent measurement loss" >&2; exit "$row_writer_rc"; }
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

case "$ARM" in
	base) SPECS=("base:$BASE") ;;
	cand) SPECS=("cand:$CAND") ;;
	both) SPECS=("base:$BASE" "cand:$CAND") ;;
esac
[[ "$CALIB" == 1 ]] && SPECS=("base:$BASE")
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
