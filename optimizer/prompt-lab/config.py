#!/usr/bin/env python3
"""config: the munchkin search-space representation + applier.

A `config` is a dict picking one value per dimension in configs/schema.json,
held per capability tier. `apply()` turns it into a concrete run setup —
(prompt_file, env, endpoint, label) — so ONE config is evaluable by every existing
eval (sql_eval --prompt-file, promptlab, ab-machinery env, OptiLLM endpoint).

Usage:  config.py --selftest        # no network, no GPU
"""
import hashlib, json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from exposure import validate_spec

LAB = os.path.dirname(os.path.abspath(__file__))
SCHEMA = os.path.join(LAB, "configs", "schema.json")
APPLIED = os.path.join(LAB, "configs", "applied")
LIVE_GOV = os.path.expanduser("~/.pi/agent/APPEND_SYSTEM.md")
DIRECT = os.environ.get("LLAMA_URL", "http://127.0.0.1:8080")
OPTILLM = "http://127.0.0.1:8000"

def resolve_prompt_path(pv):
    """Candidate prompt files are addressed by path. real_gate.sh invokes config.py
    from optimizer/, munchkin/propose from elsewhere, so a repo-relative path in a
    config resolves differently per caller. Try as given, then relative to this
    file's lab dir and the repo root, so a config is portable across callers."""
    direct = os.path.expanduser(pv)
    if os.path.isfile(direct):
        return direct
    repo_root = os.path.dirname(os.path.dirname(LAB))
    for base in (LAB, os.path.dirname(LAB), repo_root):
        cand = os.path.join(base, pv)
        if os.path.isfile(cand):
            return cand
    raise FileNotFoundError(f"prompt_variant file not found from any known base: {pv}")


def load_schema():
    with open(SCHEMA) as f:
        return json.load(f)

def validate_config(config):
    """Validate the config envelope, including optional mechanism exposure."""
    if not isinstance(config, dict):
        raise ValueError("config must be an object")
    allowed = {"name", "prediction", "prompt_variant", "format", "scaffold", "optillm",
               "decoding", "thresholds", "messages", "gov_file", "gov_append", "exposure"}
    unknown = set(config) - allowed
    if unknown:
        raise ValueError(f"config contains unsupported top-level key(s): {', '.join(sorted(unknown))}")
    validate_spec(config.get("exposure"))
    return config

# ---------- prompt rendering ----------

SCAFFOLD = {
    "none": "",
    "cot": "\n\nThink step by step before giving the final answer.",
    "decompose": "\n\nBreak the task into sub-steps, solve each, then give the final answer.",
    # user's empirically-favored deliberation primer (stunspot collection; 4/5 in his own use).
    # Anthropomorphic wording is deliberate — the test is Fisher, not literalism.
    "pause": "\n\nPause. Reflect. Take a breath, sit down, and think about this step-by-step.",
}

def wrap_format(text, fmt):
    if not text or fmt == "md":
        return text
    if fmt == "xml":
        return f"<system_instructions>\n{text}\n</system_instructions>"
    if fmt == "json":
        return json.dumps({"system_instructions": text}, ensure_ascii=False, indent=2)
    raise ValueError(f"unknown format {fmt!r}")

# INSTRUMENT TEXT — appended to EVERY variant (A, F, candidate files) so no
# prompt_variant mutation can drop it (munchkin.py rewrites prompt_variant; a line
# placed only in the live governor would vanish for governor candidates / variant F).
# Same rationale as PI_OBSERVATIONAL_MEMORY_PASSIVE in real_gate.sh: it is the
# instrument, not a candidate dimension. Kept to ~3 lines (dd1: prose harms the DD).
# Targets the measured wander patterns: cd $HOME x73, cd into foreign project copies,
# missing-file -> search-elsewhere (b1 + r6-c21 trace catalog, 2026-07-16).
CWD_ANCHOR = """

## Working directory
Do all work in the directory you started in; every task path (src/, test/, data/) is
relative to it. Never cd to $HOME or into other projects. If a file seems missing, run
`pwd` and `ls` first — do not search outside the working directory."""

