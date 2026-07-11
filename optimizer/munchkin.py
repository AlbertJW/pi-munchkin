#!/usr/bin/env python3
"""munchkin: Karpathy-style autoresearch loop over every SAFE harness surface, for ONE
model (the loaded one on :8080 — a model in the discriminating band on the chosen tasks).

Loop, per round: gate the current-best candidate on the in-band agentic tasks → a frontier
model reads the EXPERIMENT JOURNAL (what was tried, what happened) + the failing traces and
proposes K candidates — each may edit the governor text AND/OR move a schema dimension
(format, scaffold, LB_*/VERIFY_GATE_* thresholds) → gate each → adopt the Fisher-significant
winner (fleet_report.classify) → repeat until plateau. Deltas are validated against
prompt-lab/configs/schema.json: only safe, no-relaunch, in-schema values ever run
(decoding/optillm stay deferred: relaunch/structural). HUMAN-GATED: the winner (governor +
config) is written to prompt-lab/proposals/ for review; this NEVER edits the live governor.

The loop is pure + injectable (gate_fn/propose_fn, in-memory journal), so --selftest proves
it offline (no GPU/network). Live run needs llama-server up (:8080) and
FRONTIER_BASE_URL/FRONTIER_API_KEY.

Usage:  munchkin.py [--gen m0] [--rounds 3] [--candidates 2] [--n 4] [--tasks t1,t2,t3]
        munchkin.py --dry        # print the session-count estimate, run nothing
        munchkin.py --selftest   # offline loop proof
GPU cost ≈ rounds × candidates × (tasks × n) agentic sessions on the model — keep small.
"""
import glob, hashlib, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(HERE, "prompt-lab")
PROPOSALS = os.path.join(LAB, "proposals")
RESULTS = os.path.join(LAB, "results")
RUNS = os.path.join(HERE, "real-gate-runs")
REAL_GATE = os.path.join(HERE, "real_gate.sh")
TASKS_DIR = os.path.join(HERE, "ab-symbolect", "tasks")
JOURNAL = os.path.join(RESULTS, "munchkin-journal.jsonl")
LIVE_GOV = os.path.expanduser(os.environ.get(
    "GOVERNOR", os.path.join(HERE, "..", "harness", "APPEND_SYSTEM.md")))
SATURATED = 0.85
PLATEAU_STOP = 2
JOURNAL_CTX = 24  # prior experiments shown to the proposer

def _classify(bk, bn, ck, cn):
    sys.path.insert(0, LAB)
    from fleet_report import classify  # Fisher exact; single-model = this one model's base-vs-cand
    return classify(bk, bn, ck, cn)

def load_schema_dims():
    sys.path.insert(0, LAB)
    from config import load_schema
    return load_schema()["dimensions"]

# ---------- candidates: governor text + safe config dims ----------

def make_cand(gov, delta=None):
    c = {"gov": gov, "format": "md", "scaffold": "none", "thresholds": {}, "messages": {}}
    c.update(delta or {})
    return c

def cand_summary(c):
    return {"format": c["format"], "scaffold": c["scaffold"], "thresholds": c["thresholds"],
            "messages": c.get("messages", {}),
            "gov_sha1": hashlib.sha1(c["gov"].encode()).hexdigest()[:10]}

MSG_MAX_LEN = 400

def sanitize_delta(delta, dims):
    """Keep only SAFE, no-relaunch, in-schema deltas -> (clean, dropped). Anything else
    (decoding, optillm, unknown keys, out-of-schema values) is dropped, never run.
    `messages` is the one freeform dimension: key must be in the schema field list,
    value a control-char-free string <= MSG_MAX_LEN."""
    clean, dropped = {}, []
    for k, v in (delta or {}).items():
        if k in ("format", "scaffold") and v in dims[k]["values"]:
            clean[k] = v
        elif k == "thresholds" and isinstance(v, dict):
            fields = dims["thresholds"]["fields"]
            th = {f: fv for f, fv in v.items() if f in fields and fv in fields[f]}
            if th:
                clean["thresholds"] = th
            dropped += [f"thresholds.{f}" for f in v if f not in th]
        elif k == "messages" and isinstance(v, dict):
            allowed = set(dims["messages"]["fields"])
            ms = {}
            for f, fv in v.items():
                if f in allowed and isinstance(fv, str) and 0 < len(fv) <= MSG_MAX_LEN:
                    ms[f] = "".join(ch for ch in fv if ch == "\n" or ch >= " ")
                else:
                    dropped.append(f"messages.{f}")
            if ms:
                clean["messages"] = ms
        else:
            dropped.append(k)
    return clean, dropped

