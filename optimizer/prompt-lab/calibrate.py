#!/usr/bin/env python3
"""calibrate: per (model, task) pass-rate table. DESCRIPTIVE ONLY.

Difficulty is model-specific, so after a base-arm run this prints where each task
sits for that model. Reads a real_gate results jsonl.

RETIRED AS A DECISION RULE (2026-08-21). The 20-85%% band below was a THIRD
admission rule — on the binary bit, never preregistered, and competing with the ONE
rule the reboot charter admits (PREREG_FIXTURE_ADMISSION_2026-08.md, implemented in
admission_rule.py: n=6, coverage >= 5/6, mean graded_rate in [0.20, 0.80], SD >=
0.15, all on the GRADED rate). Two rules that can disagree about the same fixture is
how a fixture gets kept or dropped by whichever was run. The band is still printed,
because seeing the rate is useful, but it decides nothing: `verdict` reads
"descriptive" and admission belongs to admission_rule.py.

Usage:  calibrate.py <gen> [--pattern base]    # per (model,task) pass-rate, descriptive
        calibrate.py --selftest
"""
import collections, json, os, sys

LAB = os.path.dirname(os.path.abspath(__file__))
SATURATED, IMPOSSIBLE = 0.85, 0.20  # descriptive bands, NOT an admission rule

def classify(rate):
    """Where a pass-rate sits. Never an admission verdict — see the module docstring."""
    if rate > SATURATED: return "saturated (descriptive)"
    if rate < IMPOSSIBLE: return "floor (descriptive)"
    return "band (descriptive)"

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
    print(f"# calibrate {gen} (pattern={pattern}) — DESCRIPTIVE pass rates, no admission verdict\n")
    print("# Fixture admission is admission_rule.py (the one preregistered rule, on the")
    print("# GRADED rate). Nothing in this table keeps or drops a fixture.\n")
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
    # Band boundaries are unchanged; only their STATUS is. Nothing here may read as
    # an admission verdict — that is admission_rule.py's, and having two rules that
    # can disagree about the same fixture is the defect this retirement closes.
    assert classify(1.0) == "saturated (descriptive)"
    assert classify(0.86) == "saturated (descriptive)"
    assert classify(0.85) == "band (descriptive)"
    assert classify(0.5) == "band (descriptive)"
    assert classify(0.20) == "band (descriptive)"
    assert classify(0.19) == "floor (descriptive)"
    assert classify(0.0) == "floor (descriptive)"
    for rate in (0.0, 0.19, 0.5, 0.86, 1.0):
        assert not any(word in classify(rate).upper() for word in ("KEEP", "DROP")), classify(rate)
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
