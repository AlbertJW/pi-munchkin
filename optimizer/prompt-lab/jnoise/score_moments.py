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
# The SESSION is the inference unit (audit 2026-07-13): a doomed session emits many
# confabs + later clean corrections, so moment-level AUC overstates the effective
# sample size. The verdict reads the AUC over per-session mean noise and requires
# MIN_SESSIONS sessions per class — else UNDERPOWERED, never STAGE.
MIN_SESSIONS = int(os.environ.get("JNOISE_MIN_SESSIONS", "20"))
BOOTSTRAP_N = int(os.environ.get("JNOISE_BOOTSTRAP_N", "1000"))


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


def session_means(rows):
    """Per-session mean noise for one class's rows -> [(session, mean)]."""
    by = collections.defaultdict(list)
    for r in rows:
        by[r.get("session") or "?"].append(r["noise"])
    return [(s, sum(v) / len(v)) for s, v in sorted(by.items())]


def _strength(pos, neg):
    auc = roc_auc(pos, neg)
    return None if auc is None else abs(auc - 0.5) + 0.5  # = max(auc, 1-auc)


def _directional(pos_rows, neg_rows):
    """Session-level directional verdict. Moment AUC is reported for reference, but
    the verdict rides on the AUC over PER-SESSION MEAN noise (sessions are the
    independent unit), needs MIN_SESSIONS per class, and carries a bootstrap 95% CI
    on the session-level strength (resampling sessions). An INVERTED signal (confab
    = LOW noise, the confidently-wrong quadrant) counts as a detector."""
    import random
    mom_auc = roc_auc([r["noise"] for r in pos_rows], [r["noise"] for r in neg_rows])
    if mom_auc is None:
        return {"auc_moment": None, "auc_session": None, "strength": None, "ci95": None,
                "direction": None, "n_sessions": (0, 0), "verdict": None}
    pos_s = session_means(pos_rows)
    neg_s = session_means(neg_rows)
    pv, nv = [m for _, m in pos_s], [m for _, m in neg_s]
    sess_auc = roc_auc(pv, nv)
    strength = _strength(pv, nv)
    rng = random.Random(0)  # deterministic
    boots = []
    for _ in range(BOOTSTRAP_N):
        bp = [pv[rng.randrange(len(pv))] for _ in pv]
        bn = [nv[rng.randrange(len(nv))] for _ in nv]
        s = _strength(bp, bn)
        if s is not None:
            boots.append(s)
    boots.sort()
    ci = (boots[int(0.025 * len(boots))], boots[int(0.975 * len(boots))]) if boots else None
    n_pos, n_neg = len(pv), len(nv)
    if n_pos < MIN_SESSIONS or n_neg < MIN_SESSIONS:
        verdict = f"UNDERPOWERED (sessions: {n_pos} pos / {n_neg} neg, need >={MIN_SESSIONS} each)"
    else:
        verdict = "STAGE-c20" if strength >= AUC_BAR and (ci and ci[0] > 0.5) else "re-reject"
    return {"auc_moment": round(mom_auc, 3), "auc_session": round(sess_auc, 3),
            "strength": round(strength, 3), "ci95": [round(ci[0], 3), round(ci[1], 3)] if ci else None,
            "direction": "confab-high" if sess_auc >= 0.5 else "confab-LOW(inverted)",
            "n_sessions": (n_pos, n_neg), "verdict": verdict}