# ---------- journal (the autoresearch memory) ----------

def journal_tail(k=JOURNAL_CTX):
    if not os.path.exists(JOURNAL):
        return []
    return [json.loads(l) for l in open(JOURNAL) if l.strip()][-k:]

def journal_persist(entries):
    os.makedirs(RESULTS, exist_ok=True)
    with open(JOURNAL, "a") as f:
        for e in entries:
            f.write(json.dumps(e) + "\n")

# ---------- real implementations (NOT exercised in --selftest) ----------

# Per-gate observability: real_gate_one records each gate's wall-clock window; the
# enrich hook counts harness telemetry events (steers/blocks/aborts from the LOCAL
# pi sessions — the model may be remote, the harness always runs here) inside that
# window, so a candidate's prediction is checkable against measured behavior.
GATE_WINDOWS = {}
CURRENT_GATE = None  # active real_gate Popen; the signal handler kills it on the way out
TELEMETRY_FILE = os.path.expanduser(os.environ.get("TELEMETRY_FILE", "~/.pi/agent/telemetry/events.jsonl"))

def _utc_z():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def telemetry_enrich(gen):
    win = GATE_WINDOWS.get(gen)
    if not win or not os.path.exists(TELEMETRY_FILE):
        return {}
    t0, t1 = win
    counts = {}
    for line in open(TELEMETRY_FILE):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        if t0 <= e.get("ts", "") <= t1:  # both are UTC ...Z ISO strings → lexical compare is safe
            key = f"{e.get('ext', '?')}.{e.get('kind', '?')}"
            counts[key] = counts.get(key, 0) + 1
    return {"telemetry": counts} if counts else {}

def server_model():
    import urllib.request
    try:
        base = os.environ.get("LLAMA_URL", "http://127.0.0.1:8080")
        with urllib.request.urlopen(f"{base}/v1/models", timeout=5) as r:
            return json.load(r)["data"][0]["id"]
    except Exception:
        return None

def session_tail(wd, limit=800):
    """Failure trace for the proposer: last assistant text from the run's pi session
    JSONL (headless pi writes nothing to stdout, so run.log is always empty — the
    real trace lives in ~/.pi/agent/sessions). Reuses metrics.session_file_for."""
    try:
        sys.path.insert(0, os.path.join(HERE, "ab-machinery"))
        from metrics import session_file_for
        sf = session_file_for(wd)
        if not sf:
            return ""
        texts = []
        for line in open(sf):
            try:
                m = json.loads(line).get("message") or {}
            except ValueError:
                continue
            if m.get("role") != "assistant":
                continue
            c = m.get("content")
            if isinstance(c, list):
                t = " ".join(b.get("text", "") for b in c if isinstance(b, dict) and b.get("type") == "text").strip()
                if t:
                    texts.append(t)
        return " […] ".join(texts[-3:])[-limit:]
    except Exception:
        return ""

def real_gate_one(cand, tasks, n, gen):
    """Gate one candidate (base config only) → (passes, total, failing_traces)."""
    os.makedirs(PROPOSALS, exist_ok=True)
    gov_path = os.path.join(PROPOSALS, gen + ".gov.md")
    cfg_path = os.path.join(PROPOSALS, gen + ".config.json")
    with open(gov_path, "w") as f:
        f.write(cand["gov"])
    with open(cfg_path, "w") as f:
        json.dump({"prompt_variant": gov_path, "format": cand["format"],
                   "scaffold": cand["scaffold"], "thresholds": cand["thresholds"],
                   "messages": cand.get("messages", {})}, f)
    out = os.path.join(RESULTS, gen + ".jsonl")
    if os.path.exists(out):
        os.remove(out)
    env = {**os.environ, "GEN": gen, "BASE": cfg_path, "N": str(n)}
    t0 = _utc_z()
    # Popen (not run) so a signal handler can kill the gate: killing munchkin alone
    # orphans the bash gate, which keeps writing rows into the next run's files
    # (seen live: 22 duplicated (task,rep) rows + workdir rm -rf collisions).
    global CURRENT_GATE
    CURRENT_GATE = subprocess.Popen(["bash", REAL_GATE, "--calibrate", *tasks], env=env, cwd=HERE)
    rc = CURRENT_GATE.wait()
    CURRENT_GATE = None
    GATE_WINDOWS[gen] = (t0, _utc_z())
    if rc != 0:  # aborted gate (server down past HEALTH_WAIT, ^C): never verdict on partial arms
        raise SystemExit(f"[munchkin] gate {gen} aborted (exit {rc}) — fix the server and rerun; no verdict written")
    rows = [json.loads(l) for l in open(out)] if os.path.exists(out) else []
    base = [r for r in rows if r.get("pattern") == "base"]
    k = sum(r["score"] for r in base)
    failures = []
    for r in base:
        if r["score"] == 0:
            wds = glob.glob(os.path.join(RUNS, f"{gen}-*-base-{r['task']}-{r['rep']}"))
            tail = ""
            if wds:
                tail = session_tail(wds[0])  # real trace: session jsonl (run.log is empty headless)
                if not tail:
                    log = os.path.join(wds[0], "run.log")
                    if os.path.exists(log):
                        tail = "".join(open(log).readlines()[-15:])[-800:]
            failures.append({"task": r["task"], "log_tail": tail})
    return k, len(base), failures

