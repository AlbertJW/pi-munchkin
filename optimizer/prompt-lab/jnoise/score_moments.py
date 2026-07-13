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
import json, math, os, sys

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


def score(moments_path, model_tag, out_path, model_ctx):
    n = 0
    with open(out_path, "w") as out:
        for line in open(moments_path):
            mo = json.loads(line)
            d = mo.get("sdir", "").lower()
            tag = ("2B" if "2b" in d else "4B" if "4b" in d else "9B" if "9b" in d
                   else "mellum" if "mellum" in d else "35B" if ("35b" in d or "qwen36" in d) else "other")
            if tag != model_tag:
                continue
            noise = jlens_entropy(mo, model_ctx)
            out.write(json.dumps({"label": mo["label"], "model": tag, "noise": noise}) + "\n")
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


def analyze(scored_path):
    rows = [json.loads(l) for l in open(scored_path) if l.strip()]
    by_model = {}
    for r in rows:
        by_model.setdefault(r["model"], {"CONFAB": [], "CLEAN": []})
        # CONFAB_EXACT folds into CONFAB for the two-class discrimination
        k = "CLEAN" if r["label"] == "CLEAN" else "CONFAB"
        by_model[r["model"]][k].append(r["noise"])
    verdicts = {}
    for model, d in sorted(by_model.items()):
        auc = roc_auc(d["CONFAB"], d["CLEAN"])
        verdicts[model] = {"n_confab": len(d["CONFAB"]), "n_clean": len(d["CLEAN"]),
                           "auc": auc, "verdict": None if auc is None else ("STAGE-c20" if auc >= AUC_BAR else "re-reject")}
    return verdicts


def selftest():
    # separable synthetic: CONFAB noise high, CLEAN low -> AUC ~ 1.0, STAGE
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            for x in [1.9, 2.0, 2.1, 1.95]:
                f.write(json.dumps({"label": "CONFAB", "model": "4B", "noise": x}) + "\n")
            for x in [0.5, 0.6, 0.55, 0.4]:
                f.write(json.dumps({"label": "CLEAN", "model": "4B", "noise": x}) + "\n")
        v = analyze(p)["4B"]
        assert v["auc"] == 1.0 and v["verdict"] == "STAGE-c20", v
    # overlapping -> low AUC -> re-reject
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            for x in [1.0, 1.1, 0.9, 1.05]:
                f.write(json.dumps({"label": "CONFAB", "model": "4B", "noise": x}) + "\n")
            for x in [1.0, 1.1, 0.9, 1.05]:
                f.write(json.dumps({"label": "CLEAN", "model": "4B", "noise": x}) + "\n")
        v = analyze(p)["4B"]
        assert v["auc"] == 0.5 and v["verdict"] == "re-reject", v
    # entropy sanity: uniform top-k = ln k ; a spike ~ 0
    assert abs(topk_entropy([0.0] * 50) - math.log(50)) < 1e-9
    assert topk_entropy([100.0] + [0.0] * 49) < 0.01
    # CONFAB_EXACT folds into CONFAB
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "s.jsonl")
        with open(p, "w") as f:
            f.write(json.dumps({"label": "CONFAB_EXACT", "model": "9B", "noise": 2.0}) + "\n")
            f.write(json.dumps({"label": "CLEAN", "model": "9B", "noise": 0.5}) + "\n")
        assert analyze(p)["9B"]["n_confab"] == 1
    print("score_moments selftest: OK (AUC direction, verdict bar, entropy, EXACT folding)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) > 2 and sys.argv[1] == "analyze":
        for model, v in analyze(sys.argv[2]).items():
            a = "n/a" if v["auc"] is None else f"{v['auc']:.3f}"
            print(f"  {model:8} confab={v['n_confab']:4} clean={v['n_clean']:4}  AUC={a}  -> {v['verdict']}")
    elif len(sys.argv) > 2 and sys.argv[1] == "score":
        raise SystemExit("score: wire jlens_entropy() to the installed jlens-gguf first (see module docstring)")
    else:
        raise SystemExit("usage: score_moments.py analyze <scored.jsonl> | --selftest  (score needs jlens)")
