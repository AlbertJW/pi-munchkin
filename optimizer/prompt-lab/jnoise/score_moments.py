#!/usr/bin/env python3
"""score_moments: read late-layer J-space workspace-noise at the TAG-generation
positions for each labeled moment, then report CONFAB-vs-CLEAN discrimination.

Two stages, split so the ANALYSIS is testable offline without jlens installed:

  1. score   — needs jlens-gguf (a fitted lens + the model GGUF). Teacher-forces
               each moment's prefix+call, reads per-position top-K entropy in the
               late layers, writes {label, model, noise} rows. The jlens call is
               isolated in one function (jlens_entropy) verified at install.
  2. analyze — pure: CSV/JSONL of scored rows -> per-model ROC-AUC + threshold
               sweep + the pre-registered AUC>=0.70 verdict. No deps beyond stdlib.

  ./score_moments.py score   moments.jsonl --model MODELTAG --lens L.gguf --gguf M.gguf -o scored.jsonl
  ./score_moments.py analyze scored.jsonl
  ./score_moments.py --selftest
"""
import collections, json, math, os, sys

# Late-layer window + top-K, matching the community study (L30-34 avg, top-50).
# Overridable because layer count is model-specific (a 4B != the study's setup).
LATE_FRAC = float(os.environ.get("JNOISE_LATE_FRAC", "0.85"))  # last 15% of layers
TOPK = int(os.environ.get("JNOISE_TOPK", "50"))
AUC_BAR = 0.70


def topk_entropy(logits, k=TOPK):
    """Shannon entropy over the softmax of the top-k logits (nats)."""
    xs = sorted(logits, reverse=True)[:k]
    m = max(xs)
    exps = [math.exp(x - m) for x in xs]
    z = sum(exps)
    ps = [e / z for e in exps]
    return -sum(p * math.log(p) for p in ps if p > 0)


# ---- stage 1: jlens boundary (the ONLY part needing the installed tool) --------

def jlens_entropy(moment, model_ctx):
    """RETURNS mean late-layer top-K entropy at the tag positions of this moment.
    model_ctx wraps the jlens-gguf handle (lens + gguf). Implemented against the
    real API at install — the exact call surface (batch eval vs module) is verified
    then. Kept behind this seam so analyze/selftest run without the tool."""
    raise NotImplementedError("wire to jlens-gguf at install; see README verify step")


def model_of(sdir):
    d = (sdir or "").lower()
    return ("2B" if "2b" in d else "4B" if "4b" in d else "9B" if "9b" in d
            else "mellum" if "mellum" in d else "35B" if ("35b" in d or "qwen36" in d) else "other")


def score(moments_path, model_tag, out_path, model_ctx):
    """Carry turn + session + prefix_len alongside noise so analyze can test the
    position/non-independence confounds — noise correlates with confab ONLY if it
    isn't just tracking 'late in a doomed session'. sublabel (CONFAB_COPY vs
    CONFAB_BLIND) passes through so analyze can study the true tag-copy-failure
    population separately from blind invention."""
    n = 0
    with open(out_path, "w") as out:
        for line in open(moments_path):
            mo = json.loads(line)
            if model_of(mo.get("sdir")) != model_tag:
                continue
            noise = jlens_entropy(mo, model_ctx)
            prefix_len = sum(len(c.get("text", "")) for c in mo.get("context", []))
            out.write(json.dumps({"label": mo["label"], "sublabel": mo.get("sublabel"),
                                  "model": model_tag, "noise": noise,
                                  "turn": mo.get("turn"), "session": mo.get("session"),
                                  "prefix_len": prefix_len,
                                  "context_truncated": mo.get("context_truncated")}) + "\n")
            n += 1
    return n


# ---- stage 2: pure analysis ----------------------------------------------------

def roc_auc(pos, neg):
    """AUC via the Mann-Whitney U statistic. pos = CONFAB noise, neg = CLEAN noise;
    higher noise should mean CONFAB, so AUC>0.5 = the signal points the right way."""
    if not pos or not neg:
        return None
    greater = ties = 0
    for a in pos:
        for b in neg:
            if a > b:
                greater += 1
            elif a == b:
                ties += 1
    return (greater + 0.5 * ties) / (len(pos) * len(neg))


def _directional(pos, neg):
    """AUC + honest verdict that treats an INVERTED signal (confab = LOW noise, the
    'confidently wrong' quadrant) as a real detector, not a re-reject. Reports the
    raw AUC and the strength |AUC-0.5|."""
    auc = roc_auc(pos, neg)
    if auc is None:
        return {"auc": None, "strength": None, "direction": None, "verdict": None}
    strength = abs(auc - 0.5) + 0.5  # = max(auc, 1-auc)
    return {"auc": round(auc, 3), "strength": round(strength, 3),
            "direction": "confab-high" if auc >= 0.5 else "confab-LOW(inverted)",
            "verdict": "STAGE-c20" if strength >= AUC_BAR else "re-reject"}


