#!/usr/bin/env python3
"""fleet_report: cross-model, significance-aware, cost-aware adoption decision.

Reads a results jsonl tagged with `model` + `split`, compares a baseline variant
vs a candidate across the fleet, and decides using Wilson confidence intervals
(NOT point deltas — a 1-question wobble at n=20 must not flip a verdict):

  per model, classify candidate vs baseline as better / worse / neutral by CI overlap.
  REJECT   if the daily driver significantly regresses (hard gate),
           or any model significantly regresses (do-no-harm),
           or val→held-out gap > 10% (overfit — decide() supports it, but the gate
           currently emits val-only rows; inactive until a real held-out task set
           lands (queued), and the report no longer displays the vacuous column).
  NEUTRAL  if no model significantly changes — within noise; raise n (deep run).
  ADOPT-IF-BUDGET  if there's a significant gain but it costs > the token ceiling.
  ADOPT-TIERED     if smaller models gain and the daily driver is within noise.
  ADOPT-UNIVERSAL  if the daily driver also significantly gains.

Usage:  fleet_report.py <gen> [--baseline A] [--candidate F]
        fleet_report.py --selftest
Env: FLEET_DD (daily driver), FLEET_COST_CEILING (max cand/base token ratio, default 1.5).
"""
import json, math, os, sys

LAB = os.path.dirname(os.path.abspath(__file__))
DD = os.environ.get("FLEET_DD", "qwen36-35b-iq3s")
OVERFIT_GAP = 0.10
COST_CEILING = float(os.environ.get("FLEET_COST_CEILING", "1.5"))
TIERS = {"mellum2-12b-thinking": "small", "qwen36-35b-iq3s": "large"}

