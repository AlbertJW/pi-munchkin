#!/usr/bin/env python3
"""fleet_report: cross-model, significance-aware, cost-aware adoption decision.

Reads a results jsonl tagged with `model` + `split`, compares a baseline variant
vs a candidate across the fleet, and decides using Wilson confidence intervals
(NOT point deltas — a 1-question wobble at n=20 must not flip a verdict):

  per model, classify candidate vs baseline as better / worse / neutral by CI overlap.
  REJECT   if the daily driver significantly regresses (hard gate),
           or any model significantly regresses (do-no-harm),
           or candidate uplift decays by >10pp from validation to held-out
           (difference-in-differences, never raw accuracy across different tasks).
  NEUTRAL  if no model significantly changes — within noise; raise n (deep run).
  ADOPT-IF-BUDGET  if there's a significant gain but it costs > the token ceiling.
  ADOPT-TIERED     if smaller models gain and the daily driver is within noise.
  ADOPT-UNIVERSAL  if the daily driver also significantly gains.

Usage:  fleet_report.py <gen> [--baseline A] [--candidate F]
        fleet_report.py --selftest
Env: FLEET_DD (daily driver), FLEET_COST_CEILING (max cand/base token ratio, default 1.5).
"""
import collections, json, math, os, sys

LAB = os.path.dirname(os.path.abspath(__file__))
DD = os.environ.get("FLEET_DD", "qwen36-35b-iq3s")
OVERFIT_GAP = 0.10
COST_CEILING = float(os.environ.get("FLEET_COST_CEILING", "1.5"))
TIERS = {"qwen36-35b-iq3s": "large"}

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


def uplift_decay(bvk, bvn, cvk, cvn, bhk, bhn, chk, chn):
    """Validation candidate uplift minus held-out candidate uplift."""
    return ((cvk / cvn) - (bvk / bvn)) - ((chk / chn) - (bhk / bhn))

def decide(stats, cost=None, dd_model=DD, gap=0.0, tiers=TIERS, cost_ceiling=COST_CEILING):
    """stats: {model: (base_k, base_n, cand_k, cand_n)} on the val split.
    cost: (base_tokens, cand_tokens) pooled for the candidate vs baseline, or None.
    gap: max per-model decay in candidate-vs-baseline uplift from validation to
         held-out (difference-in-differences overfit signal)."""
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
        return "REJECT", f"validation→held-out uplift decay {gap:+.0%} > {OVERFIT_GAP:.0%} (overfit)"
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
    """-> (k, n, tokens) for one arm. `tokens` is None unless every row carries
    exact provider usage. Character fallbacks remain useful as health telemetry
    but are dimensionally invalid for a token-budget adoption gate."""
    sel = [r for r in rows if r.get("model") == model and r["pattern"] == pattern and r.get("split") == split]
    k = sum(r["score"] for r in sel)
    exact = bool(sel) and all((r.get("usage") or {}).get("exact", r.get("token_usage_exact")) is True for r in sel)
    toks = sum(r["in_tok"] + r["out_tok"] for r in sel) if exact else None
    return k, len(sel), toks


