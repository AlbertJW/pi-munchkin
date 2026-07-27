#!/usr/bin/env python3
"""Continuous-outcome A/B for gate rounds: effort metrics, exact Mann-Whitney.

Pass/fail is one bit per session; at n=6/arm no improvement below +83pp can reach
significance (Fisher). The same sessions already record turns, tool errors, repeat
calls and token counts -- continuous outcomes with far more power per session.
Complete separation at n=6/6 reaches p=0.0022, so a real efficiency effect is
detectable where a pass-rate effect is not.

Usage:  effort_report.py <gen> [--only-passing] [--json]
        effort_report.py --selftest
"""
from __future__ import annotations

import argparse
import json
import os
from itertools import combinations
from math import comb
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / "results"

# (row path, human label, lower_is_better)
METRICS = [
    (("trajectory", "turns"), "turns", True),
    (("trajectory", "tool_calls"), "tool_calls", True),
    (("trajectory", "tool_errors"), "tool_errors", True),
    (("trajectory", "repeat_calls"), "repeat_calls", True),
    (("trajectory", "tool_result_chars"), "tool_result_chars", True),
    (("usage", "output_tokens"), "output_tokens", True),
    (("usage", "input_tokens"), "input_tokens", True),
]


def dig(row, path):
    cur = row
    for key in path:
        if not isinstance(cur, dict) or key not in cur:
            return None
        cur = cur[key]
    return cur if isinstance(cur, (int, float)) and not isinstance(cur, bool) else None


def median(values):
    s = sorted(values)
    n = len(s)
    if not n:
        return None
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def mannwhitney_u(a, b):
    """Exact two-sided Mann-Whitney U. Returns (U_a, p). Ties get half credit."""
    n1, n2 = len(a), len(b)
    if not n1 or not n2:
        return None, None
    def u_of(x, y):
        return sum((1.0 if xi > yj else 0.5 if xi == yj else 0.0) for xi in x for yj in y)
    obs = u_of(a, b)
    # Enumerate every assignment of the pooled values into a group of size n1.
    pool = list(a) + list(b)
    extreme = total = 0
    centre = n1 * n2 / 2
    for idx in combinations(range(n1 + n2), n1):
        pick = set(idx)
        ga = [pool[i] for i in idx]
        gb = [pool[i] for i in range(n1 + n2) if i not in pick]
        u = u_of(ga, gb)
        total += 1
        if abs(u - centre) >= abs(obs - centre) - 1e-9:
            extreme += 1
    return obs, extreme / total


def rows(gen):
    path = RESULTS / f"{gen}.jsonl"
    if not path.is_file():
        raise SystemExit(f"no such gen: {path}")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def analyse(gen, only_passing=False):
    data = rows(gen)
    if only_passing:
        data = [r for r in data if r.get("score") == 1]
    base = [r for r in data if r.get("pattern") == "base"]
    cand = [r for r in data if r.get("pattern") == "cand"]
    out = {"gen": gen, "n_base": len(base), "n_cand": len(cand),
           "only_passing": only_passing, "metrics": []}
    for path, label, lower_better in METRICS:
        b = [v for v in (dig(r, path) for r in base) if v is not None]
        c = [v for v in (dig(r, path) for r in cand) if v is not None]
        if len(b) < 2 or len(c) < 2:
            continue
        mb, mc = median(b), median(c)
        _, p = mannwhitney_u(c, b)
        delta = mc - mb
        pct = (100.0 * delta / mb) if mb else None
        better = (delta < 0) if lower_better else (delta > 0)
        out["metrics"].append({
            "metric": label, "base_median": mb, "cand_median": mc,
            "delta": delta, "pct": pct, "p": p,
            "direction": "better" if delta and better else ("worse" if delta else "flat"),
        })
    return out


def render(res):
    tag = " (passing sessions only)" if res["only_passing"] else ""
    print(f"\n{res['gen']}{tag}   base n={res['n_base']}  cand n={res['n_cand']}")
    if res["n_base"] < 2 or res["n_cand"] < 2:
        print("  too few rows to compare")
        return
    print(f"  {'metric':<20} {'base':>10} {'cand':>10} {'change':>12} {'p':>8}")
    for m in res["metrics"]:
        pct = f"{m['pct']:+.0f}%" if m["pct"] is not None else "n/a"
        star = " *" if m["p"] is not None and m["p"] < 0.05 else ""
        print(f"  {m['metric']:<20} {m['base_median']:>10.0f} {m['cand_median']:>10.0f}"
              f" {pct:>12} {m['p']:>8.3f}{star}")


def selftest():
    # exact MWU against known values: complete separation at 6v6 is the floor
    _, p = mannwhitney_u([1, 2, 3, 4, 5, 6], [7, 8, 9, 10, 11, 12])
    assert abs(p - 2 / comb(12, 6)) < 1e-9, p
    # identical samples -> p == 1
    _, p = mannwhitney_u([1, 2, 3], [1, 2, 3])
    assert abs(p - 1.0) < 1e-9, p
    # a real effect that binary pass/fail could never see at this n
    _, p = mannwhitney_u([10, 11, 12, 13, 14, 15], [20, 21, 22, 23, 24, 25])
    assert p < 0.01, p
    assert median([3, 1, 2]) == 2 and median([4, 1, 2, 3]) == 2.5
    assert dig({"a": {"b": 5}}, ("a", "b")) == 5
    assert dig({"a": {"b": True}}, ("a", "b")) is None  # bools are not measurements
    print("effort_report selftest: OK")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("gen", nargs="?")
    ap.add_argument("--only-passing", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
    elif not args.gen:
        ap.error("gen is required")
    else:
        res = analyse(args.gen, args.only_passing)
        print(json.dumps(res, sort_keys=True)) if args.json else render(res)