def analyze(scored_path):
    """Per model, bucketed by sublabel where available (CONFAB_COPY / CONFAB_BLIND)
    else falling back to the plain label (backward-compat with pre-sublabel data):

      CONFAB_vs_CLEAN — the PRIMARY claim: does noise separate a genuine tag-COPY
                        failure (the model saw the right tag FOR THE TARGET FILE,
                        typed a different one) from a clean copy? Uses CONFAB_COPY
                        when the corpus has it; falls back to plain CONFAB.
      BLIND_vs_CLEAN  — CONFAB_BLIND (no target-file tag — invention) separate.
      EXACT_vs_CLEAN  — CONFAB_EXACT (different tool, no #TAG) separate.
      STALE           — counted, never studied (not confabulation; audit).
      turn_confound_auc — does turn-number ALONE separate the primary classes as
                        well as noise does? If so the "signal" is position.

    Verdicts are SESSION-level (see _directional): moment AUC is reference only.
    """
    rows = [json.loads(l) for l in open(scored_path) if l.strip()]
    by_model = {}
    for r in rows:
        key = r.get("sublabel") or r["label"]
        by_model.setdefault(r["model"], collections.defaultdict(list))[key].append(r)
    out = {}
    for model, d in sorted(by_model.items()):
        turn = lambda lab: [r.get("turn") or 0 for r in d.get(lab, [])]
        res = {"n": {k: len(v) for k, v in d.items()}}
        primary = "CONFAB_COPY" if d.get("CONFAB_COPY") else "CONFAB"  # fallback: pre-sublabel data
        res["CONFAB_vs_CLEAN"] = _directional(d.get(primary, []), d.get("CLEAN", []))
        if d.get("CONFAB_BLIND"):
            res["BLIND_vs_CLEAN"] = _directional(d["CONFAB_BLIND"], d.get("CLEAN", []))
        if d.get("CONFAB_EXACT"):
            res["EXACT_vs_CLEAN"] = _directional(d["CONFAB_EXACT"], d.get("CLEAN", []))
        # confound: how well does TURN NUMBER alone separate the classes? If this
        # rivals the noise AUC, the "signal" is position, not confabulation.
        res["turn_confound_auc"] = round(roc_auc(turn(primary), turn("CLEAN")) or 0.5, 3) if d.get(primary) else None
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
                print(f"   {study}: session AUC={s['auc_session']} (moment {s['auc_moment']}) "
                      f"strength={s['strength']} CI95={s['ci95']} sessions={s['n_sessions']} "
                      f"({s['direction']}) -> {s['verdict']}")


