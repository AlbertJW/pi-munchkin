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

ROW_SCHEMA_ID = "pi.eval-row/v2"
_ROW_SCHEMA_CACHE = None

def row_schema():
    global _ROW_SCHEMA_CACHE
    if _ROW_SCHEMA_CACHE is None:
        schema_path = os.path.join(LAB, "..", "real-gate-fixtures", "schemas", "pi.eval-row-v2.schema.json")
        _ROW_SCHEMA_CACHE = json.load(open(schema_path))
    return _ROW_SCHEMA_CACHE

# Minimal recursive JSON-Schema validator for the checked-in v2 row contract
# (stdlib-only by design — no schema library). Supports exactly the keyword
# set the schema uses, and FAILS CLOSED: any other constraining keyword in
# the schema raises, so future schema evolution can never silently
# under-validate a row. Presence-only key checking previously admitted a row
# whose every field was {"stub": true}.
_SCHEMA_DESCRIPTIVE_KEYS = {"$schema", "$id", "title", "description", "_doc", "$defs"}
_SCHEMA_SUPPORTED_KEYS = {"type", "required", "properties", "const", "enum", "pattern",
                          "minimum", "maximum", "minLength", "items",
                          "additionalProperties", "$ref", "allOf", "if", "then", "not"}

def _type_ok(value, expected):
    if isinstance(expected, list):
        return any(_type_ok(value, t) for t in expected)
    if expected == "object": return isinstance(value, dict)
    if expected == "array": return isinstance(value, list)
    if expected == "string": return isinstance(value, str)
    if expected == "boolean": return isinstance(value, bool)
    if expected == "integer": return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number": return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "null": return value is None
    raise ValueError(f"unsupported schema type {expected!r}")

def validate_row(instance, schema, defs, path="$"):
    """Errors list; empty = valid. `defs` = the root schema's $defs."""
    unknown = set(schema) - _SCHEMA_SUPPORTED_KEYS - _SCHEMA_DESCRIPTIVE_KEYS
    if unknown:
        raise ValueError(f"unsupported schema keyword(s) {sorted(unknown)} at {path} — extend validate_row before trusting rows")
    errors = []
    if "$ref" in schema:
        ref = schema["$ref"]
        if not ref.startswith("#/$defs/"):
            raise ValueError(f"unsupported $ref {ref!r} at {path}")
        return validate_row(instance, defs[ref[len("#/$defs/"):]], defs, path)
    if "const" in schema and instance != schema["const"]:
        errors.append(f"{path}: expected const {schema['const']!r}")
    if "enum" in schema and instance not in schema["enum"]:
        errors.append(f"{path}: {instance!r} not in enum")
    if "type" in schema and not _type_ok(instance, schema["type"]):
        errors.append(f"{path}: wrong type (expected {schema['type']})")
    if "pattern" in schema and isinstance(instance, str) and not re.search(schema["pattern"], instance):
        errors.append(f"{path}: does not match pattern")
    if "minLength" in schema and isinstance(instance, str) and len(instance) < schema["minLength"]:
        errors.append(f"{path}: shorter than minLength")
    if "minimum" in schema and isinstance(instance, (int, float)) and not isinstance(instance, bool) and instance < schema["minimum"]:
        errors.append(f"{path}: below minimum {schema['minimum']}")
    if "maximum" in schema and isinstance(instance, (int, float)) and not isinstance(instance, bool) and instance > schema["maximum"]:
        errors.append(f"{path}: above maximum {schema['maximum']}")
    if "not" in schema and not validate_row(instance, schema["not"], defs, path):
        errors.append(f"{path}: matches forbidden subschema")
    if isinstance(instance, dict):
        for key in schema.get("required", []):
            if key not in instance:
                errors.append(f"{path}.{key}: missing required key")
        props = schema.get("properties", {})
        for key, sub in props.items():
            if key in instance:
                errors.extend(validate_row(instance[key], sub, defs, f"{path}.{key}"))
        if schema.get("additionalProperties") is False:
            for key in instance:
                if key not in props:
                    errors.append(f"{path}.{key}: unexpected key")
    elif "required" in schema and not isinstance(instance, dict):
        errors.append(f"{path}: expected object with required keys")
    if isinstance(instance, list) and "items" in schema:
        for index, item in enumerate(instance):
            errors.extend(validate_row(item, schema["items"], defs, f"{path}[{index}]"))
    for branch in schema.get("allOf", []):
        errors.extend(validate_row(instance, branch, defs, path))
    if "if" in schema:
        if not validate_row(instance, schema["if"], defs, path):
            errors.extend(validate_row(instance, schema.get("then", {}), defs, path))
    return errors

