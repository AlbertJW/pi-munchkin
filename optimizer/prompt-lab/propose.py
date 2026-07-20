#!/usr/bin/env python3
"""propose: reflective prompt-tweak generator (borrowed from GEPA + Karpathy autoresearch).

The "what to try next" step — NO DSPy dependency. Reads the failing traces from a
sql_eval run (score=0 rows joined to questions.json for the gold), hands them + the
current prompt to a frontier model, and asks for 1-3 MINIMAL edits, each tagged with
one autoresearch mutation operator. Writes each as a candidate prompt file. You then
A/B them across the fleet:  sql_eval --prompt-file C=proposals/<file>  ->  fleet_report.

Adoption stays MANUAL + statistical (the do-no-harm rule in fleet_report). This only
proposes.

Usage:  propose.py <gen> [--prompt ~/.pi/agent/APPEND_SYSTEM.md] [--n 3] [--max-traces 12] [--distill]
        propose.py --selftest          # no network
Needs FRONTIER_BASE_URL / FRONTIER_API_KEY (reused from judge.py).
"""
import difflib, hashlib, json, os, re, sys

LAB = os.path.dirname(os.path.abspath(__file__))
PROPOSALS = os.path.join(LAB, "proposals")
DEFAULT_PROMPT = os.path.expanduser("~/.pi/agent/APPEND_SYSTEM.md")

OPERATORS = ["add-constraint", "add-negative-example", "restructure",
             "tighten", "remove-bloat", "add-counterexample",
             "tune-threshold", "switch-format", "switch-scaffold"]  # config-space ops (munchkin)
OPERATORS.append("tune-message")

OPERATOR_TARGETS = {
    "add-constraint": "governor", "add-negative-example": "governor",
    "restructure": "governor", "tighten": "governor", "remove-bloat": "governor",
    "add-counterexample": "governor", "tune-threshold": "config",
    "switch-format": "config", "switch-scaffold": "config", "tune-message": "message",
}
CANDIDATE_SCHEMA = "pi.optimizer-candidate/v1"

PROPOSE_SYS = (
    "You are a prompt engineer improving a coding-agent system prompt so a LOCAL LLM "
    "answers more questions correctly. You are shown the current prompt and concrete "
    "FAILING cases (question, expected answer, the model's wrong answer). Propose "
    f"{{n}} DISTINCT minimal edits. Each edit must use exactly one mutation operator from: "
    f"{', '.join(OPERATORS)}. Keep edits SMALL and general (must not overfit to these "
    "specific cases). Output each candidate EXACTLY as:\n"
    "### CANDIDATE\nOPERATOR: <one operator>\nHYPOTHESIS: <one line>\n"
    "MECHANISM: <one line>\nMETRIC: <one metric name>\nDIRECTION: <increase|decrease>\n"
    "FALSIFIER: <concrete observation that disproves this>\nROLLBACK: <concrete rollback condition>\n"
    "CONFIG: <one-leaf JSON delta, or omit>\n"
    "--- PROMPT ---\n<the full revised prompt>\n--- END ---")

# ---------- trace loading ----------

def failing_traces(gen, max_traces):
    rows = [json.loads(l) for l in open(os.path.join(LAB, "results", gen + ".jsonl")) if l.strip()]
    qs = {q["id"]: q for q in json.load(open(os.path.join(LAB, "sql", "questions.json")))}
    out = []
    for r in rows:
        if r.get("score") == 0 and r["task"] in qs:
            q = qs[r["task"]]
            out.append({"question": q["question"], "gold": q["gold_sql"],
                        "wrong": r.get("sql", ""), "model": r.get("model", "?")})
    return out[:max_traces]

def load_gate_rows(gen):
    """Rows from a real-gate round eligible to feed candidate generation:
    schema pi.eval-row*, split "val" ONLY (heldout/robustness rows must never
    contaminate proposals — manifests declare held-out material unavailable),
    authoritative, and complete — the same authority bar fleet_report enforces.
    Tolerates the sql-row shape by filtering on schema."""
    path = os.path.join(LAB, "results", gen + ".jsonl")
    if not os.path.exists(path):
        return []
    rows = [json.loads(l) for l in open(path) if l.strip()]
    return [r for r in rows
            if str(r.get("schema", "")).startswith("pi.eval-row")
            and r.get("split") == "val"
            and r.get("authoritative") is True
            and r.get("status") == "complete"]

