#!/usr/bin/env bash
# Compatibility command: verify shutdown, never run the archived optimizer battery.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
node --test scripts/tests/optimizer-mothball.test.mjs
