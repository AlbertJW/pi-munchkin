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
    # Band hygiene (audit gap): only validation-split rows may band a task —
    # heldout/robustness rows pooled here would silently distort the verdict.
    dropped_split = [r for r in rows if r.get("split", "val") != "val"]
    rows = [r for r in rows if r.get("split", "val") == "val"]
    agg = collections.defaultdict(list)
    n_auth = 0
    for r in rows:
        if r.get("pattern", pattern) == pattern:
            agg[(r.get("model", "?"), r["task"])].append(r["score"])
            n_auth += 1 if r.get("authoritative") is True else 0
    n_scored = sum(len(v) for v in agg.values())
    print(f"# calibrate {gen} (pattern={pattern}) — keep tasks in the discriminating band\n")
    if dropped_split:
        print(f"(excluded {len(dropped_split)} non-val rows: heldout/robustness never band tasks)\n")
    print("| model | task | pass-rate | n | verdict |")
    print("|---|---|---|---|---|")
    for (m, t) in sorted(agg):
        s = agg[(m, t)]; rate = sum(s) / len(s)
        print(f"| {m} | {t} | {rate:.0%} | {len(s)} | {classify(rate)} |")
    if n_scored:
        label = "ALL AUTHORITATIVE" if n_auth == n_scored else (
            "all exploratory" if n_auth == 0 else f"MIXED: {n_auth}/{n_scored} authoritative")
        print(f"\nrows: {n_scored} scored — {label}"
              + ("" if n_auth == n_scored else " (band verdicts are indicative, not authoritative)"))

def selftest():
    assert classify(1.0).startswith("SATURATED")
    assert classify(0.86).startswith("SATURATED")
    assert classify(0.85) == "KEEP"
    assert classify(0.5) == "KEEP"
    assert classify(0.20) == "KEEP"
    assert classify(0.19).startswith("IMPOSSIBLE")
    assert classify(0.0).startswith("IMPOSSIBLE")
    # split filter + authority label: non-val rows excluded; mixed authority flagged
    import io, tempfile
    from contextlib import redirect_stdout
    with tempfile.TemporaryDirectory() as td:
        gen_dir = os.path.join(td, "results"); os.makedirs(gen_dir)
        rowset = [
            {"model": "m", "task": "t", "pattern": "base", "score": 1, "split": "val", "authoritative": True},
            {"model": "m", "task": "t", "pattern": "base", "score": 0, "split": "val", "authoritative": False},
            {"model": "m", "task": "t", "pattern": "base", "score": 1, "split": "heldout", "authoritative": True},
        ]
        with open(os.path.join(gen_dir, "st.jsonl"), "w") as f:
            for r in rowset: f.write(json.dumps(r) + "\n")
        global LAB
        real_lab = LAB
        LAB = td
        buf = io.StringIO()
        with redirect_stdout(buf):
            report("st", "base")
        LAB = real_lab
        out = buf.getvalue()
        assert "excluded 1 non-val" in out, out
        assert "| 50% | 2 |" in out, out          # heldout row NOT pooled (else 67%/3)
        assert "MIXED: 1/2 authoritative" in out, out
    print("calibrate selftest: OK (bands, split filter, authority label)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "cal0")
    pattern = args[args.index("--pattern") + 1] if "--pattern" in args else "base"
    report(gen, pattern)

if __name__ == "__main__":
    main()
