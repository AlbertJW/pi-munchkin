#!/usr/bin/env bash
# A/B: symbolect identity lines vs baseline prompts (see AB_SYMBOLECT.md).
#
#   SYMBOLECT=on|off ./ab-symbolect.sh [t1 t2 t3 t4]     (default: all four)
#   MODEL=<pi model id> to override the model (e.g. mellum2-12b-thinking).
#
# Arms differ ONLY in one symbolect identity line per prompt surface:
#   off  = live ~/.pi/agent prompts, verbatim
#   on   = same + ab-symbolect/sym-headers/* prepended
# APPEND_SYSTEM goes project-level into the fixture's .pi/ (project-first
# resolution, requires pi --approve). Subagent .md files are global-only in
# headless mode, so for t4+on the global files are modified in place and
# restored from git on exit (precondition: ~/.pi/agent tree is clean).
#
# Fresh fixture per run (pi-test CSV library). Gate = node --test run
# independently after pi exits. Metrics from the session jsonl, not estimates.
set -euo pipefail

ARM="${SYMBOLECT:?set SYMBOLECT=on|off}"
[[ "$ARM" == "on" || "$ARM" == "off" ]] || { echo "SYMBOLECT must be on|off" >&2; exit 1; }
MODEL="${MODEL:-}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HDRS="$HERE/ab-symbolect/sym-headers"
TASKS_DIR="$HERE/ab-symbolect/tasks"
T3_FILES="$HERE/ab-symbolect/t3-files"
FIXTURE="${FIXTURE:-$HERE/pi-test}"
AGENT_DIR="${AGENT_DIR:-$HOME/.pi/agent}"   # the live harness this A/B swaps prompts in
RUNS_ROOT="${RUNS_ROOT:-$HERE/ab-symbolect-runs}"   # gitignored

STAMP="$(date +%Y%m%d-%H%M%S)"
TASKS=("${@:-}"); [[ -z "${TASKS[0]}" ]] && TASKS=(t1 t2 t3 t4)

# ---- preconditions -----------------------------------------------------------
LLAMA_URL="${LLAMA_URL:-http://127.0.0.1:8080}"
curl -fsS -m 5 "$LLAMA_URL/health" >/dev/null || { echo "llama-server not up at $LLAMA_URL" >&2; exit 1; }
[[ -z "$(git -C "$AGENT_DIR" status --porcelain)" ]] || { echo "~/.pi/agent tree not clean — commit/stash first (needed for safe restore)" >&2; exit 1; }
[[ -d "$FIXTURE/src" ]] || { echo "fixture missing: $FIXTURE" >&2; exit 1; }

restore_agents() { git -C "$AGENT_DIR" checkout -- agents/ 2>/dev/null || true; }
trap restore_agents EXIT

# Prepend a header line to an agent .md AFTER its closing frontmatter ---.
prepend_after_frontmatter() { # $1=headerfile $2=target
	local hdr; hdr="$(cat "$1")"
	awk -v hdr="$hdr" 'BEGIN{n=0} {print} /^---$/{n++; if(n==2){print ""; print hdr}}' "$2" > "$2.tmp" && mv "$2.tmp" "$2"
}

RESULTS="$RUNS_ROOT/$STAMP-$ARM/results.tsv"
mkdir -p "$RUNS_ROOT/$STAMP-$ARM"
echo -e "run\tgate\twall_s\tturns\tedits\tedit_err\treads\tsubag\tin_tok\tout_tok" > "$RESULTS"