def real_propose(best, failures, k, r, journal):
    sys.path.insert(0, LAB)
    from judge import frontier_call
    from propose import parse_candidates, OPERATORS
    dims = load_schema_dims()
    space = (f"format: {dims['format']['values']}; scaffold: {dims['scaffold']['values']}; "
             f"thresholds: {json.dumps(dims['thresholds']['fields'])}; "
             f"messages (steer-text templates, freeform string <=400 chars, keep {{var}} placeholders): "
             f"{dims['messages']['fields']}")
    hist = "\n".join(
        f"- {e.get('gen','?')}/r{e.get('round','?')} [{e.get('operator','base')}] "
        f"{json.dumps(e.get('config',{}))} -> {e.get('pass','?')} ({e.get('label','?')})"
        for e in journal[-JOURNAL_CTX:]) or "(none yet)"
    fails = "\n\n".join(
        f"TASK {f['task']} (prose: {open(os.path.join(TASKS_DIR, f['task']+'.txt')).read().strip()[:200]})\n"
        f"what the model did (tail):\n{f['log_tail'][:400]}" for f in failures[:6])
    sysmsg = ("You run autoresearch on a coding-agent harness so a small local model completes "
              f"agentic coding tasks. Propose {k} DISTINCT candidates. Each candidate may revise the "
              "system prompt (the 'governor') AND/OR move harness config dimensions. Searchable "
              f"config space (exact allowed values): {space}. Each candidate uses one operator from: "
              f"{', '.join(OPERATORS)}. Keep prompt edits small + general (do not overfit). "
              f"AT LEAST ONE of the {k} candidates must change a config dimension via CONFIG. "
              "Study the prior experiments: build on winners, do not repeat failures.\n"
              "Output each EXACTLY as:\n### CANDIDATE\nOPERATOR: <one>\nRATIONALE: <one line>\n"
              "CONFIG: <single-line JSON delta, or omit this line>\n"
              "--- PROMPT ---\n<the FULL revised governor, or exactly UNCHANGED>\n--- END ---")
    user = (f"CURRENT GOVERNOR (config {json.dumps(cand_summary(best))}):\n```\n{best['gov']}\n```\n\n"
            f"PRIOR EXPERIMENTS:\n{hist}\n\nFAILING TASKS:\n{fails}")
    out = []
    for op, body, delta in parse_candidates(frontier_call(sysmsg, user)):
        clean, dropped = sanitize_delta(delta, dims)
        if dropped:
            print(f"[munchkin] dropped out-of-schema delta keys: {dropped}")
        if body == "UNCHANGED" and not clean:
            continue  # no-op candidate
        c = make_cand(best["gov"] if body == "UNCHANGED" else body, clean)
        c["_op"] = op
        out.append(c)
    return out

