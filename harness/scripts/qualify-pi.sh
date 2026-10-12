#!/usr/bin/env bash
# qualify-pi — check a Pi release against this harness before (or after) `pi update`.
#
#   npm run qualify:pi                          installed Pi (npm global) vs this checkout's HEAD
#   npm run qualify:pi -- --stage latest        install the newest Pi into scratch first (npm registry)
#   npm run qualify:pi -- --stage 1.2.0         a specific version
#   npm run qualify:pi -- --pi-dir DIR          any unpacked @earendil-works/pi-coding-agent
#   npm run qualify:pi -- --agent-dir DIR       live stack copied (read-only); the candidate harness is overlaid on the copy
#   npm run qualify:pi -- --no-host             skip host qualification (no live stack, e.g. CI)
#
# Never contacts a model. Nothing in this checkout or the agent dir is modified: HEAD is
# exported with `git archive` into a scratch directory, the Pi under test is linked in, and
# on macOS every stage runs in a sandbox that blocks web ports and common local model ports.
# Stages: test suite, typecheck against the tested Pi's types, real-host qualification
# (full extension stack, scripted provider). Exit 0 only when all pass.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd -P)"
PI_DIR=""; STAGE=""; HOST=1
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
while [ $# -gt 0 ]; do
  case "$1" in
    --pi-dir) PI_DIR="$2"; shift 2 ;;
    --stage) STAGE="$2"; shift 2 ;;
    --agent-dir) AGENT_DIR="$2"; shift 2 ;;
    --no-host) HOST=0; shift ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done
COMMIT="$(git -C "$ROOT" rev-parse HEAD)" || exit 2
[ -z "$(git -C "$ROOT" status --porcelain -- harness package.json)" ] || echo "note: uncommitted harness changes are NOT tested; HEAD is."
WORK="$(mktemp -d "${TMPDIR:-/tmp}/qualify-pi.XXXXXX")"

if [ -n "$STAGE" ]; then
  echo "installing @earendil-works/pi-coding-agent@$STAGE into scratch (npm registry)"
  npm install --prefix "$WORK/pi" --no-audit --no-fund --ignore-scripts --loglevel=error "@earendil-works/pi-coding-agent@$STAGE" >/dev/null || { echo "npm install failed" >&2; exit 3; }
  PI_DIR="$WORK/pi/node_modules/@earendil-works/pi-coding-agent"
fi
PI_DIR="${PI_DIR:-$(npm root -g)/@earendil-works/pi-coding-agent}"
PI_VERSION="$(node -p "require('$PI_DIR/package.json').version")" || { echo "no Pi at $PI_DIR" >&2; exit 2; }
# A global install nests Pi's own packages; `npm --prefix` hoists them beside it.
pi_dep() { if [ -d "$PI_DIR/node_modules/@earendil-works/$1" ]; then echo "$PI_DIR/node_modules/@earendil-works/$1"; else echo "$(dirname "$PI_DIR")/$1"; fi; }

mkdir -p "$WORK/src" && git -C "$ROOT" archive "$COMMIT" | tar -x -C "$WORK/src"
DEV_MODULES="$(cd "$ROOT/node_modules" && pwd -P)" || { echo "run npm ci first" >&2; exit 2; }
mkdir -p "$WORK/src/node_modules/@earendil-works"
for d in "$DEV_MODULES"/* "$DEV_MODULES"/.bin; do
  n="$(basename "$d")"; [ "$n" = "@earendil-works" ] || ln -sfn "$d" "$WORK/src/node_modules/$n"
done
ln -sfn "$PI_DIR" "$WORK/src/node_modules/@earendil-works/pi-coding-agent"
for x in pi-agent-core pi-ai pi-tui; do ln -sfn "$(pi_dep "$x")" "$WORK/src/node_modules/@earendil-works/$x"; done

cat > "$WORK/offline.sb" <<'EOF'
(version 1)
(allow default)
(deny network-outbound (remote ip "*:80") (remote ip "*:443") (remote ip "*:53") (remote ip "localhost:8080") (remote ip "localhost:5807") (remote ip "localhost:11434") (remote ip "localhost:1234") (remote ip "localhost:18080"))
EOF
box() { if command -v sandbox-exec >/dev/null 2>&1; then sandbox-exec -f "$WORK/offline.sb" "$@"; else "$@"; fi; }

cd "$WORK/src" || exit 2
echo "Pi $PI_VERSION vs harness $COMMIT (logs: $WORK)"
box npm test >"$WORK/test.log" 2>&1; TEST_RC=$?
box npm run -s typecheck >"$WORK/typecheck.log" 2>&1; TSC_RC=$?
HOST_RC=0
if [ "$HOST" = 1 ]; then
  box node --experimental-strip-types harness/scripts/qualify-harness-ownership.mjs "$PI_DIR" "$AGENT_DIR" "$WORK/host-receipt.json" --candidate >"$WORK/host.log" 2>&1; HOST_RC=$?
fi

count() { grep -E "^ℹ $1 " "$WORK/test.log" | awk '{print $3}'; }
{
  echo "Tests:      rc=$TEST_RC tests=$(count tests) pass=$(count pass) fail=$(count fail) skipped=$(count skipped)"
  grep -E '^✖ harness/tests/' "$WORK/test.log" | sort -u | sed 's/^/  failed: /'
  echo "Typecheck:  rc=$TSC_RC errors=$(grep -c 'error TS' "$WORK/typecheck.log")"
  if [ "$HOST" = 1 ]; then echo "Host:       rc=$HOST_RC $(grep -oE '"extensionsLoaded": [0-9]+|"networkRequests": [0-9]+|"realProviderRequests": [0-9]+' "$WORK/host.log" | tr '\n' ' ')"; else echo "Host:       skipped (--no-host)"; fi
} | tee "$WORK/summary.txt"
if [ $TEST_RC -eq 0 ] && [ $TSC_RC -eq 0 ] && [ $HOST_RC -eq 0 ]; then
  echo "VERDICT: QUALIFIED — Pi $PI_VERSION"
  grep -q "\"$PI_VERSION\"" "$ROOT/harness/lib/pi-compatibility.ts" || echo "Record it: add \"$PI_VERSION\" to QUALIFIED_PI_VERSIONS in harness/lib/pi-compatibility.ts"
  exit 0
fi
echo "VERDICT: NOT QUALIFIED — Pi $PI_VERSION (see $WORK)"
exit 1