def row_validation_errors(row):
    schema = row_schema()
    return validate_row(row, schema, schema.get("$defs", {}))

def load_gate_rows(gen, results_dir=None):
    """Rows from a real-gate round eligible to feed candidate generation:
    EXACT v2 schema, FULLY schema-valid (types, patterns, nested and
    conditional requirements — presence-only checking admitted all-stub
    rows), split "val" ONLY (heldout/robustness rows must never contaminate
    proposals — manifests declare held-out material unavailable),
    authoritative, and complete — the same authority bar fleet_report
    enforces. `results_dir` is injectable so the selftest never touches the
    repo's results/ directory."""
    path = os.path.join(results_dir or os.path.join(LAB, "results"), gen + ".jsonl")
    if not os.path.exists(path):
        return []
    rows = [json.loads(l) for l in open(path) if l.strip()]
    return [r for r in rows
            if r.get("schema") == ROW_SCHEMA_ID
            and not row_validation_errors(r)
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
    # canonical_row is a GENUINELY schema-valid v2 row — validate_row must
    # accept it, which couples this selftest to the real checked-in contract
    # (the previous stub-stamping helper enshrined all-stub rows as valid).
    def _stats(value=0.0):
        return {"max": value, "mean": value}

    def _traj(turns=4, tool_errors=0, repeat_reads=0, compactions=0):
        return {"turns": turns, "tool_calls": turns, "tool_errors": tool_errors,
                "reads": 2, "unique_reads": 2, "repeat_calls": 0,
                "repeat_reads": repeat_reads, "tool_result_chars": 100,
                "first_mutation_turn": 1, "compactions": compactions}

    def _ctx(exact=0.05, near=0.02, stale=0.1):
        return {"schema": "pi.context-telemetry/v2", "authenticated": True,
                "content_sha256": "b" * 64, "session_key": "run-0000-parens-base-1",
                "events": 3, "harness_surface_sha256": "c" * 64,
                "config": {"enabled": True, "thresholdPct": 70, "rearmPct": 55},
                "compactions": {"total": 0, "watcher": 0, "pi": 0, "compact_tool": 0,
                                "manual_unknown": 0, "extension_content": 0,
                                "threshold": 0, "overflow": 0, "manual": 0, "will_retry": 0},
                "watcher": {"requests": 0, "completed": 0, "failed": 0,
                            "thrash_silenced": 0, "resume_required": 0, "estimates": []},
                "surface": {"calls": 1,
                            "concentration": {"largest_message": _stats(0.4), "largest_tool_result": _stats(0.4)},
                            "duplication": {"exact_block": _stats(exact), "five_token_shingle": _stats(0.1), "near_block": _stats(near)},
                            "stale_tool_result": _stats(stale),
                            "kv_cache": {"prefix_stable_rate": 1.0, "appended_only_rate": 1.0, "system_prompt_changes": 0},
                            "context": {"max_bytes": 100, "mean_bytes": 100.0, "tokens": _stats(50)}}}

    def canonical_row(**overrides):
        row = {
            "schema": "pi.eval-row/v2", "task": "parens", "model": "qwen36-35b-iq3s",
            "arm": "base", "repetition": 1, "score": 1, "split": "val",
            "run": "run-0000", "fixture": {"cohort": "default", "version": "v1"},
            "authoritative": True,
            "prompt": {"variant": "A", "semantic_group": "canonical", "sha256": "a" * 64},
            "serving": {"pre": {"model": "m"}, "post": {"model": "m"}, "stable": True},
            "usage": {"source": "server", "exact": True, "input_tokens": 10,
                      "output_tokens": 5, "output_chars": 20},
            "status": "complete",
            "trajectory": _traj(),
            "context": _ctx(),
        }
        row.update(overrides)
        return row
    assert row_validation_errors(canonical_row()) == [], row_validation_errors(canonical_row())
    # full validation, not presence: types, patterns, and conditionals bite
    assert row_validation_errors(canonical_row(task={"stub": True})), "object-typed task must be invalid"
    assert row_validation_errors(canonical_row(score=7)), "score outside 0..1 must be invalid"
    assert row_validation_errors(canonical_row(serving={"pre": {}, "stable": True})), "serving missing nested required key"
    no_traj = canonical_row(); del no_traj["trajectory"]
    assert row_validation_errors(no_traj), "arm != one-shot without trajectory must be invalid (conditional)"
    no_surface = canonical_row(context={"schema": "pi.context-telemetry/v2"})
    assert row_validation_errors(no_surface), "v2 context without surface must be invalid (conditional)"
    all_stub = {k: {"stub": True} for k in row_schema()["required"]}
    all_stub["schema"] = "pi.eval-row/v2"
    assert row_validation_errors(all_stub), "the all-stub row that presence-checking accepted must be invalid"

    gate_rows = [
        canonical_row(),
        canonical_row(arm="cand", trajectory=_traj(turns=9, tool_errors=2, repeat_reads=1),
                      context=_ctx(exact=0.2, near=0.1, stale=0.3)),
        canonical_row(task="equil", score=0, status="incomplete",
                      trajectory=_traj(turns=14, tool_errors=5, repeat_reads=3, compactions=1),
                      context=_ctx(exact=0.4, near=0.2, stale=0.5)),
        {"schema": "pi.sql-row/v1", "task": "q1", "score": 0},  # non-gate row must be ignored
    ]
    # load_gate_rows: forged schemas, schema-invalid rows, heldout/robustness,
    # non-authoritative, and incomplete rows never feed proposals. The probe
    # lives in a TEMP dir — canonical verification must not create repo state
    # and must pass under a read-only checkout.
    import tempfile
    with tempfile.TemporaryDirectory() as td:
        probe = os.path.join(td, "distill-selftest-probe.jsonl")
        contaminated = gate_rows + [
            dict(gate_rows[0], split="heldout"),
            dict(gate_rows[0], split="robustness"),
            dict(gate_rows[0], authoritative=False),
            dict(gate_rows[0], schema="pi.eval-row-forged"),
            {k: v for k, v in gate_rows[0].items() if k != "serving"},
            all_stub | {"split": "val", "authoritative": True, "status": "complete"},
        ]
        with open(probe, "w") as f:
            for r in contaminated:
                f.write(json.dumps(r) + "\n")
        loaded = load_gate_rows("distill-selftest-probe", results_dir=td)
        # 2 of the 3 eval rows survive (the incomplete synthetic is excluded by
        # the authority bar), and every contaminant is rejected.
        assert len(loaded) == 2, f"only schema-VALID val+authoritative+complete rows load, got {len(loaded)}"
        assert all(r.get("schema") == ROW_SCHEMA_ID and not row_validation_errors(r) for r in loaded)
        ids = sorted(hashlib.sha256(json.dumps(r, sort_keys=True).encode()).hexdigest() for r in loaded)
        assert len(ids) == len(loaded), "provenance covers every consumed row (no cap)"
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
    matched_rows = gate_rows + [dict(gate_rows[2], task="parens", arm="base")]
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