def analyze(scored_path):
    """Per model, bucketed by sublabel where available (CONFAB_COPY / CONFAB_BLIND)
    else falling back to the plain label (backward-compat with pre-sublabel data):

      CONFAB_vs_CLEAN — the PRIMARY claim: does noise separate a genuine tag-COPY
                        failure (the model saw the right tag, typed a different
                        one) from a clean copy? Uses CONFAB_COPY when the corpus
                        has it; falls back to plain CONFAB on old scored files.
      BLIND_vs_CLEAN  — CONFAB_BLIND (no prior tag at all — closer to invention
                        than copy failure) studied SEPARATELY, never merged in.
      EXACT_vs_CLEAN  — CONFAB_EXACT (different tool, no #TAG) — unchanged.
      turn_confound_auc — does turn-number ALONE separate CONFAB_COPY from CLEAN
                        as well as noise does? If so the "signal" is position.
    """
    rows = [json.loads(l) for l in open(scored_path) if l.strip()]
    by_model = {}
    for r in rows:
        key = r.get("sublabel") or r["label"]
        by_model.setdefault(r["model"], collections.defaultdict(list))[key].append(r)
    out = {}
    for model, d in sorted(by_model.items()):
        noise = lambda lab: [r["noise"] for r in d.get(lab, [])]
        turn = lambda lab: [r.get("turn") or 0 for r in d.get(lab, [])]
        res = {"n": {k: len(v) for k, v in d.items()}}
        primary = "CONFAB_COPY" if d.get("CONFAB_COPY") else "CONFAB"  # fallback: pre-sublabel data
        res["CONFAB_vs_CLEAN"] = _directional(noise(primary), noise("CLEAN"))
        if d.get("CONFAB_BLIND"):
            res["BLIND_vs_CLEAN"] = _directional(noise("CONFAB_BLIND"), noise("CLEAN"))
        if d.get("CONFAB_EXACT"):
            res["EXACT_vs_CLEAN"] = _directional(noise("CONFAB_EXACT"), noise("CLEAN"))
        # confound: how well does TURN NUMBER alone separate the classes? If this
        # rivals the noise AUC, the "signal" is position, not confabulation.
        res["turn_confound_auc"] = round(roc_auc(turn(primary), turn("CLEAN")) or 0.5, 3) if noise(primary) else None
        out[model] = res
    return out


def _write(path, rows):
    with open(path, "w") as f:
        for r in rows:
            f.write(json.dumps(r) + "\n")


def mock_noise(moment):
    """Deterministic, content-derived pseudo-noise — NOT jlens, NOT a verdict.
    Exists only to drive real corpus data through score()->analyze() end-to-end
    so the pipeline is proven against real shape (variable context lengths,
    multiple models, sublabels, missing fields) before the actual tool is wired."""
    import hashlib
    h = hashlib.sha1(json.dumps(moment.get("call_args"), sort_keys=True, default=str).encode()).hexdigest()
    return (int(h[:8], 16) % 1000) / 100.0


def shapecheck(moments_path):
    """Mock-score a REAL moments file and run it through analyze() end-to-end.
    Proves the pipeline survives real data (unlike the synthetic selftest
    fixtures) — messy contexts, every model tag, sublabel presence/absence.
    Returns (n_scored, {model: analyze-report})."""
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        scored = os.path.join(td, "mock_scored.jsonl")
        n = 0
        with open(scored, "w") as out:
            for line in open(moments_path):
                mo = json.loads(line)
                prefix_len = sum(len(c.get("text", "")) for c in mo.get("context", []))
                out.write(json.dumps({"label": mo["label"], "sublabel": mo.get("sublabel"),
                                      "model": model_of(mo.get("sdir")), "noise": mock_noise(mo),
                                      "turn": mo.get("turn"), "session": mo.get("session"),
                                      "prefix_len": prefix_len}) + "\n")
                n += 1
        return n, analyze(scored)


def _print_report(report):
    for model, r in report.items():
        print(f"== {model}  n={r['n']}  turn-confound AUC={r['turn_confound_auc']}")
        for study in ("CONFAB_vs_CLEAN", "BLIND_vs_CLEAN", "EXACT_vs_CLEAN"):
            if study in r:
                s = r[study]
                print(f"   {study}: AUC={s['auc']} strength={s['strength']} ({s['direction']}) -> {s['verdict']}")