def static_propose(spec_paths):
    """--static mode: no frontier — candidates are HAND-AUTHORED spec files served one
    round at a time (pure A/B; the loop still gates, Fisher-classifies, journals, and
    adopts). Each spec is JSON: {"name": ..., "gov_append": <text appended to the
    current-best governor, optional>, <plus any schema delta: format/scaffold/
    thresholds/messages>}. Round r gets specs[r*k:(r+1)*k]."""
    dims = load_schema_dims()
    specs = []
    for p in spec_paths:
        s = json.load(open(p))
        gov_full = ""
        gf = s.pop("gov_file", "")  # full-replacement governor (path relative to the spec)
        if gf:
            gov_full = open(os.path.join(os.path.dirname(os.path.abspath(p)), gf)).read()
        specs.append((s.pop("name", os.path.basename(p)), s.pop("gov_append", ""),
                      s.pop("prediction", ""), gov_full, s))

    def propose(best, failures, k, r, journal):
        out = []
        for name, gov_append, prediction, gov_full, delta in specs[r * k:(r + 1) * k]:
            clean, dropped = sanitize_delta(delta, dims)
            if dropped:
                print(f"[munchkin] {name}: dropped out-of-schema delta keys: {dropped}")
            gov = gov_full if gov_full else best["gov"] + ("\n\n" + gov_append.strip() if gov_append.strip() else "")
            c = make_cand(gov, clean)
            c["_op"] = f"static:{name}"
            c["_pred"] = prediction  # falsifiable claim, checked against telemetry in the journal
            out.append(c)
        return out
    return propose

# ---------- pure loop (selftested) ----------

def optimize(base_cand, tasks, n, rounds, k, gate_fn, propose_fn, gen, journal=None, enrich_fn=None):
    """enrich_fn(gate_gen_label) -> dict: optional per-gate observability (e.g. telemetry
    steer/block counts for the gate window) merged into ledger+journal entries, so a
    candidate's PREDICTION (`_pred`) is checkable against what actually happened."""
    journal = list(journal or [])
    best = base_cand
    bk, bn, failures = gate_fn(best, tasks, n, f"{gen}-r0-base")
    base_obs = enrich_fn(f"{gen}-r0-base") if enrich_fn else {}
    ledger = [{"round": 0, "event": "baseline", "pass": f"{bk}/{bn}", "config": cand_summary(best), **base_obs}]
    journal.append({"gen": gen, "round": 0, "operator": "base",
                    "config": cand_summary(best), "pass": f"{bk}/{bn}", "label": "baseline", **base_obs})
    if bn and bk / bn > SATURATED:
        ledger.append({"event": "stop", "why": f"baseline saturated ({bk}/{bn}) — no headroom"})
        return best, ledger, journal
    plateau = 0
    for r in range(rounds):
        cands = propose_fn(best, failures, k, r, journal)
        scored = []
        for i, cg in enumerate(cands):
            ck, cn, cf = gate_fn(cg, tasks, n, f"{gen}-r{r}-c{i}")
            label, delta = _classify(bk, bn, ck, cn)
            obs = enrich_fn(f"{gen}-r{r}-c{i}") if enrich_fn else {}
            entry = {"round": r, "cand": i, "pass": f"{ck}/{cn}", "label": label,
                     "delta": round(delta, 3), "operator": cg.get("_op", "?"),
                     "prediction": cg.get("_pred", ""),
                     "config": cand_summary(cg), **obs}
            ledger.append(entry)
            journal.append({"gen": gen, **entry})
            scored.append((label, ck, cn, cg, cf))
        winners = [s for s in scored if s[0] == "better"]
        if winners:
            w = max(winners, key=lambda s: s[1] / s[2] if s[2] else 0)
            best, bk, bn, failures = w[3], w[1], w[2], w[4]
            ledger.append({"round": r, "event": "ADOPT", "pass": f"{bk}/{bn}",
                           "config": cand_summary(best)})
            plateau = 0
        else:
            plateau += 1
            ledger.append({"round": r, "event": "no-improvement", "plateau": plateau})
            if plateau >= PLATEAU_STOP:
                ledger.append({"event": "stop", "why": "plateau"})
                break
    return best, ledger, journal

def _write_outputs(gen, best, ledger, base_cand, new_journal):
    os.makedirs(PROPOSALS, exist_ok=True)
    with open(os.path.join(RESULTS, f"munchkin-{gen}.jsonl"), "w") as f:
        for e in ledger:
            f.write(json.dumps(e) + "\n")
    journal_persist(new_journal)
    improved = best != base_cand
    winner_path = os.path.join(PROPOSALS, f"munchkin-{gen}-winner.md")
    if improved:
        with open(winner_path, "w") as f:
            f.write(best["gov"])
        with open(os.path.join(PROPOSALS, f"munchkin-{gen}-winner.config.json"), "w") as f:
            json.dump({k: v for k, v in best.items() if k != "gov" and not k.startswith("_")},
                      f, indent=2)
    return improved, winner_path

# ---------- selftest (offline: no GPU, no network, no journal file I/O) ----------

