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

  # score/smoke need the jlens venv python + a running jlens-server:
  #   ~/LLM/jlens-gguf/native/jlens-server -m MODEL.gguf   (port 8091)
  ~/LLM/jlens-gguf/.venv/bin/python score_moments.py smoke   moments.jsonl --lens L.gguf
  ~/LLM/jlens-gguf/.venv/bin/python score_moments.py score   moments.jsonl --model 4B --lens L.gguf -o scored.jsonl
  ./score_moments.py analyze scored.jsonl        # stdlib only
  ./score_moments.py --selftest                  # stdlib only

Corpus note (2026-07-14): the 4B lens was fitted on a local Gutenberg prose corpus
(corpus/pg1342.txt, 100 blocks) because the HF datasets-server rows API (the
port's wikitext default) was persistently 503; same generic-prose role, recorded
as a recipe deviation.
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

JLENS_ROOT = os.path.expanduser(os.environ.get("JLENS_ROOT", "~/LLM/jlens-gguf"))
TAG_IN_CALL_RE = None  # compiled lazily (re import kept local to stdlib-only analyze)


def render_moment(moment):
    """(prompt_text, tag_char_span) — the teacher-forced text and the char span of
    the FIRST emitted tag inside the call. Context renders as a plain role-tagged
    transcript (NOT the exact chat template — a consistent distortion across both
    classes, documented in the study notes)."""
    import re
    global TAG_IN_CALL_RE
    if TAG_IN_CALL_RE is None:
        TAG_IN_CALL_RE = re.compile(r"\[([^\[\]#\n]+)#([0-9A-Za-z\-]+)\]")
    prefix = "".join(f"{c['role']}: {c['text']}\n\n" for c in moment.get("context", []))
    call_input = str((moment.get("call_args") or {}).get("input", ""))
    call_text = f"assistant: edit\n{call_input}"
    m = TAG_IN_CALL_RE.search(call_text)
    if not m:
        return None, None
    start = len(prefix) + m.start(2)  # the TAG itself, not the path
    end = len(prefix) + m.end(2)
    return prefix + call_text, (start, end)


def make_model_ctx(lens_path, native_url="http://127.0.0.1:8091", late_frac=LATE_FRAC):
    """Connect to a running jlens-server (native/jlens-server -m MODEL.gguf) and
    load model readout weights + the fitted lens. Run under the jlens venv python
    (needs numpy/requests/gguf)."""
    sys.path.insert(0, JLENS_ROOT)
    from jlens_gguf.client import NativeClient
    from jlens_gguf.lens import JacobianLensGGUF
    from jlens_gguf.model_reader import ReadoutWeights
    from jlens_gguf.readout import LensReadout
    client = NativeClient(native_url)
    if not client.health():
        raise SystemExit(f"no jlens-server at {native_url} — start: {JLENS_ROOT}/native/jlens-server -m MODEL.gguf")
    model_path = client.props().get("model_path") or client.props().get("model")
    weights = ReadoutWeights.from_gguf(model_path)
    lens = JacobianLensGGUF.load(lens_path)
    readout = LensReadout(weights, lens)
    n_layers = weights.n_layers
    late = [l for l in lens.source_layers if l >= int(late_frac * n_layers)] or [max(lens.source_layers)]
    n_ctx = int(client.props().get("n_ctx", 4096))
    return {"client": client, "readout": readout, "late_layers": late, "n_ctx": n_ctx}


def jlens_entropy(moment, model_ctx):
    """Mean late-layer top-K entropy at the moment's TAG-generation positions.

    Teacher-forces the rendered prompt through jlens-server, maps the tag's char
    span to token positions via the tokenizer's pieces, and reads lens logits at
    the PREDICTION positions (residual at p-1 predicts token p). Returns None when
    the moment has no locatable tag (analyze drops None noise rows upstream)."""
    text, span = render_moment(moment)
    if text is None:
        return None
    client, readout, late = model_ctx["client"], model_ctx["readout"], model_ctx["late_layers"]
    toks = client.tokenize(text, add_special=True)
    # Tag positions by PREFIX TOKENIZATION (audit-2): summing decoded piece lengths
    # breaks on special tokens / byte-fallback replacement chars — offsets silently
    # drift and the entropy gets read at the wrong activations. Tokenizing the exact
    # char prefixes sidesteps reconstruction entirely; a decode-back check validates,
    # a small scan repairs BPE boundary drift, and an unrepairable moment is DROPPED
    # (None), never silently mis-scored.
    tag_str = text[span[0]:span[1]]
    i0 = len(client.tokenize(text[:span[0]], add_special=True))
    i1 = len(client.tokenize(text[:span[1]], add_special=True))
    stats = model_ctx.setdefault("align_stats", {"exact": 0, "fallback": 0, "dropped": 0})

    def _window_has_tag(a, b):
        a, b = max(0, a), min(len(toks), b)
        return b > a and tag_str in client.detokenize(toks[a:b])

    if i1 > i0 and _window_has_tag(i0, i1):
        stats["exact"] += 1
    else:
        hit = next(((i0 + da, i1 + db) for da in (-1, 0, 1, -2, 2, -3, 3) for db in (0, -1, 1, -2, 2, 3)
                    if _window_has_tag(i0 + da, max(i0 + da + 1, i1 + db))), None)
        if hit is None:
            stats["dropped"] += 1
            return None
        i0, i1 = hit[0], max(hit[0] + 1, hit[1])
        stats["fallback"] += 1
    tag_positions = list(range(max(0, i0), min(len(toks), i1)))
    if not tag_positions:
        stats["dropped"] += 1
        return None
    # token-level guard: the char budget under-estimates code-heavy transcripts
    # (~2.5 chars/token), so a prompt can still exceed the server window. Trim
    # from the FRONT — the tag lives at the end (inside the final call).
    n_ctx = model_ctx.get("n_ctx", 4096)
    if len(toks) > n_ctx - 8:
        cut = len(toks) - (n_ctx - 8)
        if tag_positions[0] - cut < 1:
            return None  # tag would fall off — unscoreable, not silently wrong
        toks = toks[cut:]
        tag_positions = [i - cut for i in tag_positions]
    pred_positions = sorted({max(0, i - 1) for i in tag_positions})
    fr = client.forward(toks, capture_layers=late, capture=True)
    ents = []
    for layer in late:
        acts = fr.activations.get(layer)
        if acts is None:
            continue
        for p in pred_positions:
            if p >= len(acts):
                continue
            logits = readout.lens_logits(acts[p], layer)
            ents.append(topk_entropy(sorted(map(float, logits), reverse=True)[:TOPK]))
    return (sum(ents) / len(ents)) if ents else None


def model_of(sdir):
    d = (sdir or "").lower()
    return ("2B" if "2b" in d else "4B" if "4b" in d else "9B" if "9b" in d
            else "mellum" if "mellum" in d else "35B" if ("35b" in d or "qwen36" in d) else "other")


def clean_session_selected(session, mod):
    """Deterministic whole-SESSION selection for CLEAN subsampling (audit-3):
    a moment-order stride systematically picked within-session positions and
    excluded short sessions — hash-selecting sessions keeps session means intact
    and samples the session population uniformly."""
    import hashlib
    if mod <= 1:
        return True
    h = int(hashlib.sha1((session or "?").encode()).hexdigest()[:8], 16)
    return h % mod == 0


def score(moments_path, model_tag, out_path, model_ctx, clean_session_mod=1):
    """Carry turn + session + prefix_len alongside noise so analyze can test the
    position/non-independence confounds. sublabel passes through so analyze can
    study the true tag-copy-failure population separately from blind invention.
    clean_session_mod: CLEAN controls come from the deterministic 1/mod session-hash
    sample (whole sessions, declared before scoring); confab classes score in full.
    Writes `<out>.stats.json` with attempted/scored/dropped PER CLASS (audit-3:
    silent exclusions could differ by class and fake separation — analyze gates
    the verdict on the drop-rate difference)."""
    n = 0
    stats = collections.defaultdict(lambda: {"attempted": 0, "scored": 0, "dropped": 0})
    with open(out_path, "w", buffering=1) as out:  # line-buffered: progress visible mid-run
        for line in open(moments_path):
            mo = json.loads(line)
            if model_of(mo.get("sdir")) != model_tag:
                continue
            if mo["label"] == "CLEAN" and not clean_session_selected(mo.get("session"), clean_session_mod):
                continue  # outside the declared sampling frame — not an exclusion
            key = mo.get("sublabel") or mo["label"]
            stats[key]["attempted"] += 1
            noise = jlens_entropy(mo, model_ctx)
            if noise is None:  # unscoreable (no locatable tag / trim would cut it)
                stats[key]["dropped"] += 1
                continue
            stats[key]["scored"] += 1
            prefix_len = sum(len(c.get("text", "")) for c in mo.get("context", []))
            out.write(json.dumps({"label": mo["label"], "sublabel": mo.get("sublabel"),
                                  "model": model_tag, "noise": noise,
                                  "turn": mo.get("turn"), "session": mo.get("session"),
                                  "prefix_len": prefix_len,
                                  "context_truncated": mo.get("context_truncated")}) + "\n")
            n += 1
    with open(out_path + ".stats.json", "w") as f:
        json.dump({"model": model_tag, "clean_session_mod": clean_session_mod,
                   "classes": dict(stats)}, f, indent=1)
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
    """Per-session mean noise for one class's rows -> {session: mean}."""
    by = collections.defaultdict(list)
    for r in rows:
        by[r.get("session") or "?"].append(r["noise"])
    return {s: sum(v) / len(v) for s, v in by.items()}


def _directional(pos_rows, neg_rows):
    """Session-level directional verdict, audit-2 corrected:

    - CI is on the SIGNED session AUC. The previous CI bootstrapped the FOLDED
      statistic max(AUC, 1-AUC), which is >=0.5 by construction — its lower bound
      clearing 0.5 was near-vacuous as evidence against the null.
    - CLUSTER bootstrap: resample unique SESSIONS; each resampled session brings
      whatever class means it has (one session can contribute BOTH a confab mean
      and a clean mean — independent per-class resampling broke that dependence).
    - Verdict: >=MIN_SESSIONS per class AND the signed 95% CI excludes 0.5 (either
      side — an INVERTED detector still counts) AND strength >= AUC_BAR.
    """
    import random
    mom_auc = roc_auc([r["noise"] for r in pos_rows], [r["noise"] for r in neg_rows])
    if mom_auc is None:
        return {"auc_moment": None, "auc_session": None, "strength": None, "ci95_signed": None,
                "direction": None, "n_sessions": (0, 0), "n_shared_sessions": 0, "verdict": None}
    pos_s = session_means(pos_rows)
    neg_s = session_means(neg_rows)
    sess_auc = roc_auc(list(pos_s.values()), list(neg_s.values()))
    strength = abs(sess_auc - 0.5) + 0.5  # for the pre-registered bar only, never bootstrapped
    sessions = sorted(set(pos_s) | set(neg_s))
    rng = random.Random(0)  # deterministic
    boots = []
    for _ in range(BOOTSTRAP_N):
        bp, bn = [], []
        for _ in sessions:
            s = sessions[rng.randrange(len(sessions))]
            if s in pos_s:
                bp.append(pos_s[s])
            if s in neg_s:
                bn.append(neg_s[s])
        a = roc_auc(bp, bn)
        if a is not None:
            boots.append(a)
    boots.sort()
    ci = (boots[int(0.025 * len(boots))], boots[int(0.975 * len(boots))]) if boots else None
    n_pos, n_neg = len(pos_s), len(neg_s)
    ci_excludes_null = bool(ci) and (ci[0] > 0.5 or ci[1] < 0.5)
    if n_pos < MIN_SESSIONS or n_neg < MIN_SESSIONS:
        verdict = f"UNDERPOWERED (sessions: {n_pos} pos / {n_neg} neg, need >={MIN_SESSIONS} each)"
    else:
        verdict = "STAGE-c20" if strength >= AUC_BAR and ci_excludes_null else "re-reject"
    return {"auc_moment": round(mom_auc, 3), "auc_session": round(sess_auc, 3),
            "strength": round(strength, 3),
            "ci95_signed": [round(ci[0], 3), round(ci[1], 3)] if ci else None,
            "direction": "confab-high" if sess_auc >= 0.5 else "confab-LOW(inverted)",
            "n_sessions": (n_pos, n_neg), "n_shared_sessions": len(set(pos_s) & set(neg_s)),
            "verdict": verdict}


EXCLUSION_MAX_DIFF = float(os.environ.get("JNOISE_EXCLUSION_MAX_DIFF", "0.10"))


def _exclusion_check(stats, primary):
    """(rates_str, biased) — drop-rate difference between the primary class and
    CLEAN. Differential unscoreability can create separation on its own (audit-3);
    a STAGE verdict is replaced by EXCLUSION-BIAS when the gap exceeds 10pp."""
    cls = stats.get("classes", {})
    def rate(k):
        c = cls.get(k, {})
        return (c.get("dropped", 0) / c["attempted"]) if c.get("attempted") else None
    rp, rc = rate(primary), rate("CLEAN")
    if rp is None or rc is None:
        return "exclusions: n/a (no stats for one class)", False
    return (f"drop rates: {primary} {rp:.1%} vs CLEAN {rc:.1%}", abs(rp - rc) > EXCLUSION_MAX_DIFF)


def analyze(scored_path, stats_path=None):
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
    A STAGE verdict additionally requires the per-class drop rates (from the
    score-time stats sidecar `<scored>.stats.json`) to differ by <=10pp between
    the primary class and CLEAN — else EXCLUSION-BIAS (audit-3).
    """
    rows = [json.loads(l) for l in open(scored_path) if l.strip()]
    if stats_path is None and os.path.exists(scored_path + ".stats.json"):
        stats_path = scored_path + ".stats.json"
    stats = json.load(open(stats_path)) if stats_path and os.path.exists(stats_path) else None
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
        if stats and stats.get("model") in (None, model):
            rates, biased = _exclusion_check(stats, primary)
            res["exclusions"] = rates
            if biased and res["CONFAB_vs_CLEAN"]["verdict"] == "STAGE-c20":
                res["CONFAB_vs_CLEAN"]["verdict"] = f"EXCLUSION-BIAS ({rates}) — fix scoreability before staging"
        elif stats is None:
            res["exclusions"] = "no stats sidecar — exclusion gate not evaluated (pre-audit-3 scored file)"
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
        if "exclusions" in r:
            print(f"   {r['exclusions']}")
        for study in ("CONFAB_vs_CLEAN", "BLIND_vs_CLEAN", "EXACT_vs_CLEAN"):
            if study in r:
                s = r[study]
                print(f"   {study}: session AUC={s['auc_session']} (moment {s['auc_moment']}) "
                      f"strength={s['strength']} signed-CI95={s['ci95_signed']} "
                      f"sessions={s['n_sessions']} shared={s['n_shared_sessions']} "
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
        assert v["ci95_signed"] and v["ci95_signed"][0] > 0.5, "signed CI clear of 0.5 above"

        # (2) INVERTED signal (confidently-wrong quadrant), powered -> still STAGE:
        # the SIGNED CI excludes 0.5 from BELOW
        p = os.path.join(td, "b.jsonl")
        _write(p, powered(0.1, 0.9))
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["auc_session"] == 0.0 and v["strength"] == 1.0 and "inverted" in v["direction"] and v["verdict"] == "STAGE-c20", v
        assert v["ci95_signed"][1] < 0.5, "inverted detector: CI below 0.5"

        # (2b) NULL-DATA REGRESSION (audit-2): pure noise, well-powered — the old
        # folded-statistic CI (max(AUC,1-AUC) >= 0.5 by construction) would often
        # bless this; the signed CI must include 0.5 and the verdict must reject.
        import random as _rnd
        _r = _rnd.Random(42)
        p = os.path.join(td, "null.jsonl")
        _write(p, [row("CONFAB", _r.gauss(1.0, 0.3), sub="CONFAB_COPY", sess=f"p{i}") for i in range(30)] +
                  [row("CLEAN", _r.gauss(1.0, 0.3), sess=f"n{i}") for i in range(30)])
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["verdict"] == "re-reject", f"null data must not stage: {v}"
        assert v["ci95_signed"][0] <= 0.5 <= v["ci95_signed"][1], f"signed CI must straddle 0.5 on null: {v['ci95_signed']}"

        # (2c) SHARED SESSIONS (audit-2): one session contributing BOTH classes —
        # cluster bootstrap handles it; n_shared_sessions reported.
        p = os.path.join(td, "shared.jsonl")
        rows_sh = []
        for i in range(24):
            rows_sh.append(row("CONFAB", 2.0 + i * 0.001, sub="CONFAB_COPY", sess=f"s{i}"))
            rows_sh.append(row("CLEAN", 0.5 + i * 0.001, sess=f"s{i}"))  # SAME session
        _write(p, rows_sh)
        v = analyze(p)["4B"]["CONFAB_vs_CLEAN"]
        assert v["n_shared_sessions"] == 24, v["n_shared_sessions"]
        assert v["verdict"] == "STAGE-c20", v

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

    # (9) EXCLUSION-BIAS gate (audit-3): a STAGE-worthy separation whose primary
    # class dropped far more moments than CLEAN must NOT stage.
    with tempfile.TemporaryDirectory() as td:
        p = os.path.join(td, "x.jsonl")
        _write(p, powered(2.0, 0.5))
        with open(p + ".stats.json", "w") as f:
            json.dump({"model": "4B", "classes": {
                "CONFAB_COPY": {"attempted": 48, "scored": 24, "dropped": 24},   # 50% dropped
                "CLEAN": {"attempted": 25, "scored": 24, "dropped": 1}}}, f)     # 4% dropped
        v = analyze(p)["4B"]
        assert v["CONFAB_vs_CLEAN"]["verdict"].startswith("EXCLUSION-BIAS"), v["CONFAB_vs_CLEAN"]["verdict"]
        # same data, balanced drops -> stages normally
        with open(p + ".stats.json", "w") as f:
            json.dump({"model": "4B", "classes": {
                "CONFAB_COPY": {"attempted": 25, "scored": 24, "dropped": 1},
                "CLEAN": {"attempted": 25, "scored": 24, "dropped": 1}}}, f)
        assert analyze(p)["4B"]["CONFAB_vs_CLEAN"]["verdict"] == "STAGE-c20"

    # (10) session-hash CLEAN sampling: whole sessions in or out, deterministic
    kept = {s for s in (f"sess{i}" for i in range(600)) if clean_session_selected(s, 6)}
    kept2 = {s for s in (f"sess{i}" for i in range(600)) if clean_session_selected(s, 6)}
    assert kept == kept2, "deterministic"
    assert 40 <= len(kept) <= 160, f"~1/6 of 600 sessions, got {len(kept)}"
    assert all(clean_session_selected(s, 1) for s in ("a", "b")), "mod=1 keeps everything"

    # entropy sanity: uniform top-k = ln k ; a spike ~ 0
    assert abs(topk_entropy([0.0] * 50) - math.log(50)) < 1e-9
    assert topk_entropy([100.0] + [0.0] * 49) < 0.01
    print("score_moments selftest: OK (session-level verdicts, UNDERPOWERED min-n, clustering guard, "
          "signed cluster CI incl. null regression, direction incl. inverted, turn confound, "
          "COPY/BLIND/EXACT/STALE separated, EXCLUSION-BIAS gate, session-hash sampling, "
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
    elif len(sys.argv) > 2 and sys.argv[1] in ("score", "smoke"):
        def _arg(flag, default=None):
            return sys.argv[sys.argv.index(flag) + 1] if flag in sys.argv else default
        lens = _arg("--lens") or sys.exit("--lens LENS.gguf required")
        url = _arg("--url", "http://127.0.0.1:8091")
        ctx = make_model_ctx(lens, native_url=url)
        print(f"late layers: {ctx['late_layers']}")
        if sys.argv[1] == "smoke":
            # one CONFAB_COPY + one CLEAN moment -> two entropy numbers, no verdict
            picked = {}
            for line in open(sys.argv[2]):
                mo = json.loads(line)
                key = mo.get("sublabel") or mo["label"]
                if key in ("CONFAB_COPY", "CLEAN") and key not in picked and model_of(mo.get("sdir")) == _arg("--model", "4B"):
                    picked[key] = mo
                if len(picked) == 2:
                    break
            for key, mo in picked.items():
                print(f"  {key}: noise={jlens_entropy(mo, ctx)}  (session {mo.get('session', '?')[:40]})")
        else:
            out = _arg("-o") or sys.exit("-o scored.jsonl required")
            n = score(sys.argv[2], _arg("--model", "4B"), out, ctx,
                      clean_session_mod=int(_arg("--clean-session-mod", "1")))
            print(f"scored {n} moments -> {out} (+ .stats.json)")
            print(f"alignment: {ctx.get('align_stats', {})}")
    else:
        raise SystemExit("usage: score_moments.py analyze <scored.jsonl> | shapecheck <moments.jsonl> | "
                         "smoke/score <moments.jsonl> --lens L.gguf [--model 4B] [-o out] | --selftest")