def selftest():
    import tempfile
    row = lambda lab, noise, turn=1, sub=None: {"label": lab, "sublabel": sub, "model": "4B", "noise": noise, "turn": turn}
    with tempfile.TemporaryDirectory() as td:
        # (1) separable, confab HIGH -> STAGE, direction confab-high (using sublabel)
        p = os.path.join(td, "a.jsonl")
        _write(p, [row("CONFAB", x, 3, "CONFAB_COPY") for x in (1.9, 2.0, 2.1, 1.95)] +
                  [row("CLEAN", x, 3) for x in (0.5, 0.6, 0.55, 0.4)])
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["auc"] == 1.0 and v["direction"] == "confab-high" and v["verdict"] == "STAGE-c20", v

        # (2) INVERTED: confab LOW noise (confidently-wrong quadrant) must STAGE, not re-reject
        p = os.path.join(td, "b.jsonl")
        _write(p, [row("CONFAB", x, sub="CONFAB_COPY") for x in (0.1, 0.2, 0.15)] +
                  [row("CLEAN", x) for x in (0.9, 0.95, 0.85)])
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["auc"] == 0.0 and v["strength"] == 1.0 and "inverted" in v["direction"] and v["verdict"] == "STAGE-c20", v

        # (3) overlapping -> re-reject
        p = os.path.join(td, "c.jsonl")
        _write(p, [row("CONFAB", x, sub="CONFAB_COPY") for x in (1.0, 1.1, 0.9)] + [row("CLEAN", x) for x in (1.0, 1.1, 0.9)])
        assert analyze(p)["4B"]["CONFAB_vs_CLEAN"]["verdict"] == "re-reject"

        # (4) position confound exposed: noise perfectly separates BUT so does turn
        p = os.path.join(td, "d.jsonl")
        _write(p, [row("CONFAB", 2.0, turn=20, sub="CONFAB_COPY") for _ in range(3)] +
                  [row("CLEAN", 0.5, turn=2) for _ in range(3)])
        r = analyze(p)["4B"]
        assert r["CONFAB_vs_CLEAN"]["auc"] == 1.0 and r["turn_confound_auc"] == 1.0, r  # reader sees the confound

        # (5) CONFAB_EXACT and CONFAB_BLIND both reported SEPARATELY from the primary study
        p = os.path.join(td, "e.jsonl")
        _write(p, [row("CONFAB", 2.0, sub="CONFAB_COPY"), row("CONFAB", 1.7, sub="CONFAB_BLIND"),
                   row("CONFAB_EXACT", 1.5), row("CLEAN", 0.5), row("CLEAN", 0.6)])
        r = analyze(p)["4B"]
        assert r["n"]["CONFAB_COPY"] == 1 and r["n"]["CONFAB_BLIND"] == 1 and r["n"]["CONFAB_EXACT"] == 1
        assert "EXACT_vs_CLEAN" in r and "BLIND_vs_CLEAN" in r and r["CONFAB_vs_CLEAN"]["auc"] == 1.0
        # the primary study used ONLY CONFAB_COPY's noise (2.0), not BLIND's (1.7) or EXACT's (1.5)
        assert r["CONFAB_vs_CLEAN"]["auc"] == 1.0, "primary study must isolate CONFAB_COPY"

        # (6) backward compat: scored rows with NO sublabel field (pre-QA-fix data)
        # fall back to the plain CONFAB label as the primary study population.
        p = os.path.join(td, "f.jsonl")
        _write(p, [{"label": "CONFAB", "model": "4B", "noise": 2.0, "turn": 1}] +
                  [{"label": "CLEAN", "model": "4B", "noise": 0.5, "turn": 1}])
        r = analyze(p)["4B"]
        assert r["CONFAB_vs_CLEAN"]["auc"] == 1.0, "legacy rows without sublabel still analyze correctly"

    # entropy sanity: uniform top-k = ln k ; a spike ~ 0
    assert abs(topk_entropy([0.0] * 50) - math.log(50)) < 1e-9
    assert topk_entropy([100.0] + [0.0] * 49) < 0.01
    print("score_moments selftest: OK (direction incl. inverted, verdict bar, turn confound, "
          "COPY/BLIND/EXACT separated, legacy fallback, entropy)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) > 2 and sys.argv[1] == "analyze":
        _print_report(analyze(sys.argv[2]))
    elif len(sys.argv) > 2 and sys.argv[1] == "shapecheck":
        n, report = shapecheck(sys.argv[2])
        print(f"shapecheck: {n} REAL moments mock-scored (noise is content-hash, NOT jlens — plumbing proof only)")
        _print_report(report)
    elif len(sys.argv) > 2 and sys.argv[1] == "score":
        raise SystemExit("score: wire jlens_entropy() to the installed jlens-gguf first (see module docstring)")
    else:
        raise SystemExit("usage: score_moments.py analyze <scored.jsonl> | shapecheck <moments.jsonl> | --selftest")