def integrity_errors(rows, baseline, candidate):
    """Reject stale/partial/duplicated invocations before computing a verdict."""
    errors = []
    is_v2 = any(r.get("schema") == "pi.eval-row/v2" for r in rows)
    if is_v2:
        if any(r.get("schema") != "pi.eval-row/v2" for r in rows):
            errors.append("historical and pi.eval-row/v2 rows cannot be combined")
        for r in rows:
            cell = f"{r.get('model')}/{r.get('task')}/{r.get('pattern')}/rep{r.get('rep')}"
            if not r.get("authoritative") or r.get("status") != "complete":
                errors.append(f"{cell}: row is non-authoritative or incomplete")
            serving = r.get("serving") or {}
            if not serving.get("stable") or (serving.get("pre") or {}).get("status") != "complete" or (serving.get("post") or {}).get("status") != "complete":
                errors.append(f"{cell}: serving fingerprint incomplete or changed during row")
    models = sorted({r.get("model") for r in rows if r.get("model")})
    declarations = {tuple(r.get("fleet_expected_models", [])) for r in rows if r.get("fleet_expected_models")}
    if len(declarations) > 1:
        errors.append("fleet expected-model declarations disagree across rows")
    elif declarations:
        missing_models = sorted(set(next(iter(declarations))) - set(models))
        if missing_models:
            errors.append(f"fleet is missing declared model(s): {', '.join(missing_models)}")
    has_heldout = any(r.get("split") == "heldout" for r in rows)
    for model in models:
        for split in (["val", "heldout"] if has_heldout else ["val"]):
            arms = {}
            for pat in (baseline, candidate):
                arm_rows = [r for r in rows if r.get("model") == model and r.get("pattern") == pat and r.get("split") == split]
                arms[pat] = arm_rows
                if not arm_rows:
                    errors.append(f"{model}/{split}/{pat}: no rows")
                    continue
                cells = collections.Counter((r.get("task"), r.get("rep")) for r in arm_rows)
                dup = [c for c, n in cells.items() if n != 1]
                if dup:
                    errors.append(f"{model}/{split}/{pat}: duplicate cells {dup[:3]}")
                runs = {r.get("run") for r in arm_rows}
                if None in runs or len(runs) != 1:
                    errors.append(f"{model}/{split}/{pat}: rows do not carry one exact run id")
            if all(arms.values()):
                bc = collections.Counter((r["task"], r["rep"]) for r in arms[baseline])
                cc = collections.Counter((r["task"], r["rep"]) for r in arms[candidate])
                if bc != cc:
                    errors.append(f"{model}/{split}: baseline/candidate cell grids differ")
                br = {r.get("run") for r in arms[baseline]}
                cr = {r.get("run") for r in arms[candidate]}
                if br != cr:
                    errors.append(f"{model}/{split}: baseline/candidate came from different invocations")
                if is_v2:
                    bfp = {(r["task"], r["rep"]): (r.get("serving", {}).get("pre") or {}).get("fingerprint_sha256") for r in arms[baseline]}
                    cfp = {(r["task"], r["rep"]): (r.get("serving", {}).get("pre") or {}).get("fingerprint_sha256") for r in arms[candidate]}
                    if bfp != cfp:
                        errors.append(f"{model}/{split}: paired arms have different serving fingerprints")
    return errors


def adoption_rows(rows, baseline, candidate):
    has_v2 = any(r.get("schema") == "pi.eval-row/v2" for r in rows)
    return [r for r in rows if r.get("pattern") in (baseline, candidate)
            and r.get("split") in ("val", "heldout")
            and (not has_v2 or (r.get("prompt") or {}).get("variant") == "canonical")]