def render_prompt(config, base_text=None):
    """Resolve the system-prompt text for a config (no I/O if base_text given)."""
    pv = config.get("prompt_variant", "A")
    if base_text is None:
        if pv == "F":
            base_text = ""
        elif pv == "A":
            base_text = open(LIVE_GOV).read()
        else:  # a candidate prompt file path
            base_text = open(resolve_prompt_path(pv)).read()
    elif pv == "F":
        base_text = ""
    base_text = base_text.rstrip() + CWD_ANCHOR
    text = wrap_format(base_text, config.get("format", "md"))
    return text + SCAFFOLD[config.get("scaffold", "none")]

# ---------- env + endpoint ----------

def config_env(config):
    validate_config(config)
    schema = load_schema()["dimensions"]
    allowed = set(schema["decoding"]["fields"]) | set(schema["thresholds"]["fields"]) | set(schema["messages"]["fields"])
    env = {}
    for k, v in (config.get("decoding") or {}).items():
        env[k] = str(v)
    for k, v in (config.get("thresholds") or {}).items():
        choices = schema["thresholds"]["fields"].get(k)
        if choices is not None and not any(type(v) is type(choice) and v == choice for choice in choices):
            raise ValueError(f"config threshold {k!r} has out-of-schema value {v!r}")
        env[k] = str(v)
    for k, v in (config.get("messages") or {}).items():  # steer-text templates (PI_MSG_*)
        env[k] = str(v)
    for key, value in env.items():
        if key not in allowed or not re.fullmatch(r"[A-Z][A-Z0-9_]*", key):
            raise ValueError(f"config contains unsupported environment key {key!r}")
        if "\x00" in value:
            raise ValueError(f"config environment value for {key} contains NUL")
    return env

def config_endpoint(config):
    return OPTILLM if config.get("optillm", "none") != "none" else DIRECT

def canonical(config):
    return json.dumps(config, sort_keys=True, ensure_ascii=False)

def label(config):
    h = hashlib.sha1(canonical(config).encode()).hexdigest()[:8]
    return f"{config.get('format','md')}-{config.get('scaffold','none')}-{config.get('optillm','none')}-{h}"

def apply(config, base_text=None, out_dir=APPLIED):
    """-> {prompt_file, env, endpoint, label}. Deterministic: same config -> same output."""
    validate_config(config)
    text = render_prompt(config, base_text)
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, label(config) + ".md")
    with open(path, "w") as f:
        f.write(text)
    return {"prompt_file": path, "env": config_env(config),
            "endpoint": config_endpoint(config), "label": label(config), "prompt_text": text}

# ---------- selftest ----------

