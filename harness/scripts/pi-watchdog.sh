#!/usr/bin/env bash
# pi-watchdog.sh — run pi and, if the session stalls BEFORE producing any work,
# capture a diagnostic bundle instead of killing it blind.
#
# Why this exists: roughly 4 of 23 observed loads (2026-08-11, both the 35B and
# ling3) idled after start with no provider connection and no transcript byte,
# and had to be killed. Every one of those kills destroyed the only evidence.
# The native `sample` output we did get was useless — it showed node parked in
# kevent, which is what an idle event loop always looks like. What is missing is
# the JS-side picture, so this wrapper arms Node's diagnostic report and sends
# SIGUSR2 before killing: that dumps the pending libuv handles and requests,
# which is what actually names the stall.
#
# DIAGNOSTIC USE ONLY. It sets NODE_OPTIONS, which is an environment difference;
# do not wrap gate rounds with it. Measurement runs go through real_gate.sh.
#
#   usage: pi-watchdog.sh [-t stall_seconds] [-o bundle_dir] -- <pi args...>
#   exit:  pi's own exit code, or 99 when a stall was captured.
set -uo pipefail

STALL_SECONDS="${PI_WATCHDOG_STALL:-45}"
BUNDLE_ROOT="${PI_WATCHDOG_DIR:-${TMPDIR:-/tmp}/pi-watchdog}"
AGENT_DIR="${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -t) STALL_SECONDS="$2"; shift 2 ;;
    -o) BUNDLE_ROOT="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done
if [[ $# -eq 0 ]]; then
  echo "usage: pi-watchdog.sh [-t stall_seconds] [-o bundle_dir] -- <pi args...>" >&2
  exit 2
fi

# Every capture step runs under this. A diagnostic tool must never block on the
# thing it is diagnosing — the first version called `pi --version` while building
# the bundle and hung forever against a wedged pi, losing the whole capture.
bounded() {
  local secs="$1"; shift
  "$@" &
  local worker=$!
  ( sleep "$secs"; kill -9 "$worker" 2>/dev/null ) &
  local killer=$!
  wait "$worker" 2>/dev/null
  local status=$?
  kill "$killer" 2>/dev/null
  return $status
}

STAMP="$(date -u +%Y%m%dT%H%M%SZ)-$$"
BUNDLE="$BUNDLE_ROOT/$STAMP"
mkdir -p "$BUNDLE"
MARKER="$BUNDLE/.launch-marker"
: > "$MARKER"

# --report-on-signal arms SIGUSR2 -> JS-level diagnostic report. Appending keeps
# any NODE_OPTIONS the caller already set.
export NODE_OPTIONS="${NODE_OPTIONS:-} --report-on-signal --report-directory=$BUNDLE"

# Read the version BEFORE the run under test, bounded: afterwards pi may be the
# very thing that is hung.
PI_VERSION="$(bounded 5 pi --version 2>/dev/null | head -1)"
[[ -n "$PI_VERSION" ]] || PI_VERSION="unknown"

pi "$@" &
PI_PID=$!

# Progress = an established outbound socket, or a transcript byte. The socket is
# the real discriminator (every observed wedge had NO provider connection while
# every healthy load connects in seconds); the transcript check is the backstop
# for a provider reached over a unix socket or already-pooled connection.
#
# Both checks must stay CHEAP: they run once a second. A recursive find over the
# session tree does not qualify — that tree holds thousands of directories, and
# scanning it took longer than the poll interval, which wedged the watchdog
# itself on its first run.
made_progress() {
  # -a is mandatory: lsof ORs selection criteria by default, so without it this
  # matches ANY established socket on the machine and always reports progress.
  lsof -a -p "$PI_PID" -iTCP -sTCP:ESTABLISHED -nP 2>/dev/null | grep -q ESTABLISHED && return 0
  local newest
  newest="$(ls -td "$AGENT_DIR"/sessions/*/ 2>/dev/null | head -1)"
  [[ -n "$newest" ]] &&
    find "$newest" -maxdepth 1 -name '*.jsonl' -size +0c -newer "$MARKER" -print -quit 2>/dev/null | grep -q .
}

WEDGED=0
for ((waited = 0; waited < STALL_SECONDS; waited++)); do
  kill -0 "$PI_PID" 2>/dev/null || break          # exited on its own: nothing to diagnose
  made_progress && break
  sleep 1
  [[ $waited -eq $((STALL_SECONDS - 1)) ]] && WEDGED=1
done

if [[ $WEDGED -eq 1 ]] && kill -0 "$PI_PID" 2>/dev/null; then
  echo "pi-watchdog: no transcript and no connection after ${STALL_SECONDS}s — capturing $BUNDLE" >&2
  {
    echo "captured_at: $(date -u +%FT%TZ)"
    echo "pid: $PI_PID"
    echo "cwd: $PWD"
    echo "stall_seconds: $STALL_SECONDS"
    echo "argv: $*"
    echo "pi_version: $PI_VERSION"
  } > "$BUNDLE/context.txt"
  bounded 5 ps -p "$PI_PID" -o pid,ppid,stat,etime,time,%cpu,%mem > "$BUNDLE/ps.txt" 2>&1
  bounded 15 lsof -p "$PI_PID" -nP > "$BUNDLE/lsof.txt" 2>&1
  bounded 20 sample "$PI_PID" 3 -file "$BUNDLE/sample.txt" >/dev/null 2>&1
  # The point of the exercise: pending handles/requests from the JS side.
  kill -USR2 "$PI_PID" 2>/dev/null && sleep 3
  ls -la "$BUNDLE" > "$BUNDLE/bundle-listing.txt" 2>&1
  kill "$PI_PID" 2>/dev/null
  wait "$PI_PID" 2>/dev/null
  rm -f "$MARKER"
  echo "pi-watchdog: bundle written to $BUNDLE" >&2
  exit 99
fi

wait "$PI_PID"
STATUS=$?
rm -rf "$BUNDLE"          # healthy run: leave no litter
exit $STATUS
