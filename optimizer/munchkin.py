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

Usage:  munchkin.py [--gen m0] [--rounds 3] [--candidates 2] [--n 4] [--tasks parens,equil,bigdata]
        munchkin.py --dry        # print the session-count estimate, run nothing
        munchkin.py --selftest   # offline loop proof
GPU cost ≈ rounds × candidates × (tasks × n) agentic sessions on the model — keep small.
"""
import glob, hashlib, json, os, re, subprocess, sys, tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
LAB = os.path.join(HERE, "prompt-lab")
PROPOSALS = os.path.join(LAB, "proposals")
RESULTS = os.path.join(LAB, "results")
RUNS = os.path.expanduser(os.environ.get("REAL_GATE_RUNS", "~/.pi/real-gate-runs"))
REAL_GATE = os.path.join(HERE, "real_gate.sh")
TASKS_DIR = os.path.join(HERE, "ab-symbolect", "tasks")
JOURNAL = os.path.join(RESULTS, "munchkin-journal.jsonl")
LIVE_GOV = os.path.expanduser("~/.pi/agent/APPEND_SYSTEM.md")
SATURATED = 0.85
PLATEAU_STOP = 2
JOURNAL_CTX = 24  # prior experiments shown to the proposer
DEFAULT_TASKS = ("parens", "equil", "bigdata")

def robustness_due(gen_label):
    """Every fourth candidate round (r3, r7, ...) gets wording + one-shot controls."""
    match = re.search(r"-r(\d+)-c\d+$", gen_label)
    return bool(match and (int(match.group(1)) + 1) % 4 == 0)

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


def update_manifest(path, names, gen):
    """Lock + atomically replace the shared fleet manifest.

    Parallel model wings used to race a read-modify-write and could lose another
    wing's declarations or leave partial JSON after interruption.
    """
    import fcntl
    path = os.path.abspath(path)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + ".lock", "a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        man = json.load(open(path)) if os.path.exists(path) else {"candidates": {}}
        for name in names:
            man["candidates"].setdefault(name, [])
            if gen not in man["candidates"][name]:
                man["candidates"][name].append(gen)
                man["candidates"][name].sort()
        fd, tmp = tempfile.mkstemp(prefix=".manifest-", suffix=".json", dir=os.path.dirname(path))
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(man, f, indent=1)
                f.write("\n")
                f.flush()
                os.fsync(f.fileno())
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

# ---------- real implementations (NOT exercised in --selftest) ----------

# Per-gate observability: real_gate_one records each gate's wall-clock window; the
# enrich hook counts harness telemetry events (steers/blocks/aborts from the LOCAL
# pi sessions — the model may be remote, the harness always runs here) inside that
# window, so a candidate's prediction is checkable against measured behavior.
GATE_WINDOWS = {}
RUN_IDS = {}  # gen -> unique run id: exact sk joins; a reused gen label no longer inherits stale events
CURRENT_GATE = None  # active real_gate Popen; the signal handler kills it on the way out
TELEMETRY_FILE = os.path.expanduser(os.environ.get("TELEMETRY_FILE", "~/.pi/agent/telemetry/events.jsonl"))

def _utc_z():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def telemetry_enrich(gen):
    """Per-gate mechanism counts. Events carry a session key (sk = workdir basename,
    `$GEN-$RUNID-...` since 2026-07-13) — an EXACT join immune to concurrent runs AND
    to gen-label reuse (a bare `{gen}-` prefix matched stale events from any earlier
    run of the same label — audit 2026-07-13). Events without sk (older data) fall
    back to the gate's wall-clock window."""
    win = GATE_WINDOWS.get(gen)
    runid = RUN_IDS.get(gen)
    sk_prefix = f"{gen}-{runid}-" if runid else f"{gen}-"
    if not os.path.exists(TELEMETRY_FILE):
        return {}
    counts = {}
    for line in open(TELEMETRY_FILE):
        try:
            e = json.loads(line)
        except ValueError:
            continue
        sk = e.get("sk")
        if sk is not None:
            if not sk.startswith(sk_prefix):
                continue
        elif not (win and win[0] <= e.get("ts", "") <= win[1]):  # legacy rows: UTC Z strings, lexical compare
            continue
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

