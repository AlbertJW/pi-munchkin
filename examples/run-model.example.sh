#!/usr/bin/env bash
set -euo pipefail
# Example llama.cpp launcher for serving ONE model on an OpenAI-compatible endpoint
# (:8080), which is what the optimizer/ tools talk to. Copy + edit per model.
#
#   MODEL=/path/to/model.gguf SERVER=/path/to/llama-server ./run-model.example.sh
#
# Bring your own GGUF + llama-server build; nothing here is machine-specific.

MODEL="${MODEL:?set MODEL=/path/to/your-model.gguf}"
SERVER="${SERVER:-llama-server}"        # path to your llama.cpp llama-server binary
ALIAS="${ALIAS:-local-model}"           # must match the id you put in harness/models.json

HOST="${HOST:-127.0.0.1}"; PORT="${PORT:-8080}"
CTX="${CTX:-32768}"; PREDICT="${PREDICT:-8192}"
BATCH="${BATCH:-2048}"; UBATCH="${UBATCH:-1024}"; PARALLEL="${PARALLEL:-1}"
CACHE_K="${CACHE_K:-q8_0}"; CACHE_V="${CACHE_V:-q8_0}"
TEMP="${TEMP:-0.7}"; TOP_P="${TOP_P:-0.95}"; TOP_K="${TOP_K:-40}"; MIN_P="${MIN_P:-0.0}"
REASONING="${REASONING:-off}"           # on for thinking models

[[ -f "$MODEL" ]] || { echo "Model not found: $MODEL" >&2; exit 1; }
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port $PORT in use — stop the other server or set PORT=" >&2; exit 1
fi

exec "$SERVER" \
  -m "$MODEL" --alias "$ALIAS" --host "$HOST" --port "$PORT" \
  -ngl 99 -c "$CTX" -n "$PREDICT" -fa on -np "$PARALLEL" -b "$BATCH" -ub "$UBATCH" \
  --cache-type-k "$CACHE_K" --cache-type-v "$CACHE_V" --jinja --reasoning "$REASONING" \
  --temp "$TEMP" --top-p "$TOP_P" --top-k "$TOP_K" --min-p "$MIN_P"
