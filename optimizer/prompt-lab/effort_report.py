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
from collections import Counter
from itertools import combinations
from math import comb, erf, sqrt
from pathlib import Path

RESULTS = Path(__file__).resolve().parent / "results"

# GRADED OUTCOME. `score` is a strict binary gate bit, and at the sample sizes this
# project uses that makes every round a one-sided regression detector: at n=9/arm from
# base 5/9 only a flawless 9/9 reaches one-sided p<0.05, while regressions from a
# ceiling are detectable (CANDIDATE_STRATEGY_2026-07-31.md §1). Partial credit is what
# lets a round show improvement at all — so when a fixture's grader emits subscores,
# the fraction it fixed is the primary outcome, not an effort metric.
# HIGHER IS BETTER here, unlike every metric below it.
def graded_rate(row):
    sub = row.get("subscores")
    if not isinstance(sub, dict):
        return None
    fixed, total = sub.get("fixed"), sub.get("total")
    # `not isinstance(x, bool)` is load-bearing: isinstance(True, int) is True in Python,
    # so a grader emitting `fixed: true` would otherwise score 1/total. dig()'s tuple path
    # already rejects bools ("bools are not measurements"); this keeps the callable path
    # consistent with it rather than quietly disagreeing on the same row.
    if isinstance(fixed, bool) or isinstance(total, bool):
        return None
    if not (isinstance(fixed, int) and isinstance(total, int)) or total <= 0:
        return None
    return fixed / total


GRADED_METRICS = [
    (graded_rate, "graded_rate", False),
    ((("subscores", "fixed")), "graded_fixed", False),
]

# (row path OR callable, human label, lower_is_better)
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
    if callable(path):  # computed metric (see graded_rate)
        v = path(row)
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
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


EXACT_BUDGET = 200_000  # C(n1+n2, n1) above this -> normal approximation


def _u_of(x, y):
    return sum((1.0 if xi > yj else 0.5 if xi == yj else 0.0) for xi in x for yj in y)


def mannwhitney_u(a, b):
    """Two-sided Mann-Whitney U. Exact while enumeration is affordable, else a
    tie-corrected normal approximation -- exact enumeration at n=20/arm is
    C(40,20) = 1.4e11 splits, which would hang the very round this tool exists
    to score."""
    n1, n2 = len(a), len(b)
    if not n1 or not n2:
        return None, None
    obs = _u_of(a, b)
    pool = list(a) + list(b)
    centre = n1 * n2 / 2
    if comb(n1 + n2, n1) <= EXACT_BUDGET:
        extreme = total = 0
        for idx in combinations(range(n1 + n2), n1):
            pick = set(idx)
            u = _u_of([pool[i] for i in idx], [pool[i] for i in range(n1 + n2) if i not in pick])
            total += 1
            if abs(u - centre) >= abs(obs - centre) - 1e-9:
                extreme += 1
        return obs, extreme / total
    # normal approximation with tie correction
    counts = Counter(pool)
    n = n1 + n2
    tie = sum(t ** 3 - t for t in counts.values())
    var = n1 * n2 / 12 * ((n + 1) - tie / (n * (n - 1))) if n > 1 else 0.0
    if var <= 0:
        return obs, 1.0
    z = (abs(obs - centre) - 0.5) / sqrt(var)          # continuity correction
    if z < 0:
        z = 0.0
    return obs, 2 * (1 - 0.5 * (1 + erf(z / sqrt(2))))


