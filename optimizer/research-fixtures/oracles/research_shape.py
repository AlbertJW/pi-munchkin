#!/usr/bin/env python3
"""Bounded placeholder oracle for research mechanism fixtures.

The screen currently grades graph lifecycle separately.  This oracle only
checks that a future answer artifact names the admitted evidence families and
claim obligations; it never contains or reconstructs answer text.
"""

from __future__ import annotations

import json
import sys


def main() -> int:
    payload = json.load(sys.stdin)
    families = payload.get("evidence_families", [])
    claims = payload.get("claims", [])
    if not isinstance(families, list) or not isinstance(claims, list):
        return 2
    if len(set(families)) != len(families) or len(set(claims)) != len(claims):
        return 1
    return 0 if families and claims else 1


if __name__ == "__main__":
    raise SystemExit(main())