def wilson(k, n, z=1.96):
    if n == 0: return (0.0, 0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (p, max(0.0, c - h), min(1.0, c + h))

# ---------- pure decision logic (selftested, no I/O) ----------

ALPHA = float(os.environ.get("FLEET_ALPHA", "0.05"))

def _fisher_greater(a, b, c, d):
    """One-sided Fisher exact: P(cell[0,0] >= a | fixed margins). stdlib only."""
    r1, c1, n = a + b, a + c, a + b + c + d
    hi = min(r1, c1)
    denom = math.comb(n, r1)
    return sum(math.comb(c1, x) * math.comb(n - c1, r1 - x) for x in range(a, hi + 1)) / denom

def classify(bk, bn, ck, cn):
    """Candidate vs baseline by Fisher's exact test (one-sided). Sensitive to real
    effects even at small n, but robust to a 1-of-N wobble — where CI-non-overlap was
    too conservative (a 2/8→7/8 flip read 'neutral'). Returns better/worse/neutral + Δ."""
    a, b, c, d = ck, cn - ck, bk, bn - bk
    delta = (ck / cn if cn else 0.0) - (bk / bn if bn else 0.0)
    if _fisher_greater(a, b, c, d) < ALPHA: return "better", delta
    if _fisher_greater(c, d, a, b) < ALPHA: return "worse", delta
    return "neutral", delta

def decide(stats, cost=None, dd_model=DD, gap=0.0, tiers=TIERS, cost_ceiling=COST_CEILING):
    """stats: {model: (base_k, base_n, cand_k, cand_n)} on the val split.
    cost: (base_tokens, cand_tokens) pooled for the candidate vs baseline, or None.
    gap: candidate val_acc - heldout_acc (overfit signal)."""
    if dd_model not in stats:
        return "REJECT", f"daily driver {dd_model} not evaluated"
    cls = {m: classify(*s) for m, s in stats.items()}
    dd_label, dd_delta = cls[dd_model]
    if dd_label == "worse":
        return "REJECT", f"daily driver {dd_model} significantly regresses ({dd_delta:+.0%}, CIs separate) — hard gate"
    worse = [m for m, (l, _) in cls.items() if l == "worse"]
    if worse:
        return "REJECT", f"{', '.join(worse)} significantly regress(es) — do-no-harm"
    if gap > OVERFIT_GAP:
        return "REJECT", f"val→held-out gap {gap:+.0%} > {OVERFIT_GAP:.0%} (overfit)"
    better = [m for m, (l, _) in cls.items() if l == "better"]
    if not better:
        return "NEUTRAL", "no significant change across the fleet — within noise; raise n (deep run) or try a bigger change"
    if cost and cost[0]:
        ratio = cost[1] / cost[0]
        if ratio > cost_ceiling:
            return "ADOPT-IF-BUDGET", f"significant gain ({', '.join(better)}) but costs {ratio:.1f}× tokens > {cost_ceiling}× ceiling — budget call"
    if dd_label == "better":
        return "ADOPT-UNIVERSAL", f"significant gain incl. daily driver ({', '.join(better)})"
    return "ADOPT-TIERED", f"smaller models gain ({', '.join(better)}), daily driver within noise — apply to smaller tiers only"

# ---------- report ----------

def arm(rows, model, pattern, split):
    """-> (k, n, tokens) for one (model, pattern, split) cell. Tokens = in_tok+out_tok
    when rows carry the explicit fields (post-audit rows), else the historic
    out_chars(+think) — which measured OUTPUT only and was blind to the input-side
    cost the governor work targets (audit 2026-07-13)."""
    sel = [r for r in rows if r.get("model") == model and r["pattern"] == pattern and r.get("split") == split]
    k = sum(r["score"] for r in sel)
    toks = sum((r["in_tok"] + r["out_tok"]) if "in_tok" in r else (r.get("out_chars", 0) + r.get("think_chars", 0))
               for r in sel)
    return k, len(sel), toks

def report(gen, baseline, candidate):
    # Held-out honesty: the always-empty column was removed (audit 2026-07-13); the
    # gap + decide()'s overfit gate REACTIVATE only when real split="heldout" rows
    # exist (real_gate HELDOUT="rle saddle", 2026-07-14) — displayed iff measured.
    path = os.path.join(LAB, "results", gen + ".jsonl")
    rows = [json.loads(l) for l in open(path) if l.strip()]
    models = sorted({r.get("model") for r in rows if r.get("model")})

    lines = [f"# fleet_report {gen} — {candidate} vs {baseline} (daily driver: {DD})\n",
             "| model | tier | base (val) | cand (val) | Δ | sig |", "|---|---|---|---|---|---|"]
    stats, base_tok, cand_tok = {}, 0, 0
    for m in models:
        bk, bn, bt = arm(rows, m, baseline, "val")
        ck, cn, ct = arm(rows, m, candidate, "val")
        if bn == 0 or cn == 0:
            continue
        stats[m] = (bk, bn, ck, cn)
        base_tok += bt; cand_tok += ct
        label, d = classify(bk, bn, ck, cn)
        _, clo, chi = wilson(ck, cn)
        lines.append(f"| {m} | {TIERS.get(m,'?')} | {bk/bn:.0%} (n{bn}) | {ck/cn:.0%} ({clo:.0%}–{chi:.0%}) | "
                     f"{d:+.0%} | {label} |")

    ratio = (cand_tok / base_tok) if base_tok else 1.0
    # per-SUCCESS mean cost (audit-2): total-over-total made a candidate that
    # succeeds MORE OFTEN look more expensive at identical per-success cost
    def _tok(r): return (r["in_tok"] + r["out_tok"]) if "in_tok" in r else (r.get("out_chars", 0) + r.get("think_chars", 0))
    pb = [_tok(r) for r in rows if r["pattern"] == baseline and r["score"] == 1]
    pc = [_tok(r) for r in rows if r["pattern"] == candidate and r["score"] == 1]
    per_success = (sum(pc) / len(pc)) / (sum(pb) / len(pb)) if pb and pc else None

    gap = 0.0
    hv = [r["score"] for r in rows if r["pattern"] == candidate and r.get("split") == "heldout"]
    if hv:
        cv = [r["score"] for r in rows if r["pattern"] == candidate and r.get("split") == "val"]
        gap = (sum(cv) / len(cv) - sum(hv) / len(hv)) if cv else 0.0
        lines += ["", f"val→held-out gap (candidate): {gap:+.0%} on {len(hv)} held-out sessions"]

    verdict, why = decide(stats, cost=(base_tok, cand_tok), gap=gap)
    lines += ["", f"cost (candidate/baseline tokens, all sessions): {ratio:.2f}×",
              f"cost (mean tokens per PASSING session, cand/base): {('%.2fx' % per_success) if per_success else '—'}", "",
              f"## VERDICT: {verdict}", f"{why}"]
    out = "\n".join(lines) + "\n"
    with open(os.path.join(LAB, "results", gen + "-FLEET.md"), "w") as f:
        f.write(out)
    print(out)

# ---------- selftest (no server, no network) ----------

def selftest():
    t = {"mellum2-12b-thinking": "small", "qwen36-35b-iq3s": "large"}
    dd = "qwen36-35b-iq3s"
    # daily driver significantly regresses -> REJECT
    v, _ = decide({dd: (19, 20, 10, 20), "mellum2-12b-thinking": (10, 20, 15, 20)}, tiers=t)
    assert v == "REJECT", v
    # a non-daily model significantly regresses -> REJECT
    v, _ = decide({dd: (18, 20, 19, 20), "mellum2-12b-thinking": (18, 20, 8, 20)}, tiers=t)
    assert v == "REJECT", v
    # significant gain everywhere incl. daily -> UNIVERSAL
    big = {dd: (10, 20, 19, 20), "mellum2-12b-thinking": (10, 20, 19, 20)}
    assert decide(big, tiers=t)[0] == "ADOPT-UNIVERSAL"
    # smaller model gains, daily within noise -> TIERED
    v, _ = decide({dd: (18, 20, 19, 20), "mellum2-12b-thinking": (8, 20, 18, 20)}, tiers=t)
    assert v == "ADOPT-TIERED", v
    # everything within noise (the n=20 +5% case) -> NEUTRAL, not a verdict
    v, _ = decide({dd: (18, 20, 17, 20), "mellum2-12b-thinking": (18, 20, 19, 20)}, tiers=t)
    assert v == "NEUTRAL", v
    # Fisher catches a real flip at small n that CI-non-overlap missed; a 1-of-20 wobble stays noise
    assert classify(2, 8, 7, 8)[0] == "better", "2/8 -> 7/8 is significant (Fisher)"
    assert classify(18, 20, 17, 20)[0] == "neutral", "1-of-20 swing must stay noise"
    # overfit despite a gain -> REJECT
    assert decide(big, gap=0.15, tiers=t)[0] == "REJECT"
    # significant gain but too expensive -> ADOPT-IF-BUDGET
    v, _ = decide(big, cost=(1000, 2000), tiers=t)
    assert v == "ADOPT-IF-BUDGET", v
    # same gain within the cost ceiling -> real adoption
    assert decide(big, cost=(1000, 1200), tiers=t)[0] == "ADOPT-UNIVERSAL"
    print("fleet_report selftest: OK (sig hard-gate, do-no-harm, neutral-band, overfit, cost-ceiling, universal, tiered)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "sql0")
    baseline = args[args.index("--baseline") + 1] if "--baseline" in args else "A"
    candidate = args[args.index("--candidate") + 1] if "--candidate" in args else "F"
    report(gen, baseline, candidate)

if __name__ == "__main__":
    main()
