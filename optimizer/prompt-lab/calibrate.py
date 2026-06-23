#!/usr/bin/env python3
"""calibrate: prune hard tasks to the discriminating band.

Difficulty is model-specific, so after a gate run on the daily driver, keep only tasks
whose pass-rate has headroom — discard saturated (>85%, no room to improve) and
impossible (<20%, unsolvable/broken). Reads a real_gate results jsonl.

Usage:  calibrate.py <gen> [--pattern base]    # per (model,task) pass-rate + KEEP/drop
        calibrate.py --selftest
"""
import collections, json, os, sys

LAB = os.path.dirname(os.path.abspath(__file__))
SATURATED, IMPOSSIBLE = 0.85, 0.20  # ideal discriminating band ~0.3-0.7

def classify(rate):
    if rate > SATURATED: return "SATURATED (drop — no headroom)"
    if rate < IMPOSSIBLE: return "IMPOSSIBLE (drop — unsolvable/broken?)"
    return "KEEP"

def report(gen, pattern):
    rows = [json.loads(l) for l in open(os.path.join(LAB, "results", gen + ".jsonl")) if l.strip()]
    agg = collections.defaultdict(list)
    for r in rows:
        if r.get("pattern", pattern) == pattern:
            agg[(r.get("model", "?"), r["task"])].append(r["score"])
    print(f"# calibrate {gen} (pattern={pattern}) — keep tasks in the discriminating band\n")
    print("| model | task | pass-rate | n | verdict |")
    print("|---|---|---|---|---|")
    for (m, t) in sorted(agg):
        s = agg[(m, t)]; rate = sum(s) / len(s)
        print(f"| {m} | {t} | {rate:.0%} | {len(s)} | {classify(rate)} |")

def selftest():
    assert classify(1.0).startswith("SATURATED")
    assert classify(0.86).startswith("SATURATED")
    assert classify(0.85) == "KEEP"
    assert classify(0.5) == "KEEP"
    assert classify(0.20) == "KEEP"
    assert classify(0.19).startswith("IMPOSSIBLE")
    assert classify(0.0).startswith("IMPOSSIBLE")
    print("calibrate selftest: OK (saturated / keep-band / impossible)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "cal0")
    pattern = args[args.index("--pattern") + 1] if "--pattern" in args else "base"
    report(gen, pattern)

if __name__ == "__main__":
    main()