def report(gen, baseline, candidate):
    # Held-out honesty: the overfit gate activates only for a complete base+candidate
    # split="heldout" grid (real_gate HELDOUT="rle saddle").
    path = os.path.join(LAB, "results", gen + ".jsonl")
    all_rows = [json.loads(l) for l in open(path) if l.strip()]
    has_v2 = any(r.get("schema") == "pi.eval-row/v2" for r in all_rows)
    # Adoption inference is canonical-only. Robustness and one-shot rows are
    # deliberately excluded so they cannot inflate Fisher sample sizes.
    rows = adoption_rows(all_rows, baseline, candidate)
    models = sorted({r.get("model") for r in rows if r.get("model")})

    problems = []
    if has_v2 and any(r.get("schema") != "pi.eval-row/v2" and r.get("pattern") in (baseline, candidate)
                      and r.get("split") in ("val", "heldout") for r in all_rows):
        problems.append("historical and pi.eval-row/v2 adoption rows cannot be combined")
    if has_v2 and not rows:
        problems.append("no canonical pi.eval-row/v2 adoption rows")
    problems += integrity_errors(rows, baseline, candidate)
    if problems:
        out = (f"# fleet_report {gen} — {candidate} vs {baseline}\n\n"
               "## VERDICT: INCOMPLETE\n" + "\n".join(f"- {p}" for p in problems) + "\n")
        with open(os.path.join(LAB, "results", gen + "-FLEET.md"), "w") as f:
            f.write(out)
        print(out)
        return

    lines = [f"# fleet_report {gen} — {candidate} vs {baseline} (daily driver: {DD})\n",
             "| model | tier | base (val) | cand (val) | Δ | sig |", "|---|---|---|---|---|---|"]
    stats, base_tok, cand_tok, all_cost_exact = {}, 0, 0, True
    for m in models:
        bk, bn, bt = arm(rows, m, baseline, "val")
        ck, cn, ct = arm(rows, m, candidate, "val")
        if bn == 0 or cn == 0:
            continue
        stats[m] = (bk, bn, ck, cn)
        if bt is not None and ct is not None:
            base_tok += bt; cand_tok += ct
        else:
            all_cost_exact = False
        label, d = classify(bk, bn, ck, cn)
        _, clo, chi = wilson(ck, cn)
        lines.append(f"| {m} | {TIERS.get(m,'?')} | {bk/bn:.0%} (n{bn}) | {ck/cn:.0%} ({clo:.0%}–{chi:.0%}) | "
                     f"{d:+.0%} | {label} |")

    ratio = (cand_tok / base_tok) if all_cost_exact and base_tok else None
    # per-SUCCESS mean cost (audit-2): total-over-total made a candidate that
    # succeeds MORE OFTEN look more expensive at identical per-success cost
    def _exact(r): return (r.get("usage") or {}).get("exact", r.get("token_usage_exact")) is True
    def _tok(r): return r["in_tok"] + r["out_tok"]
    pb = [_tok(r) for r in rows if r["pattern"] == baseline and r.get("split") == "val" and r["score"] == 1 and _exact(r)]
    pc = [_tok(r) for r in rows if r["pattern"] == candidate and r.get("split") == "val" and r["score"] == 1 and _exact(r)]
    exact_val = all(_exact(r) for r in rows
                    if r.get("split") == "val" and r.get("pattern") in (baseline, candidate))
    per_success = (sum(pc) / len(pc)) / (sum(pb) / len(pb)) if pb and pc else None

    gap = 0.0
    if any(r.get("split") == "heldout" for r in rows):
        gaps = {}
        for m in stats:
            bk, bn, _ = arm(rows, m, baseline, "val"); ck, cn, _ = arm(rows, m, candidate, "val")
            hbk, hbn, _ = arm(rows, m, baseline, "heldout"); hck, hcn, _ = arm(rows, m, candidate, "heldout")
            gaps[m] = uplift_decay(bk, bn, ck, cn, hbk, hbn, hck, hcn)
        gap = max(gaps.values(), default=0.0)
        lines += ["", "held-out uplift decay (difference-in-differences): " +
                  ", ".join(f"{m} {g:+.0%}" for m, g in gaps.items())]

    cost = (base_tok, cand_tok) if exact_val and all_cost_exact else None
    verdict, why = decide(stats, cost=cost, gap=gap)
    cost_all = f"{ratio:.2f}×" if ratio is not None else "unavailable (provider usage absent; char proxy excluded)"
    lines += ["", f"cost (candidate/baseline exact tokens, validation): {cost_all}",
              f"cost (mean exact tokens per PASSING validation session, cand/base): {('%.2fx' % per_success) if exact_val and per_success else '—'}", "",
              f"## VERDICT: {verdict}", f"{why}"]
    out = "\n".join(lines) + "\n"
    with open(os.path.join(LAB, "results", gen + "-FLEET.md"), "w") as f:
        f.write(out)
    print(out)

