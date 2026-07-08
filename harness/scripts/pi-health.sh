#!/usr/bin/env bash
# Read-only sanity check for the pi.dev harness. No writes, no model calls.
# Exit 0 if everything checks out, 1 otherwise. Run: bin/pi-health.sh
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 1
fail=0
ok()  { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; fail=1; }

echo "pi-health: $ROOT"

# 1. Config JSON parses
for f in settings.json models.json; do
  if python3 -c "import json; json.load(open('$f'))" 2>/dev/null; then ok "$f parses"; else bad "$f invalid JSON"; fi
done

# 2. Every extension + lib TypeScript file parses (syntax only)
ts_bad=0
for f in extensions/*.ts lib/*.ts; do
  [ -e "$f" ] || continue
  node --experimental-strip-types --check "$f" 2>/dev/null || { bad "TS syntax: $f"; ts_bad=1; }
done
[ "$ts_bad" = 0 ] && ok "extensions/ + lib/ TS syntax"

# 3. Every settings.packages entry resolves on disk
python3 - <<'PY' || fail=1
import json, os, sys
pkgs = json.load(open("settings.json")).get("packages", [])
missing = []
for p in pkgs:
    if p.startswith("npm:"):
        if not os.path.isdir(os.path.join("npm/node_modules", p[4:])): missing.append(p)
    else:  # local path (e.g. vendor/pi-subagent, ./path)
        path = p[2:] if p.startswith("./") else p
        if not os.path.isdir(path): missing.append(p)
if missing:
    print("  FAIL  packages missing:", ", ".join(missing)); sys.exit(1)
print("  ok    packages resolve:", ", ".join(pkgs) or "(none)")
PY

# 4. Type-check the curated set if tsc is installed
if [ -x npm/node_modules/.bin/tsc ]; then
  if npm/node_modules/.bin/tsc -p .typecheck --noEmit >/dev/null 2>&1; then ok "tsc -p .typecheck"; else bad "tsc -p .typecheck (run 'npm --prefix npm run typecheck' for details)"; fi
else
  echo "  skip  tsc not installed (cd npm && npm install)"
fi

# 5. Config drift: models.json contextWindow vs each launcher's CTX default.
# A stale contextWindow silently mis-times compaction (seen: 30720 vs -c 65536 →
# compaction fired at half the real window). Convention: ctx-8192 ≤ cw ≤ ctx.
LLM_DIR="${LLM_DIR:-$HOME/LLM}"
if [ -d "$LLM_DIR" ]; then
  python3 - "$LLM_DIR" <<'PY' || fail=1
import json, re, sys, glob, os
llm = sys.argv[1]
models = {m["id"]: m["contextWindow"]
          for prov in json.load(open("models.json"))["providers"].values()
          for m in prov.get("models", [])}
drift, checked = [], 0
for sh in glob.glob(os.path.join(llm, "run-*.sh")):
    text = open(sh).read()
    alias = re.search(r"--alias\s+(\S+)", text)
    ctx = re.search(r'CTX="\$\{CTX:-(\d+)\}"', text)
    if not alias or not ctx:
        continue
    mid, c = alias.group(1).strip('"'), int(ctx.group(1))
    if mid not in models:
        continue  # launcher for a model not in the fleet config — not drift
    checked += 1
    cw = models[mid]
    if not (c - 8192 <= cw <= c):
        drift.append(f"{mid}: models.json={cw} launcher CTX={c}")
if drift:
    print("  FAIL  ctx drift:", "; ".join(drift)); sys.exit(1)
print(f"  ok    models.json ctx in sync with {checked} launcher(s)")
PY
else
  echo "  skip  ctx-drift check (no $LLM_DIR; set LLM_DIR=)"
fi

# 6. Default model must exist in models.json (only for the local provider —
# an external default like openai-codex is not ours to validate).
python3 - <<'PY' || fail=1
import json, sys
s = json.load(open("settings.json"))
if s.get("defaultProvider") != "local-llamacpp":
    print(f"  ok    defaultModel check skipped (provider {s.get('defaultProvider')!r} is external)"); sys.exit(0)
ids = {m["id"] for prov in json.load(open("models.json"))["providers"].values() for m in prov.get("models", [])}
dm = s.get("defaultModel")
if dm in ids:
    print(f"  ok    defaultModel {dm!r} exists in models.json"); sys.exit(0)
print(f"  FAIL  defaultModel {dm!r} not in models.json ({sorted(ids)})"); sys.exit(1)
PY

# 7. Telemetry sink writable (lib/telemetry.ts fail-opens, so a broken dir would
# silently drop all events — surface it here instead).
tdir="$ROOT/telemetry"
if mkdir -p "$tdir" 2>/dev/null && touch "$tdir/.w" 2>/dev/null && rm -f "$tdir/.w"; then
  ok "telemetry dir writable"
else
  bad "telemetry dir not writable: $tdir"
fi

if [ "$fail" = 0 ]; then echo "PASS"; exit 0; else echo "FAIL"; exit 1; fi