def selftest():
    import tempfile
    # rows carry a session id — sessions are the inference unit
    row = lambda lab, noise, turn=1, sub=None, sess="s1": {"label": lab, "sublabel": sub, "model": "4B",
                                                           "noise": noise, "turn": turn, "session": sess}

    def powered(pos_noise, neg_noise, n=24, jitter=0.001):
        """n distinct sessions per class, tightly clustered noise around the given levels."""
        rows = []
        for i in range(n):
            rows.append(row("CONFAB", pos_noise + i * jitter, sub="CONFAB_COPY", sess=f"p{i}"))
            rows.append(row("CLEAN", neg_noise + i * jitter, sess=f"n{i}"))
        return rows

    with tempfile.TemporaryDirectory() as td:
        # (1) separable, confab HIGH, powered -> STAGE with session-level verdict
        p = os.path.join(td, "a.jsonl")
        _write(p, powered(2.0, 0.5))
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["auc_session"] == 1.0 and v["direction"] == "confab-high" and v["verdict"] == "STAGE-c20", v
        assert v["ci95"] and v["ci95"][0] > 0.5, "bootstrap CI reported and clear of 0.5"

        # (2) INVERTED signal (confidently-wrong quadrant), powered -> still STAGE
        p = os.path.join(td, "b.jsonl")
        _write(p, powered(0.1, 0.9))
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["auc_session"] == 0.0 and v["strength"] == 1.0 and "inverted" in v["direction"] and v["verdict"] == "STAGE-c20", v

        # (3) UNDERPOWERED: perfect separation on too few sessions must NOT stage —
        # this kills the "four 35B confabs yield a perfect AUC" failure mode (audit).
        p = os.path.join(td, "c.jsonl")
        _write(p, [row("CONFAB", 2.0 + i * 0.01, sub="CONFAB_COPY", sess=f"p{i}") for i in range(4)] +
                  [row("CLEAN", 0.5 + i * 0.01, sess=f"n{i}") for i in range(30)])
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["verdict"].startswith("UNDERPOWERED"), v["verdict"]
        assert v["auc_session"] == 1.0, "AUC still reported for transparency"

        # (4) SESSION CLUSTERING: 60 confab moments from ONE doomed session + 1 from
        # another must count as 2 sessions, not 61 samples — UNDERPOWERED, where the
        # old moment-level AUC would have staged it.
        p = os.path.join(td, "d.jsonl")
        _write(p, [row("CONFAB", 2.0 + i * 0.001, sub="CONFAB_COPY", sess="doomed") for i in range(60)] +
                  [row("CONFAB", 2.1, sub="CONFAB_COPY", sess="p2")] +
                  [row("CLEAN", 0.5 + i * 0.001, sess=f"n{i}") for i in range(30)])
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["n_sessions"][0] == 2, v["n_sessions"]
        assert v["verdict"].startswith("UNDERPOWERED"), v["verdict"]
        assert v["auc_moment"] == 1.0, "moment AUC kept as reference"

        # (5) overlapping, powered -> re-reject (not underpowered, genuinely null)
        p = os.path.join(td, "e.jsonl")
        rows = []
        for i in range(24):
            lv = 1.0 + (i % 3) * 0.1
            rows.append(row("CONFAB", lv, sub="CONFAB_COPY", sess=f"p{i}"))
            rows.append(row("CLEAN", lv, sess=f"n{i}"))
        _write(p, rows)
        assert analyze(p)["4B"]["CONFAB_vs_CLEAN"]["verdict"] == "re-reject"

        # (6) position confound exposed: noise separates BUT so does turn
        p = os.path.join(td, "f.jsonl")
        _write(p, [row("CONFAB", 2.0, turn=20, sub="CONFAB_COPY", sess=f"p{i}") for i in range(3)] +
                  [row("CLEAN", 0.5, turn=2, sess=f"n{i}") for i in range(3)])
        r = analyze(p)["4B"]
        assert r["CONFAB_vs_CLEAN"]["auc_moment"] == 1.0 and r["turn_confound_auc"] == 1.0, r

        # (7) STALE counted, never studied; BLIND/EXACT reported separately from primary
        p = os.path.join(td, "g.jsonl")
        _write(p, [row("CONFAB", 2.0, sub="CONFAB_COPY"), row("CONFAB", 1.7, sub="CONFAB_BLIND"),
                   row("CONFAB_EXACT", 1.5), row("STALE", 1.6), row("CLEAN", 0.5), row("CLEAN", 0.6, sess="s2")])
        r = analyze(p)["4B"]
        assert r["n"]["STALE"] == 1 and not any("STALE" in k for k in r if k.endswith("_vs_CLEAN"))
        assert "EXACT_vs_CLEAN" in r and "BLIND_vs_CLEAN" in r
        assert r["CONFAB_vs_CLEAN"]["auc_moment"] == 1.0, "primary study isolates CONFAB_COPY"

        # (8) backward compat: rows with no sublabel fall back to plain CONFAB
        p = os.path.join(td, "h.jsonl")
        _write(p, [{"label": "CONFAB", "model": "4B", "noise": 2.0, "turn": 1, "session": "a"},
                   {"label": "CLEAN", "model": "4B", "noise": 0.5, "turn": 1, "session": "b"}])
        assert analyze(p)["4B"]["CONFAB_vs_CLEAN"]["auc_moment"] == 1.0

    # entropy sanity: uniform top-k = ln k ; a spike ~ 0
    assert abs(topk_entropy([0.0] * 50) - math.log(50)) < 1e-9
    assert topk_entropy([100.0] + [0.0] * 49) < 0.01
    print("score_moments selftest: OK (session-level verdicts, UNDERPOWERED min-n, clustering guard, "
          "bootstrap CI, direction incl. inverted, turn confound, COPY/BLIND/EXACT/STALE separated, "
          "legacy fallback, entropy)")


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
