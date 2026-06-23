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

if [ "$fail" = 0 ]; then echo "PASS"; exit 0; else echo "FAIL"; exit 1; fi