def selftest():
    base = "RULE: do the thing precisely."
    c1 = {"prompt_variant": "A", "format": "md", "scaffold": "none", "optillm": "none",
          "thresholds": {"LB_REPEAT_T1": 2}, "decoding": {"TEMP": 0.6},
          "messages": {"PI_MSG_LB_T2": "act now: {act}"}}
    a = apply(c1, base_text=base, out_dir="/tmp/cfg-selftest")
    b = apply(c1, base_text=base, out_dir="/tmp/cfg-selftest")
    assert a == b, "apply must be deterministic"
    assert a["prompt_text"] == base + CWD_ANCHOR, "md appends the invariant working-directory anchor"
    assert a["env"] == {"LB_REPEAT_T1": "2", "TEMP": "0.6", "PI_MSG_LB_T2": "act now: {act}"}, a["env"]
    assert a["endpoint"] == DIRECT

    # format: xml wraps, json parses back to the base
    xml = render_prompt({"format": "xml", "scaffold": "none"}, base_text=base)
    assert xml.startswith("<system_instructions>") and base in xml
    js = render_prompt({"format": "json", "scaffold": "none"}, base_text=base)
    assert json.loads(js)["system_instructions"] == base + CWD_ANCHOR

    # scaffold appends; F empties the base
    assert render_prompt({"format": "md", "scaffold": "cot"}, base_text=base).endswith("final answer.")
    assert render_prompt({"prompt_variant": "F", "format": "md", "scaffold": "none"}, base_text=base) == CWD_ANCHOR
    try:
        config_env({"thresholds": {"BASH_ENV": "/tmp/inject"}})
    except ValueError:
        pass
    else:
        raise AssertionError("unsupported environment keys must be rejected")
    multiline = "first line\nsecond=line"
    assert config_env({"messages": {"PI_MSG_LB_T2": multiline}})["PI_MSG_LB_T2"] == multiline

    # optillm routes to the proxy; safe-vs-structural flags exist in the schema
    assert config_endpoint({"optillm": "bon"}) == OPTILLM
    sch = load_schema()
    assert sch["dimensions"]["optillm"]["safe"] is False, "optillm must be human-gated (structural)"
    assert sch["dimensions"]["format"]["safe"] is True
    assert "persona" in sch["excluded"] and "emoji_encoding" in sch["excluded"]
    thresholds = sch["dimensions"]["thresholds"]["fields"]
    # Watcher knobs removed 2026-07-28 with the active watcher (extension is
    # passive telemetry now); configs naming them must be rejected, not applied.
    assert "CONTEXT_WATCHER" not in thresholds and "CTX_WATCH_PCT" not in thresholds
    # c48 state-lens knobs (2026-07-29): registered so gate configs can arm it.
    assert thresholds["STATE_LENS"] == ["off", "view", "steer", "both"]
    assert config_env({"thresholds": {"STATE_LENS": "view", "STATE_LENS_MAX_CHARS": 1200}}) == {
        "STATE_LENS": "view", "STATE_LENS_MAX_CHARS": "1200"}
    # c49/c50 (2026-07-30): sensor candidates for the two coverage-table gaps.
    assert thresholds["TOOL_CALL_RESCUE"] == ["on", "off"]
    assert thresholds["SPEC_ADHERENCE"] == ["on", "off"]
    assert config_env({"thresholds": {"TOOL_CALL_RESCUE": "on", "SPEC_ADHERENCE": "on"}}) == {
        "TOOL_CALL_RESCUE": "on", "SPEC_ADHERENCE": "on"}
    for invalid in ({"CONTEXT_WATCHER": "off"}, {"CTX_WATCH_PCT": 70}, {"MICRO_GATE": "maybe"}):
        try:
            config_env({"thresholds": invalid})
        except ValueError:
            pass
        else:
            raise AssertionError(f"out-of-schema threshold setting accepted: {invalid}")
    # Every checked-in static config must survive config_env — a threshold key
    # missing from the schema means real_gate.sh exits 2 the moment that
    # candidate is applied (bit c24/c25 on 2026-07-20: DID_YOU_MEAN and
    # PLAN_SUBAGENT_ONLY were never registered here).
    static_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "configs", "static")
    for name in sorted(os.listdir(static_dir)):
        if not name.endswith(".json"):
            continue
        with open(os.path.join(static_dir, name)) as f:
            static_cfg = json.load(f)
        config_env(static_cfg)  # raises ValueError on any unsupported key
    print("config selftest: OK (deterministic apply; format/scaffold/F; env; endpoint; safe-flags; exclusions; static-config env keys)")

def apply_to_workdir(config, workdir):
    """For the agentic real-gate: write <workdir>/.pi/APPEND_SYSTEM.md (always, even
    empty for variant F, so it overrides the global governor) and return env+endpoint."""
    pi_dir = os.path.join(workdir, ".pi")
    os.makedirs(pi_dir, exist_ok=True)
    with open(os.path.join(pi_dir, "APPEND_SYSTEM.md"), "w") as f:
        f.write(render_prompt(config))
    return config_env(config), config_endpoint(config), label(config)

def main():
    if "--selftest" in sys.argv:
        selftest(); return
    if "--apply" in sys.argv:
        cfg = json.load(open(sys.argv[sys.argv.index("--apply") + 1]))
        wd = sys.argv[sys.argv.index("--workdir") + 1] if "--workdir" in sys.argv else "."
        env, endpoint, lab = apply_to_workdir(cfg, wd)
        if "--env-null" in sys.argv:
            for k, v in env.items():
                sys.stdout.buffer.write(f"{k}={v}".encode("utf-8") + b"\0")
        else:
            for k, v in env.items():
                print(f"{k}={v}")
            print(f"ENDPOINT={endpoint}")
            print(f"LABEL={lab}")
        return
    raise SystemExit("config.py: run --selftest, --apply <cfg.json> --workdir <wd>, or import apply()")

if __name__ == "__main__":
    main()