def rows(gen):
    path = RESULTS / f"{gen}.jsonl"
    if not path.is_file():
        raise SystemExit(f"no such gen: {path}")
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def analyse(gen, only_passing=False, graded=False):
    if graded and only_passing:
        # Contradictory by construction: --graded exists to read partial credit from
        # sessions the binary bit scores 0, and --only-passing deletes exactly those.
        # Combined, they report full coverage of a population that excludes every row
        # the graded outcome was built for.
        raise SystemExit("--graded and --only-passing are contradictory: --only-passing drops "
                         "the failing sessions partial credit exists to measure. Use one.")
    data = rows(gen)
    if only_passing:
        data = [r for r in data if r.get("score") == 1]
    base = [r for r in data if r.get("pattern") == "base"]
    cand = [r for r in data if r.get("pattern") == "cand"]
    out = {"gen": gen, "n_base": len(base), "n_cand": len(cand),
           "only_passing": only_passing, "graded": graded, "metrics": []}
    # Row COMPOSITION, always reported. analyse() selects on `pattern` alone, while
    # fleet_report.py refuses non-authoritative/incomplete rows outright. Pooling the two
    # populations is how the corpus-wide Simpson's paradox arose, and this tool now carries
    # the graded verdict — so the mix is surfaced rather than silently filtered (filtering
    # by default would move every historical effort number without warning).
    out["non_authoritative"] = sum(1 for r in base + cand if not r.get("authoritative"))
    out["incomplete"] = sum(1 for r in base + cand if r.get("status") not in (None, "complete"))
    metrics = METRICS
    if graded:
        # Coverage is reported, never silently assumed: a partially-graded round would
        # otherwise compare two different populations without saying so.
        out["graded_base"] = sum(1 for r in base if graded_rate(r) is not None)
        out["graded_cand"] = sum(1 for r in cand if graded_rate(r) is not None)
        metrics = GRADED_METRICS + METRICS
    for path, label, lower_better in metrics:
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
    na, inc = res.get("non_authoritative", 0), res.get("incomplete", 0)
    if na or inc:
        print(f"  COMPOSITION: {na} non-authoritative, {inc} incomplete row(s) INCLUDED — "
              f"fleet_report.py refuses these; effort numbers here pool them.")
    if res.get("graded"):
        gb, gc = res.get("graded_base", 0), res.get("graded_cand", 0)
        print(f"  graded coverage: base {gb}/{res['n_base']}  cand {gc}/{res['n_cand']}")
        if gb == 0 and gc == 0:
            print("  NO GRADED ROWS — this round's fixture emits no grader artifact, so the")
            print("  graded metrics below are absent. Effort metrics are still shown.")
        elif gb < res["n_base"] or gc < res["n_cand"]:
            print("  WARNING: partially graded. The graded rows are a SUBSET and may not be")
            print("  comparable to the full arm — check why the rest are missing before use.")
    if res["n_base"] < 2 or res["n_cand"] < 2:
        print("  too few rows to compare")
        return
    print(f"  {'metric':<20} {'base':>10} {'cand':>10} {'change':>12} {'p':>8}")
    for m in res["metrics"]:
        pct = f"{m['pct']:+.0f}%" if m["pct"] is not None else "n/a"
        star = " *" if m["p"] is not None and m["p"] < 0.05 else ""
        # graded_rate is a fraction; the integer format used for effort counts would
        # print every value as 0 or 1.
        fmt = "10.3f" if m["metric"] == "graded_rate" else "10.0f"
        print(f"  {m['metric']:<20} {m['base_median']:>{fmt}} {m['cand_median']:>{fmt}}"
              f" {pct:>12} {m['p']:>8.3f}{star}")