for task in "${TASKS[@]}"; do
	run_tag="$STAMP-$task-$ARM"
	workdir="$RUNS_ROOT/$STAMP-$ARM/$task-$ARM"
	mkdir -p "$workdir/.pi"

	# fresh fixture
	cp -R "$FIXTURE/src" "$FIXTURE/test" "$FIXTURE/package.json" "$workdir/"
	if [[ "$task" == "t3" ]]; then
		cp "$T3_FILES/align.js" "$workdir/src/"
		cp "$T3_FILES/align.test.js" "$workdir/test/"
	fi

	# arm-specific APPEND_SYSTEM (project-level, replaces global under --approve)
	if [[ "$ARM" == "on" ]]; then
		cat "$HDRS/append.txt" "$AGENT_DIR/APPEND_SYSTEM.md" > "$workdir/.pi/APPEND_SYSTEM.md"
	else
		cat "$AGENT_DIR/APPEND_SYSTEM.md" > "$workdir/.pi/APPEND_SYSTEM.md"
	fi

	# arm-specific subagent prompts (global swap, t4 only; trap restores)
	tools="read,edit,bash"
	if [[ "$task" == "t4" ]]; then
		tools="read,edit,bash,subagent"
		if [[ "$ARM" == "on" ]]; then
			for a in explorer verifier executor; do
				prepend_after_frontmatter "$HDRS/$a.txt" "$AGENT_DIR/agents/$a.md"
			done
		fi
	fi

	model_args=()
	[[ -n "$MODEL" ]] && model_args=(--model "$MODEL")

	echo "== $run_tag (tools: $tools) =="
	start=$(date +%s)
	( cd "$workdir" && timeout 1800 pi -p --approve --tools "$tools" "${model_args[@]}" "$(cat "$TASKS_DIR/$task.txt")" ) > "$workdir/run.log" 2>&1 || true
	wall=$(( $(date +%s) - start ))

	# restore globals immediately after a t4+on run
	[[ "$task" == "t4" && "$ARM" == "on" ]] && restore_agents

	# independent gate
	gate=PASS
	( cd "$workdir" && node --test ) > "$workdir/gate.log" 2>&1 || gate=FAIL
	if [[ "$task" == "t1" ]] && grep -rq "parseCSV" "$workdir/src" "$workdir/test"; then gate=FAIL; fi
	if [[ "$task" == "t4" ]] && ! grep -rq "trim" "$workdir/test"; then gate=FAIL; fi

	# metrics from the session jsonl (newest session whose dir mentions this run)
	metrics=$(python3 - "$workdir" <<'PYEOF'
import json, os, sys, glob
work = sys.argv[1]
munged = work.replace("/", "-")
home = os.path.expanduser("~/.pi/agent/sessions")
cands = [d for d in glob.glob(home + "/*") if munged in d or os.path.basename(work) in d]
files = sorted((f for d in cands for f in glob.glob(d + "/*.jsonl")), key=os.path.getmtime)
if not files:
    print("0\t0\t0\t0\t0\t0\t0"); sys.exit()
turns = edits = edit_err = reads = subag = tin = tout = 0
last_call = None
for line in open(files[-1]):
    try: d = json.loads(line)
    except Exception: continue
    if d.get("type") != "message": continue
    m = d["message"]; role = m.get("role")
    if role == "assistant":
        turns += 1
        u = m.get("usage") or {}
        tin += u.get("input", 0); tout += u.get("output", 0)
        for c in m.get("content") or []:
            if c.get("type") == "toolCall":
                n = (c.get("name") or "").lower(); last_call = n
                if n == "edit": edits += 1
                elif n == "read": reads += 1
                elif n == "subagent": subag += 1
    elif role in ("toolResult", "tool"):
        err = m.get("isError") or any(c.get("isError") for c in (m.get("content") or []) if isinstance(c, dict))
        if err and last_call == "edit": edit_err += 1
print(f"{turns}\t{edits}\t{edit_err}\t{reads}\t{subag}\t{tin}\t{tout}")
PYEOF
)
	echo -e "$task-$ARM\t$gate\t$wall\t$metrics" >> "$RESULTS"
	echo "   gate=$gate wall=${wall}s"
done

echo; echo "results: $RESULTS"; column -t "$RESULTS"
# safety: confirm the agent repo is pristine
[[ -z "$(git -C "$AGENT_DIR" status --porcelain)" ]] || { echo "WARNING: ~/.pi/agent not clean after run!" >&2; exit 1; }