def selftest():
    live_hash_before = hashlib.sha1(open(LIVE_GOV, "rb").read()).hexdigest() if os.path.exists(LIVE_GOV) else None
    dims = load_schema_dims()

    # schema guard: out-of-schema / unsafe deltas are dropped, in-schema survive
    clean, dropped = sanitize_delta(
        {"format": "yaml", "scaffold": "cot", "decoding": {"TEMP": 0.6},
         "thresholds": {"LB_REPEAT_T1": 99, "LB_STREAK_SOFT": 8}}, dims)
    assert clean == {"scaffold": "cot", "thresholds": {"LB_STREAK_SOFT": 8}}, clean
    assert set(dropped) == {"format", "decoding", "thresholds.LB_REPEAT_T1"}, dropped

    # messages (freeform steer texts): allowed key + sane string survives; unknown
    # key, oversize, and non-string are dropped; control chars stripped
    clean, dropped = sanitize_delta(
        {"messages": {"PI_MSG_LB_T2": "act \x07now: {act}", "PI_MSG_NOPE": "x",
                      "PI_MSG_LB_T3": "y" * 500, "PI_MSG_VG_STEER": 42}}, dims)
    assert clean == {"messages": {"PI_MSG_LB_T2": "act now: {act}"}}, clean
    assert set(dropped) == {"messages.PI_MSG_NOPE", "messages.PI_MSG_LB_T3", "messages.PI_MSG_VG_STEER"}, dropped

    base = make_cand("BASE governor: do the task.")
    seen_journals = []

    def stub_gate(cand, tasks, n, gen):
        # config-only winner: LB_STREAK_SOFT=8 lifts the pass rate; a prompt CAND is neutral
        k = 10 if cand["thresholds"].get("LB_STREAK_SOFT") == 8 else (4 if "CAND" in cand["gov"] else 3)
        return k, 12, [{"task": "t1", "log_tail": "model gave up"}]

    def stub_propose(best, failures, k, r, journal):
        seen_journals.append(list(journal))
        if r == 0:  # a config-only candidate (gov UNCHANGED) + a neutral prompt edit
            return [make_cand(best["gov"], {"thresholds": {"LB_STREAK_SOFT": 8}}),
                    make_cand("governor v1 CAND neutral")]
        return [make_cand(f"governor r{r} CAND a"), make_cand(f"governor r{r} CAND b")]

    best, ledger, journal = optimize(base, ["t1"], 4, rounds=4, k=2,
                                     gate_fn=stub_gate, propose_fn=stub_propose, gen="selftest")
    # (a) the config-only candidate is adopted: gov unchanged, thresholds moved
    assert best["gov"] == base["gov"] and best["thresholds"] == {"LB_STREAK_SOFT": 8}, best
    assert any(e.get("event") == "ADOPT" for e in ledger), "ledger missing ADOPT"
    assert any(e.get("why") == "plateau" for e in ledger), "should stop on plateau"
    # 10/12-vs-3/12 = better; 4/12-vs-3/12 = neutral (Fisher at n=12)
    r0 = [e for e in ledger if e.get("round") == 0 and "label" in e and e["label"] != "baseline"]
    assert any(e["label"] == "better" for e in r0) and any(e["label"] == "neutral" for e in r0), r0
    # (c) journal feedback: round-1 proposer saw the round-0 experiments (baseline + 2 cands)
    assert len(seen_journals[0]) == 1 and seen_journals[0][0]["label"] == "baseline"
    assert len(seen_journals[1]) == 3 and any(e["label"] == "better" for e in seen_journals[1]), \
        [e.get("label") for e in seen_journals[1]]
    assert all("config" in e for e in seen_journals[1]), "journal entries must carry config"
    # (e) static mode: hand-authored specs become candidates, no frontier involved;
    # prediction contract rides along and lands in ledger+journal with enrich data
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        s1 = os.path.join(td, "ev.json"); s2 = os.path.join(td, "cot.json")
        json.dump({"name": "evidence", "gov_append": "RULE X.", "prediction": "fewer loops"}, open(s1, "w"))
        json.dump({"name": "cot", "scaffold": "cot", "decoding": {"TEMP": 0.6}}, open(s2, "w"))
        cands = static_propose([s1, s2])(base, [], 2, 0, [])
        assert len(cands) == 2, cands
        assert cands[0]["gov"].endswith("RULE X.") and cands[0]["_op"] == "static:evidence"
        assert cands[0]["_pred"] == "fewer loops"
        assert cands[1]["scaffold"] == "cot" and "decoding" not in cands[1], "unsafe delta must drop"
        assert static_propose([s1, s2])(base, [], 2, 1, []) == [], "round past specs is empty"

        # gov_file = full-replacement governor (path relative to the spec file)
        s3 = os.path.join(td, "lean.json")
        with open(os.path.join(td, "lean.md"), "w") as f:
            f.write("LEAN RULES ONLY.")
        json.dump({"name": "lean", "gov_file": "lean.md", "prediction": "same pass, fewer tokens"}, open(s3, "w"))
        lc = static_propose([s3])(base, [], 1, 0, [])
        assert lc[0]["gov"] == "LEAN RULES ONLY.", "gov_file must REPLACE, not append"

        def stub_enrich(label):
            return {"telemetry": {"loop-breaker.steer": 2}}
        _, led2, jr2 = optimize(base, ["t1"], 4, rounds=1, k=2,
                                gate_fn=stub_gate, propose_fn=static_propose([s1, s2]),
                                gen="selftest2", journal=[], enrich_fn=stub_enrich)
        cand_entries = [e for e in led2 if "cand" in e]
        assert any(e.get("prediction") == "fewer loops" for e in cand_entries), cand_entries
        assert all(e.get("telemetry") == {"loop-breaker.steer": 2} for e in cand_entries), \
            "enrich observability must land in ledger entries"
        assert all("telemetry" in e for e in jr2 if e.get("label") == "baseline"), "baseline enriched too"

    # (d) human-gate proof: the live governor must be byte-identical (we never write it)
    live_hash_after = hashlib.sha1(open(LIVE_GOV, "rb").read()).hexdigest() if os.path.exists(LIVE_GOV) else None
    assert live_hash_before == live_hash_after, "munchkin must NOT touch the live governor"
    print("munchkin selftest: OK (schema guard; config-only adopt; journal fed back; "
          "neutral ignored; plateau-stops; live governor untouched)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    # Die WITH the gate: pkill'ing munchkin must not orphan the bash gate child
    # (real_gate traps TERM and tears down its own in-flight pi session).
    import signal
    def _reap(signum, _frame):
        if CURRENT_GATE is not None and CURRENT_GATE.poll() is None:
            CURRENT_GATE.terminate()
            try:
                CURRENT_GATE.wait(timeout=10)
            except subprocess.TimeoutExpired:
                CURRENT_GATE.kill()
        sys.exit(128 + signum)
    signal.signal(signal.SIGTERM, _reap)
    signal.signal(signal.SIGINT, _reap)
    def opt(flag, d):
        return args[args.index(flag) + 1] if flag in args else d
    gen = opt("--gen", "m0"); rounds = int(opt("--rounds", "3")); k = int(opt("--candidates", "2"))
    n = int(opt("--n", "4")); tasks = opt("--tasks", "t1,t2,t3").split(",")
    static = opt("--static", "")  # comma-separated candidate spec JSONs -> no frontier needed
    if static:
        paths = [os.path.expanduser(p) for p in static.split(",")]
        rounds = (len(paths) + k - 1) // k  # exactly enough rounds to gate every spec
    sessions = (1 + rounds * k) * len(tasks) * n
    print(f"plan: gen={gen} rounds={rounds} candidates={k} n={n} tasks={tasks}")
    print(f"GPU cost estimate: ~{sessions} agentic sessions on the loaded model (each up to {os.environ.get('PI_TIMEOUT','1800')}s).")
    if "--dry" in args:
        print("(--dry: nothing run)"); return
    if not os.path.exists(LIVE_GOV):
        raise SystemExit(f"governor not found: {LIVE_GOV}")
    base_cand = make_cand(open(LIVE_GOV).read())
    prior = journal_tail()
    print(f"target model = {server_model()}  |  prior journal entries: {len(prior)}")
    propose_fn = static_propose(paths) if static else real_propose
    best, ledger, journal = optimize(base_cand, tasks, n, rounds, k,
                                     real_gate_one, propose_fn, gen, journal=prior,
                                     enrich_fn=telemetry_enrich)
    improved, winner = _write_outputs(gen, best, ledger, base_cand, journal[len(prior):])
    print("\n=== ledger ===")
    for e in ledger:
        print(" ", json.dumps(e))
    if improved:
        print(f"\nWINNER governor → {winner}  (+ .config.json alongside)")
        print("REVIEW both, then apply manually: governor -> cp; config env -> your launcher/env.")
    else:
        print("\nno improvement found — live governor unchanged (as always; munchkin never edits it).")

if __name__ == "__main__":
    main()