def sweep(min_rows=8):
    """Re-score every paired round on effort. SHORTLIST GENERATOR, NOT FINDINGS --
    ~7 metrics x ~90 rounds is ~650 comparisons, so low p-values are expected by
    chance alone. Rank by consistency of direction, then confirm with a fresh round."""
    out = []
    for path in sorted(RESULTS.glob("*.jsonl")):
        gen = path.stem
        try:
            data = rows(gen)
        except SystemExit:
            continue
        arms = {r.get("pattern") for r in data}
        if not {"base", "cand"} <= arms or len(data) < min_rows:
            continue
        res = analyse(gen)
        if not res["metrics"]:
            continue
        better = sum(1 for m in res["metrics"] if m["direction"] == "better")
        worse = sum(1 for m in res["metrics"] if m["direction"] == "worse")
        pcts = [m["pct"] for m in res["metrics"] if m["pct"] is not None]
        out.append({
            "gen": gen, "n": len(data), "better": better, "worse": worse,
            "total": len(res["metrics"]),
            "median_pct": median(pcts) if pcts else 0.0,
            "min_p": min((m["p"] for m in res["metrics"] if m["p"] is not None), default=1.0),
        })
    # consistency first (how many metrics agree), then effect size
    out.sort(key=lambda r: (-(r["better"] - r["worse"]), r["median_pct"]))
    print("SHORTLIST ONLY — ~650 comparisons; low p is expected by chance. Confirm before believing.\n")
    print(f"  {'round':<44} {'n':>4} {'agree':>7} {'median':>8} {'min p':>7}")
    for r in out:
        print(f"  {r['gen']:<44} {r['n']:>4} {r['better']:>3}/{r['total']:<3} "
              f"{r['median_pct']:>7.0f}% {r['min_p']:>7.3f}")
    return out


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
    # the approximation path must terminate and agree with exact near the boundary
    big_a = list(range(20)); big_b = list(range(100, 120))
    _, p = mannwhitney_u(big_a, big_b)
    assert p is not None and p < 0.001, p
    _, p = mannwhitney_u(list(range(20)), list(range(20)))
    assert p > 0.9, p
    # exact and approx should roughly agree on the same separated data at n=9
    _, pe = mannwhitney_u(list(range(9)), list(range(50, 59)))
    assert pe < 0.01, pe

    # --- graded outcome ---
    assert graded_rate({"subscores": {"fixed": 5, "total": 8}}) == 0.625
    assert graded_rate({"subscores": {"fixed": 0, "total": 8}}) == 0.0
    assert graded_rate({}) is None                                     # ungraded round
    assert graded_rate({"subscores": {"fixed": 5}}) is None             # no total
    assert graded_rate({"subscores": {"fixed": 5, "total": 0}}) is None  # no div-by-zero
    assert graded_rate({"subscores": "nope"}) is None
    assert dig({"subscores": {"fixed": 5, "total": 8}}, graded_rate) == 0.625
    assert dig({}, graded_rate) is None
    # graded_rate must be flagged higher-is-better; every effort metric is lower-better.
    assert [lb for _, label, lb in GRADED_METRICS if label == "graded_rate"] == [False]
    assert all(lb for _, _, lb in METRICS), "effort metrics are lower-is-better"
    # The discriminating property: partial credit separates two arms that the BINARY
    # gate bit scores identically (all failing). This is the whole point of --graded.
    a = [graded_rate({"subscores": {"fixed": f, "total": 8}}) for f in (1, 1, 2, 2, 1, 2)]
    b = [graded_rate({"subscores": {"fixed": f, "total": 8}}) for f in (6, 7, 6, 7, 6, 7)]
    _, pg = mannwhitney_u(b, a)
    assert pg < 0.01, pg
    # bools must be rejected, matching dig()'s tuple-path rule — isinstance(True, int)
    # is True, so without the explicit check a grader emitting `fixed: true` scores 1/total.
    assert graded_rate({"subscores": {"fixed": True, "total": 8}}) is None
    assert graded_rate({"subscores": {"fixed": 5, "total": True}}) is None
    # --graded and --only-passing must refuse to combine: --only-passing deletes exactly
    # the failing sessions partial credit exists to measure, then reports full coverage.
    try:
        analyse("whatever", only_passing=True, graded=True)
    except SystemExit as exc:
        assert "contradictory" in str(exc), exc
    else:
        raise AssertionError("--graded --only-passing must be refused")
    print("effort_report selftest: OK (exact + normal-approx paths; graded outcome)")


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("gen", nargs="?")
    ap.add_argument("--only-passing", action="store_true")
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--sweep", action="store_true")
    ap.add_argument("--graded", action="store_true",
                    help="lead with the graded outcome (subscores.fixed/total) where the "
                         "fixture's grader emits one; reports coverage explicitly")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()
    if args.selftest:
        selftest()
    elif args.sweep:
        sweep()
    elif not args.gen:
        ap.error("gen is required")
    else:
        res = analyse(args.gen, args.only_passing, graded=args.graded)
        print(json.dumps(res, sort_keys=True)) if args.json else render(res)