# ---------- selftest (no server, no network) ----------

def selftest():
    t = {"small-model": "small", "qwen36-35b-iq3s": "large"}
    dd = "qwen36-35b-iq3s"
    # daily driver significantly regresses -> REJECT
    v, _ = decide({dd: (19, 20, 10, 20), "small-model": (10, 20, 15, 20)}, tiers=t)
    assert v == "REJECT", v
    # a non-daily model significantly regresses -> REJECT
    v, _ = decide({dd: (18, 20, 19, 20), "small-model": (18, 20, 8, 20)}, tiers=t)
    assert v == "REJECT", v
    # significant gain everywhere incl. daily -> UNIVERSAL
    big = {dd: (10, 20, 19, 20), "small-model": (10, 20, 19, 20)}
    assert decide(big, tiers=t)[0] == "ADOPT-UNIVERSAL"
    # smaller model gains, daily within noise -> TIERED
    v, _ = decide({dd: (18, 20, 19, 20), "small-model": (8, 20, 18, 20)}, tiers=t)
    assert v == "ADOPT-TIERED", v
    # everything within noise (the n=20 +5% case) -> NEUTRAL, not a verdict
    v, _ = decide({dd: (18, 20, 17, 20), "small-model": (18, 20, 19, 20)}, tiers=t)
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
    assert abs(uplift_decay(10, 20, 16, 20, 8, 20, 10, 20) - 0.20) < 1e-9
    # Result integrity: one invocation, exact cells passes; duplicates, missing
    # held-out arms, and cross-run arm mixtures fail closed.
    def rr(pat, task, rep, split="val", run="r1"):
        return {"model": dd, "pattern": pat, "task": task, "rep": rep,
                "split": split, "run": run, "score": 1}
    clean = [rr(p, tsk, rep) for tsk in ("a", "b") for rep in (1, 2) for p in ("base", "cand")]
    assert not integrity_errors(clean, "base", "cand")
    assert any("duplicate" in e for e in integrity_errors(clean + [rr("cand", "a", 1)], "base", "cand"))
    cross_run = [dict(r, run="r2") if r["pattern"] == "cand" else r for r in clean]
    assert any("different invocations" in e for e in integrity_errors(cross_run, "base", "cand"))
    partial_held = clean + [rr("cand", "h", 1, "heldout")]
    assert any("heldout/base: no rows" in e for e in integrity_errors(partial_held, "base", "cand"))
    missing_fleet = [dict(r, fleet_expected_models=[dd, "small-model"]) for r in clean]
    assert any("small-model" in e for e in integrity_errors(missing_fleet, "base", "cand"))
    def v2(r, fp="fp"):
        return dict(r, schema="pi.eval-row/v2", authoritative=True, status="complete",
                    prompt={"variant": "canonical"}, serving={"stable": True,
                    "pre": {"status": "complete", "fingerprint_sha256": fp},
                    "post": {"status": "complete", "fingerprint_sha256": fp}})
    clean_v2 = [v2(r) for r in clean]
    assert not integrity_errors(clean_v2, "base", "cand")
    bad_fp = [v2(r, "other") if r["pattern"] == "cand" and r["task"] == "a" and r["rep"] == 1 else v2(r) for r in clean]
    assert any("different serving fingerprints" in e for e in integrity_errors(bad_fp, "base", "cand"))
    incomplete = [dict(v2(r), status="incomplete", authoritative=False) if r is clean[0] else v2(r) for r in clean]
    assert any("non-authoritative" in e for e in integrity_errors(incomplete, "base", "cand"))
    extra = clean_v2 + [dict(clean_v2[0], split="robustness", prompt={"variant": "equivalent-1"}),
                        dict(clean_v2[0], pattern="one-shot", arm="one-shot", split="robustness")]
    assert len(adoption_rows(extra, "base", "cand")) == len(clean_v2), "robustness/control rows inflated adoption"
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