def distill_evidence(rows, max_bytes=4096):
    """Bounded, deterministic evidence pack distilled from gate rows: aggregate
    signals only (pass rates, failure clusters, winner-vs-loser deltas) — never
    raw session text, so nothing model-generated leaks into candidate prompts.
    Winners = passing rows in the cheapest tercile (turns + tool_errors)."""
    def traj(r, k):
        v = (r.get("trajectory") or {}).get(k)
        return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None
    def surface(r, keys):
        node = ((r.get("context") or {}).get("surface")) or {}
        for k in keys:
            node = node.get(k) if isinstance(node, dict) else None
        return node if isinstance(node, (int, float)) and not isinstance(node, bool) else None
    def mean(vals):
        vals = [v for v in vals if v is not None]
        return sum(vals) / len(vals) if vals else None

    lines = [f"rows={len(rows)}"]
    cells = {}
    for r in rows:
        key = (str(r.get("task")), str(r.get("arm")))
        cells.setdefault(key, [0, 0])
        cells[key][1] += 1
        if r.get("score") == 1:
            cells[key][0] += 1
    lines.append("PASS RATES (task/arm):")
    for task, arm in sorted(cells):
        p, t = cells[(task, arm)]
        lines.append(f"  {task}/{arm}: {p}/{t}")

    losers = [r for r in rows if r.get("score") == 0]
    cost = lambda r: (traj(r, "turns") or 0) + (traj(r, "tool_errors") or 0)

    cluster = {}
    for r in losers:
        keys = []
        if r.get("status") not in (None, "complete"):
            keys.append(f"status={r.get('status')}")
        if (traj(r, "tool_errors") or 0) >= 3:
            keys.append("high_tool_errors(>=3)")
        if (traj(r, "repeat_reads") or 0) > 0:
            keys.append("repeat_reads>0")
        if (traj(r, "compactions") or 0) > 0:
            keys.append("compactions>0")
        for k in keys:
            cluster[k] = cluster.get(k, 0) + 1
    lines.append(f"LOSER CLUSTERS ({len(losers)} failing rows):")
    for k in sorted(cluster):
        lines.append(f"  {k}: {cluster[k]}")

    # Matched comparison ONLY: a global cheapest-tercile-vs-all-losers pool
    # lets task difficulty and arm mix masquerade as mechanism movement. Each
    # (task, arm) cell that has BOTH passes and failures contributes one
    # winners-minus-losers delta per metric; cells without both sides are out.
    metrics = (
        ("turns", lambda r: traj(r, "turns")),
        ("tool_errors", lambda r: traj(r, "tool_errors")),
        ("repeat_reads", lambda r: traj(r, "repeat_reads")),
        ("exact_dup_share", lambda r: surface(r, ("duplication", "exact_block", "mean"))),
        ("near_dup_share", lambda r: surface(r, ("duplication", "near_block", "mean"))),
        ("stale_result_share", lambda r: surface(r, ("stale_tool_result", "mean"))),
    )
    by_cell = {}
    for r in rows:
        by_cell.setdefault((str(r.get("task")), str(r.get("arm"))), []).append(r)
    deltas = {name: [] for name, _ in metrics}
    matched_cells = 0
    for key in sorted(by_cell):
        cell_passes = [r for r in by_cell[key] if r.get("score") == 1]
        cell_fails = [r for r in by_cell[key] if r.get("score") == 0]
        if not cell_passes or not cell_fails:
            continue
        matched_cells += 1
        cheap = sorted(cell_passes, key=cost)[:max(1, len(cell_passes) // 3)]
        for name, fn in metrics:
            w, l = mean([fn(r) for r in cheap]), mean([fn(r) for r in cell_fails])
            if w is not None and l is not None:
                deltas[name].append(w - l)
    lines.append(f"MATCHED WINNER-LOSER DELTAS (same task+arm; matched_cells={matched_cells}):")
    for name, _ in metrics:
        values = deltas[name]
        if values:
            lines.append(f"  {name}: mean_delta={sum(values) / len(values):+.3f} over {len(values)} cell(s)")

    out, size = [], 0
    for line in lines:
        b = len(line.encode()) + 1
        if size + b > max_bytes:
            out.append("...[truncated]")
            break
        out.append(line)
        size += b
    return "\n".join(out)

def build_user(prompt_text, traces):
    blocks = "\n\n".join(
        f"FAIL {i+1} (model {t['model']}):\n  Q: {t['question']}\n  expected: {t['gold']}\n  got: {t['wrong']}"
        for i, t in enumerate(traces))
    return f"CURRENT PROMPT:\n```\n{prompt_text}\n```\n\nFAILING CASES:\n{blocks}"

# ---------- parsing (selftested) ----------

def parse_candidates(reply):
    """-> [(operator, prompt_body, config_delta)] for each well-formed ### CANDIDATE block.
    CONFIG is an optional single-line JSON delta over harness dims (munchkin validates it
    against the schema). PROMPT may be exactly 'UNCHANGED' for a config-only candidate —
    but UNCHANGED with no delta is a no-op and dropped."""
    out = []
    for chunk in reply.split("### CANDIDATE")[1:]:
        op = re.search(r"OPERATOR:\s*([a-z-]+)", chunk, re.I)
        body = re.search(r"--- PROMPT ---\s*(.*?)\s*--- END ---", chunk, re.S)
        cfg = re.search(r"^CONFIG:\s*(\{.*\})\s*$", chunk, re.M)
        delta = {}
        if cfg:
            try:
                delta = json.loads(cfg.group(1))
            except ValueError:
                delta = {}
        if not (op and body):
            continue
        opv, bodyv = op.group(1).lower(), body.group(1).strip()
        if opv not in OPERATORS or not bodyv:
            continue
        if bodyv == "UNCHANGED" and not delta:
            continue
        out.append((opv, bodyv, delta))
    return out

def _field(chunk, name):
    match = re.search(rf"^{name}:\s*(.+?)\s*$", chunk, re.M | re.I)
    return match.group(1).strip() if match else ""

def _leaf_changes(delta, prefix=""):
    leaves = []
    for key, value in sorted((delta or {}).items()):
        path = f"{prefix}.{key}" if prefix else key
        if isinstance(value, dict):
            leaves.extend(_leaf_changes(value, path))
        else:
            leaves.append((path, value))
    return leaves

def _contiguous_prompt_diff(parent, candidate):
    groups = list(difflib.SequenceMatcher(a=parent.splitlines(), b=candidate.splitlines()).get_grouped_opcodes(0))
    return len(groups) == 1

def _merge_config(baseline, delta):
    merged = json.loads(json.dumps(baseline or {}))
    for key, value in (delta or {}).items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _merge_config(merged[key], value)
        else:
            merged[key] = value
    return merged

def _surface_hash(prompt, config):
    payload = json.dumps({"governor": prompt, "config": config}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode()).hexdigest()

def candidate_manifest(parent_prompt, operator, body, delta, provenance):
    """Build and validate one causally-interpretable candidate.

    Returns (manifest, rejection). Rejections are journal-ready and never expose
    held-out data; accepted candidates change exactly one declared surface.
    """
    errors = []
    if not body:
        errors.append("missing candidate prompt body")
    leaves = _leaf_changes(delta)
    prompt_changed = body != "UNCHANGED" and body != parent_prompt
    message_leaves = [leaf for leaf in leaves if leaf[0].startswith("messages.")]
    config_leaves = [leaf for leaf in leaves if not leaf[0].startswith("messages.")]
    if operator not in OPERATORS:
        errors.append("unknown operator")
    target = "governor" if prompt_changed else "message" if message_leaves else "config" if config_leaves else "none"
    if prompt_changed and leaves:
        errors.append("mixed prompt/config mutation")
    elif prompt_changed and not _contiguous_prompt_diff(parent_prompt, body):
        errors.append("governor mutation is not one contiguous diff")
    elif message_leaves and (config_leaves or len(message_leaves) != 1):
        errors.append("message candidate must change exactly one message-template leaf")
    elif config_leaves and len(config_leaves) != 1:
        errors.append("config candidate must change exactly one leaf")
    elif not prompt_changed and not leaves:
        errors.append("no-op candidate")
    baseline_config = provenance.get("baseline_config") or {}
    candidate_config = _merge_config(baseline_config, delta)
    if not prompt_changed and leaves and candidate_config == baseline_config:
        errors.append("no-op candidate")
    if operator in OPERATOR_TARGETS and target != "none" and OPERATOR_TARGETS[operator] != target:
        errors.append(f"operator {operator} is registered for {OPERATOR_TARGETS[operator]}, not {target}")
    required = ("parent_id", "hypothesis", "mechanism", "predicted_metric", "direction",
                "falsifier", "rollback_condition", "validation_traces")
    for field in required:
        if not provenance.get(field):
            errors.append(f"missing provenance: {field}")
    if provenance.get("direction") not in ("increase", "decrease"):
        errors.append("direction must be increase or decrease")
    candidate_prompt = parent_prompt if body == "UNCHANGED" else body
    baseline_hash = _surface_hash(parent_prompt, baseline_config)
    candidate_hash = _surface_hash(candidate_prompt, candidate_config)
    candidate_id = "cand-" + hashlib.sha256(
        f"{provenance.get('parent_id','')}\0{operator}\0{candidate_hash}".encode()).hexdigest()[:16]
    manifest = {
        "schema": CANDIDATE_SCHEMA,
        "candidate_id": candidate_id,
        "parent_id": provenance.get("parent_id"),
        "operator": operator,
        "target_surface": target,
        "hypothesis": provenance.get("hypothesis"),
        "proposed_mechanism": provenance.get("mechanism"),
        "predicted_mechanism_metric": provenance.get("predicted_metric"),
        "predicted_direction": provenance.get("direction"),
        "falsifier": provenance.get("falsifier"),
        "rollback_condition": provenance.get("rollback_condition"),
        "baseline_surface_sha256": baseline_hash,
        "candidate_surface_sha256": candidate_hash,
        "validation_traces": list(provenance.get("validation_traces") or []),
        "held_out_material_available": False,
        "mutation": {"prompt": prompt_changed, "leaves": [path for path, _ in leaves]},
        "status": "rejected" if errors else "proposed",
        "rejection_reasons": errors,
    }
    return (None, manifest) if errors else (manifest, None)

def parse_candidate_manifests(reply, parent_prompt, parent_id, validation_traces, baseline_config=None):
    accepted, rejected = [], []
    for chunk in reply.split("### CANDIDATE")[1:]:
        op = _field(chunk, "OPERATOR").lower()
        body_match = re.search(r"--- PROMPT ---\s*(.*?)\s*--- END ---", chunk, re.S)
        cfg = re.search(r"^CONFIG:\s*(\{.*\})\s*$", chunk, re.M)
        try:
            delta = json.loads(cfg.group(1)) if cfg else {}
        except ValueError:
            delta = {"__invalid_json__": True}
        body = body_match.group(1).strip() if body_match else ""
        provenance = {
            "parent_id": parent_id,
            "hypothesis": _field(chunk, "HYPOTHESIS"),
            "mechanism": _field(chunk, "MECHANISM"),
            "predicted_metric": _field(chunk, "METRIC"),
            "direction": _field(chunk, "DIRECTION").lower(),
            "falsifier": _field(chunk, "FALSIFIER"),
            "rollback_condition": _field(chunk, "ROLLBACK"),
            "validation_traces": validation_traces,
            "baseline_config": baseline_config or {},
        }
        manifest, rejection = candidate_manifest(parent_prompt, op, body, delta, provenance)
        record = {"operator": op, "body": body, "delta": delta, "manifest": manifest or rejection}
        (accepted if manifest else rejected).append(record)
    return accepted, rejected

def append_candidate_journal(records, path=None):
    path = path or os.path.join(PROPOSALS, "candidate-journal.jsonl")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "a") as stream:
        for record in records:
            stream.write(json.dumps(record["manifest"], sort_keys=True, separators=(",", ":")) + "\n")

def record_candidate_outcome(manifest, observed_metric, admitted, path=None):
    row = dict(manifest)
    row["observed_mechanism_metric"] = observed_metric
    row["predicted_direction_confirmed"] = admitted
    row["status"] = "admitted" if admitted else "rejected-after-validation"
    append_candidate_journal([{"manifest": row}], path)

def write_candidates(gen, cands, out_dir=PROPOSALS):
    os.makedirs(out_dir, exist_ok=True)
    paths = []
    for i, cand in enumerate(cands):
        if isinstance(cand, dict):
            op, body, manifest = cand["operator"], cand["body"], cand.get("manifest")
        else:
            op, body, _delta = cand
            manifest = None
        p = os.path.join(out_dir, f"{gen}-{i+1}-{op}.md")
        with open(p, "w") as f:
            f.write(body + "\n")
        paths.append(p)
        if manifest:
            with open(p + ".candidate.json", "w") as f:
                json.dump(manifest, f, indent=2, sort_keys=True); f.write("\n")
    return paths

# ---------- run ----------

def run(gen, prompt_path, n, max_traces, distill=False):
    from judge import frontier_call  # reuse the frontier endpoint plumbing
    prompt_text = open(prompt_path).read()
    if distill:
        rows = load_gate_rows(gen)
        if not rows:
            print(f"no gate rows in results/{gen}.jsonl — nothing to distill"); return
        evidence = distill_evidence(rows)
        user = (f"CURRENT PROMPT:\n```\n{prompt_text}\n```\n\n"
                f"EVIDENCE PACK (aggregated from {len(rows)} gate sessions):\n{evidence}")
        # provenance must cover EVERY row the evidence was derived from — no cap
        trace_ids = sorted(hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest() for r in rows)
    else:
        traces = failing_traces(gen, max_traces)
        if not traces:
            print(f"no failing traces in results/{gen}.jsonl — nothing to propose"); return
        user = build_user(prompt_text, traces)
        trace_ids = [hashlib.sha256(json.dumps(trace, sort_keys=True).encode()).hexdigest() for trace in traces]
    reply = frontier_call(PROPOSE_SYS.format(n=n), user)
    parent_id = "parent-" + hashlib.sha256(prompt_text.encode()).hexdigest()[:16]
    cands, rejected = parse_candidate_manifests(reply, prompt_text, parent_id, trace_ids, {})
    append_candidate_journal(cands + rejected)
    if not cands:
        print("frontier returned no well-formed candidates; raw reply:\n" + reply[:800]); return
    paths = write_candidates(gen, cands)
    print(f"{len(trace_ids)} evidence hashes -> {len(cands)} candidate(s):")
    for cand, p in zip(cands, paths):
        print(f"  [{cand['operator']}] {p}")
    print(f"\nA/B them:  ./sql_eval.py {gen}-ab --variants A,C --prompt-file C=<path>  then  ./fleet_report.py {gen}-ab --candidate C")

# ---------- selftest (no network) ----------

def selftest():
    stub = (
        "preamble\n"
        "### CANDIDATE\nOPERATOR: tighten\nRATIONALE: be explicit about single statement\n"
        "--- PROMPT ---\nYou are precise. Output ONE SQL statement.\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: add-constraint\nRATIONALE: forbid prose\n"
        "--- PROMPT ---\nNever explain. SQL only.\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: nonsense\nRATIONALE: invalid op should be dropped\n"
        "--- PROMPT ---\nx\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: tune-threshold\nRATIONALE: config-only experiment\n"
        'CONFIG: {"thresholds": {"LB_STREAK_SOFT": 8}}\n'
        "--- PROMPT ---\nUNCHANGED\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: tighten\nRATIONALE: UNCHANGED without config is a no-op\n"
        "--- PROMPT ---\nUNCHANGED\n--- END ---\n")
    cands = parse_candidates(stub)
    assert len(cands) == 3, f"expected 3 valid candidates, got {len(cands)}"
    assert all(op in OPERATORS for op, _b, _d in cands), cands
    assert all(body.strip() for _op, body, _d in cands)
    # nested single-line CONFIG json parses; prompt candidates default to empty delta
    assert cands[2] == ("tune-threshold", "UNCHANGED", {"thresholds": {"LB_STREAK_SOFT": 8}}), cands[2]
    assert cands[0][2] == {} and cands[1][2] == {}
    assert parse_candidates("no candidates here") == []
    rich = (
        "### CANDIDATE\nOPERATOR: tighten\nHYPOTHESIS: removing the vague clause reduces loops\n"
        "MECHANISM: less ambiguous stopping behavior\nMETRIC: loop_breaker_steers\nDIRECTION: decrease\n"
        "FALSIFIER: steer count does not decrease on validation\nROLLBACK: task pass rate drops\n"
        "--- PROMPT ---\nYou are precise.\nOne bounded change.\n--- END ---\n"
        "### CANDIDATE\nOPERATOR: tune-threshold\nHYPOTHESIS: mixed change\nMECHANISM: x\n"
        "METRIC: x\nDIRECTION: decrease\nFALSIFIER: x stays flat\nROLLBACK: any regression\n"
        'CONFIG: {"thresholds":{"LB_STREAK_SOFT":8}}\n'
        "--- PROMPT ---\nchanged too\n--- END ---\n")
    accepted, rejected = parse_candidate_manifests(rich, "You are precise.\nOld vague clause.\n",
                                                   "parent-1", ["trace-1"])
    assert len(accepted) == 1 and len(rejected) == 1, (accepted, rejected)
    manifest = accepted[0]["manifest"]
    assert manifest["schema"] == CANDIDATE_SCHEMA and manifest["target_surface"] == "governor"
    assert manifest["held_out_material_available"] is False
    assert rejected[0]["manifest"]["status"] == "rejected"
    assert "mixed prompt/config mutation" in rejected[0]["manifest"]["rejection_reasons"]
    # Config and message candidates each permit exactly one leaf, never two.
    provenance = {"parent_id":"p", "hypothesis":"h", "mechanism":"m", "predicted_metric":"metric",
                  "direction":"increase", "falsifier":"f", "rollback_condition":"r", "validation_traces":["t"]}
    config, bad = candidate_manifest("g", "tune-threshold", "UNCHANGED", {"thresholds":{"LB_STREAK_SOFT":8}}, provenance)
    assert config and not bad and config["target_surface"] == "config"
    with_baseline = dict(provenance, baseline_config={"format":"md", "thresholds":{"LB_STREAK_SOFT":6}})
    config2, bad = candidate_manifest("g", "tune-threshold", "UNCHANGED", {"thresholds":{"LB_STREAK_SOFT":8}}, with_baseline)
    assert config2 and not bad and config2["baseline_surface_sha256"] != config2["candidate_surface_sha256"]
    assert config2["baseline_surface_sha256"] != config["baseline_surface_sha256"], \
        "surface provenance must include the complete parent config"
    no_op, bad = candidate_manifest("g", "tune-threshold", "UNCHANGED", {"thresholds":{"LB_STREAK_SOFT":6}}, with_baseline)
    assert no_op is None and "no-op candidate" in bad["rejection_reasons"]
    missing, bad = candidate_manifest("g", "tighten", "", {}, provenance)
    assert missing is None and "missing candidate prompt body" in bad["rejection_reasons"]
    message, bad = candidate_manifest("g", "tune-message", "UNCHANGED", {"messages":{"PI_MSG_LB_T2":"x"}}, provenance)
    assert message and not bad and message["target_surface"] == "message"
    none, bad = candidate_manifest("g", "tune-threshold", "UNCHANGED", {"format":"xml", "scaffold":"cot"}, provenance)
    assert none is None and "exactly one leaf" in " ".join(bad["rejection_reasons"])
    # file writing round-trips to a temp dir (no real proposals/ touched)
    import tempfile, shutil
    d = tempfile.mkdtemp()
    try:
        paths = write_candidates("selftest", cands, out_dir=d)
        assert len(paths) == 3 and all(os.path.exists(p) for p in paths)
        assert open(paths[0]).read().strip() == "You are precise. Output ONE SQL statement."
    finally:
        shutil.rmtree(d)
    # --distill: deterministic, bounded, aggregate-only evidence pack.
    # Rows carry the authority fields load_gate_rows now REQUIRES.
    def eligible(r):
        return dict(r, split="val", authoritative=True, status=r.get("status", "complete"))
    gate_rows_raw = [
        {"schema": "pi.eval-row/v2", "task": "parens", "arm": "base", "score": 1,
         "trajectory": {"turns": 4, "tool_errors": 0, "repeat_reads": 0, "compactions": 0},
         "context": {"surface": {"duplication": {"exact_block": {"mean": 0.05}, "near_block": {"mean": 0.02}}, "stale_tool_result": {"mean": 0.1}}}},
        {"schema": "pi.eval-row/v2", "task": "parens", "arm": "cand", "score": 1,
         "trajectory": {"turns": 9, "tool_errors": 2, "repeat_reads": 1, "compactions": 0},
         "context": {"surface": {"duplication": {"exact_block": {"mean": 0.2}, "near_block": {"mean": 0.1}}, "stale_tool_result": {"mean": 0.3}}}},
        {"schema": "pi.eval-row/v2", "task": "equil", "arm": "base", "score": 0, "status": "incomplete",
         "trajectory": {"turns": 14, "tool_errors": 5, "repeat_reads": 3, "compactions": 1},
         "context": {"surface": {"duplication": {"exact_block": {"mean": 0.4}, "near_block": {"mean": 0.2}}, "stale_tool_result": {"mean": 0.5}}}},
        {"schema": "pi.sql-row/v1", "task": "q1", "score": 0},  # non-gate row must be ignored by load_gate_rows semantics
    ]
    gate_rows = [eligible(r) for r in gate_rows_raw]
    # load_gate_rows: heldout / non-authoritative / incomplete rows never feed proposals
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        results_dir = os.path.join(LAB, "results")
        probe = os.path.join(results_dir, "distill-selftest-probe.jsonl")
        contaminated = gate_rows + [
            dict(gate_rows[0], split="heldout"),
            dict(gate_rows[0], split="robustness"),
            dict(gate_rows[0], authoritative=False),
            dict(gate_rows[0], status="incomplete"),
        ]
        try:
            with open(probe, "w") as f:
                for r in contaminated:
                    f.write(json.dumps(r) + "\n")
            loaded = load_gate_rows("distill-selftest-probe")
            # 2 of the 3 eval rows survive: the status="incomplete" synthetic is
            # itself excluded by the authority bar, as are all 4 contaminants.
            assert len(loaded) == 2, f"only val+authoritative+complete gate rows load, got {len(loaded)}"
            assert all(r.get("split") == "val" for r in loaded)
            ids = sorted(hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest() for r in loaded)
            assert len(ids) == len(loaded), "provenance covers every consumed row (no cap)"
        finally:
            os.unlink(probe)
    pack_a = distill_evidence(gate_rows)
    pack_b = distill_evidence(list(gate_rows))
    assert pack_a == pack_b, "evidence pack must be deterministic"
    assert "PASS RATES" in pack_a and "parens/base: 1/1" in pack_a, pack_a
    assert "LOSER CLUSTERS" in pack_a and "high_tool_errors(>=3): 1" in pack_a and "status=incomplete: 1" in pack_a
    assert "MATCHED WINNER-LOSER DELTAS" in pack_a
    # confound guard: parens has only passes, equil only failures -> NO matched
    # cell exists, so the pack must claim zero matched cells instead of
    # manufacturing a cross-task comparison (the old global-pool bug).
    assert "matched_cells=0" in pack_a, pack_a
    matched_rows = gate_rows + [dict(eligible(gate_rows_raw[2]), task="parens", arm="base")]
    pack_m = distill_evidence(matched_rows)
    assert "matched_cells=1" in pack_m and "turns: mean_delta=" in pack_m, pack_m
    assert len(pack_a.encode()) <= 4096
    tiny = distill_evidence(gate_rows, max_bytes=64)
    assert len(tiny.encode()) <= 64 + len("...[truncated]") + 1 and tiny.endswith("...[truncated]")
    # a --distill-built provenance passes candidate_manifest
    distill_ids = sorted(hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest() for r in gate_rows)
    manifest, rejection = candidate_manifest("base prompt", "tighten", "base prompt tightened", {},
        {"parent_id": "parent-x", "hypothesis": "h", "mechanism": "m", "predicted_metric": "turns",
         "direction": "decrease", "falsifier": "f", "rollback_condition": "r", "validation_traces": distill_ids})
    assert rejection is None and manifest["validation_traces"] == distill_ids
    print("propose selftest: OK (v1 manifests; one-surface/one-leaf enforcement; append-only provenance; distill evidence pack)")

def main():
    args = sys.argv[1:]
    if "--selftest" in args:
        selftest(); return
    gen = next((a for a in args if not a.startswith("-")), "sql0")
    prompt_path = os.path.expanduser(args[args.index("--prompt") + 1]) if "--prompt" in args else DEFAULT_PROMPT
    n = int(args[args.index("--n") + 1]) if "--n" in args else 3
    max_traces = int(args[args.index("--max-traces") + 1]) if "--max-traces" in args else 12
    run(gen, prompt_path, n, max_traces, distill="--distill" in args)

if __name__ == "__main__":
    main()
