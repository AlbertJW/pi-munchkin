#!/usr/bin/env bash
# Aggregate the harness self-telemetry (lib/telemetry.ts sink) into a terse
# report: fire counts per mechanism, steer compliance, block/abort rates.
#
#   scripts/telemetry-report.sh [--days N]        (default: all time)
#   TELEMETRY_FILE=<path> overrides the events file (matches lib/telemetry.ts).
set -euo pipefail

FILE="${TELEMETRY_FILE:-$HOME/.pi/agent/telemetry/events.jsonl}"
DAYS="${2:-0}"; [[ "${1:-}" == "--days" ]] && DAYS="$2"
[[ -f "$FILE" ]] || { echo "no telemetry yet: $FILE"; exit 0; }

python3 - "$FILE" "$DAYS" <<'EOF'
import json, sys, collections, statistics
from datetime import datetime, timedelta, timezone

file, days = sys.argv[1], int(sys.argv[2] or 0)
cutoff = datetime.now(timezone.utc) - timedelta(days=days) if days else None
rows = []
for line in open(file):
    line = line.strip()
    if not line:
        continue
    try:
        r = json.loads(line)
    except ValueError:
        continue
    if cutoff:
        try:
            if datetime.fromisoformat(r["ts"].replace("Z", "+00:00")) < cutoff:
                continue
        except (KeyError, ValueError):
            pass
    rows.append(r)

if not rows:
    print("no events in window"); raise SystemExit

by = collections.Counter((r.get("ext","?"), r.get("kind","?")) for r in rows)
print(f"telemetry: {len(rows)} events" + (f" (last {days}d)" if days else ""))
print(f"{'extension':22s} {'kind':22s} {'n':>5s}")
for (ext, kind), n in sorted(by.items()):
    print(f"{ext:22s} {kind:22s} {n:5d}")

# steer compliance: how fast does progress follow a loop-breaker steer?
lat = [r["turns_since"] for r in rows if r.get("kind") == "progress-after-steer" and isinstance(r.get("turns_since"), (int, float))]
steers = sum(n for (e, k), n in by.items() if e == "loop-breaker" and k == "steer")
if steers:
    complied = len(lat)
    med = f"median {statistics.median(lat):.0f} turn(s)" if lat else "n/a"
    print(f"\nloop-breaker compliance: {complied}/{steers} steers followed by progress ({med})")
blocks = sum(n for (e, k), n in by.items() if k == "block")
aborts = sum(n for (e, k), n in by.items() if k == "abort")
if blocks or aborts:
    print(f"hard interventions: {blocks} block(s), {aborts} abort(s) — investigate any cluster: false-fire suspects")
EOF