def _validated_canonical_val_rows(rows, tasks, n):
    """Return the exact authoritative, complete canonical val surface or fail closed."""
    expected = {(task, rep) for task in tasks for rep in range(1, n + 1)}
    found = {}
    for r in rows:
        prompt = r.get("prompt")
        if (r.get("pattern") != "base" or r.get("split") != "val"
                or not isinstance(prompt, dict) or prompt.get("variant") != "canonical"):
            continue
        cell = (r.get("task"), r.get("rep"))
        if cell not in expected:
            raise ValueError(f"unexpected canonical val cell: {cell!r}")
        if cell in found:
            raise ValueError(f"duplicate canonical val cell: {cell!r}")
        if r.get("schema") != "pi.eval-row/v2":
            raise ValueError(f"{cell!r}: expected pi.eval-row/v2 row")
        if r.get("authoritative") is not True or r.get("status") != "complete":
            raise ValueError(f"{cell!r}: row is non-authoritative or incomplete")
        if type(r.get("score")) is not int or r["score"] not in (0, 1):
            raise ValueError(f"{cell!r}: malformed score")
        found[cell] = r
    missing = expected - set(found)
    if missing:
        raise ValueError(f"missing canonical val cells: {sorted(missing)!r}")
    return [found[(task, rep)] for task in tasks for rep in range(1, n + 1)]

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
    import uuid
    RUN_IDS[gen] = uuid.uuid4().hex[:6]
    env = {**os.environ, "GEN": gen, "BASE": cfg_path, "N": str(n), "RUNID": RUN_IDS[gen]}
    t0 = _utc_z()
    # Popen (not run) so a signal handler can kill the gate: killing munchkin alone
    # orphans the bash gate, which keeps writing rows into the next run's files
    # (seen live: 22 duplicated (task,rep) rows + workdir rm -rf collisions).
    global CURRENT_GATE
    gate_args = ["bash", REAL_GATE, "--calibrate"]
    if robustness_due(gen):
        gate_args.append("--robustness")
        print(f"[munchkin] {gen}: scheduled fourth-round robustness + one-shot sweep")
    gate_args.extend(tasks)
    CURRENT_GATE = subprocess.Popen(gate_args, env=env, cwd=HERE)
    rc = CURRENT_GATE.wait()
    CURRENT_GATE = None
    GATE_WINDOWS[gen] = (t0, _utc_z())
    if rc != 0:  # aborted gate (server down past HEALTH_WAIT, ^C): never verdict on partial arms
        raise SystemExit(f"[munchkin] gate {gen} aborted (exit {rc}) — fix the server and rerun; no verdict written")
    rows = [json.loads(l) for l in open(out)] if os.path.exists(out) else []
    try:
        base = _validated_canonical_val_rows(rows, tasks, n)
    except ValueError as e:
        raise SystemExit(f"[munchkin] gate {gen} rejected invalid result surface: {e}")
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
        gov_full = None  # None = no replacement; "" is a VALID replacement (empty governor = variant F)
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
            gov = gov_full if gov_full is not None else best["gov"] + ("\n\n" + gov_append.strip() if gov_append.strip() else "")
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
    assert robustness_due("m-r3-c0") and robustness_due("m-r7-c2")
    assert not robustness_due("m-r2-c0") and not robustness_due("m-r0-base")
    assert DEFAULT_TASKS == ("parens", "equil", "bigdata"), DEFAULT_TASKS

    # real-gate authority boundary: count only an exact, authoritative and complete
    # pi.eval-row/v2 canonical val surface; missing/malformed rows fail closed.
    def gate_row(task, rep, **changes):
        row = {"schema": "pi.eval-row/v2", "task": task, "rep": rep,
               "pattern": "base", "split": "val", "prompt": {"variant": "canonical"},
               "authoritative": True, "status": "complete", "score": rep % 2}
        row.update(changes)
        return row

    valid_gate_rows = [gate_row(task, rep) for task in ("t1", "t2") for rep in (1, 2)]
    assert len(_validated_canonical_val_rows(valid_gate_rows, ["t1", "t2"], 2)) == 4

    def rejects(rows, message):
        try:
            _validated_canonical_val_rows(rows, ["t1", "t2"], 2)
        except ValueError as e:
            assert message in str(e), e
        else:
            raise AssertionError(f"gate surface should reject: {message}")

    rejects(valid_gate_rows[:-1], "missing canonical val cells")
    rejects([dict(r, authoritative=False) if r is valid_gate_rows[0] else r
             for r in valid_gate_rows], "non-authoritative or incomplete")
    rejects([dict(r, status="incomplete") if r is valid_gate_rows[0] else r
             for r in valid_gate_rows], "non-authoritative or incomplete")
    rejects([dict(r, prompt="canonical") if r is valid_gate_rows[0] else r
             for r in valid_gate_rows], "missing canonical val cells")
    rejects(valid_gate_rows + [dict(valid_gate_rows[0])], "duplicate canonical val cell")

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

        # empty gov_file = variant F (empty governor override) — "" must not fall back to base gov
        s4 = os.path.join(td, "none.json")
        open(os.path.join(td, "empty.md"), "w").close()
        json.dump({"name": "none", "gov_file": "empty.md"}, open(s4, "w"))
        nc = static_propose([s4])(base, [], 1, 0, [])
        assert nc[0]["gov"] == "", "empty gov_file must yield an EMPTY governor, not the baseline"

        # shared manifest updates merge instead of clobbering prior wings
        mp = os.path.join(td, "manifest.json")
        update_manifest(mp, ["evidence"], "wing-a")
        update_manifest(mp, ["evidence", "cot"], "wing-b")
        man = json.load(open(mp))
        assert man["candidates"] == {"evidence": ["wing-a", "wing-b"], "cot": ["wing-b"]}, man

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
    n = int(opt("--n", "4")); tasks = opt("--tasks", ",".join(DEFAULT_TASKS)).split(",")
    static = opt("--static", "")  # comma-separated candidate spec JSONs -> no frontier needed
    if static:
        paths = [os.path.expanduser(p) for p in static.split(",")]
        rounds = (len(paths) + k - 1) // k  # exactly enough rounds to gate every spec
        # MANIFEST=path: declare this gen's expected candidates up front (audit-3 —
        # fleet_verdict can't know from ledgers what a gen was SUPPOSED to run).
        # Merged, so each wing of a fleet round appends itself to one shared file.
        mpath = os.environ.get("MANIFEST")
        if mpath and "--dry" not in args:  # a dry run must not declare intent it never executes
            names = [json.load(open(p)).get("name", os.path.basename(p)) for p in paths]
            update_manifest(mpath, names, gen)
            print(f"manifest: {mpath} += {names} x {gen}")
    scheduled = sum(1 for r in range(rounds) if (r + 1) % 4 == 0)
    # normal candidate=1 session/cell; scheduled candidate adds 3 prompt variants
    # plus 4 one-shot controls (=7 additional sessions/cell).
    sessions = (1 + rounds * k + scheduled * k * 7) * len(tasks) * n
    print(f"plan: gen={gen} rounds={rounds} candidates={k} n={n} tasks={tasks}")
    print(f"GPU cost estimate: ~{sessions} agentic sessions on the loaded model (each up to {os.environ.get('PI_TIMEOUT','1800')}s).")
    if scheduled:
        print(f"robustness: {scheduled} scheduled candidate round(s), every fourth round")
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
