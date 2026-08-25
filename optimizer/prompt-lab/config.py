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
ACTIVE_ENUMS = {
    "format": frozenset(("md", "xml", "json")),
    "scaffold": frozenset(("none", "decompose")),
    "optillm": frozenset(("none", "bon", "moa", "sc", "re2")),
}

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

def _declares_treatment(config):
    """Does this config express a treatment on any channel that reaches a run?

    Checked DECLARATIVELY, against apply()'s three outputs — prompt_file, env, endpoint.
    The first version of this guard compared `render_prompt(config)` to `render_prompt({})`,
    which for the default prompt_variant "A" opens LIVE_GOV = ~/.pi/agent/APPEND_SYSTEM.md —
    an absolute path into the LIVE INSTALL. That made validate_config do I/O on every named
    config and fail outright on any machine without a live pi (CI, a fresh clone, a
    container). It also missed `optillm`, the endpoint channel, and would have falsely
    rejected an optillm-only candidate as inert.

    `decoding` counts as a treatment here: schema.json calls it server launch params
    "consumed by run-*.sh", so it reaches a deep run even though real_gate.sh never
    relaunches the server and a decoding-only config is therefore inert IN THE GATE.
    That narrower gate-inertness is a round-design question, not a config-validity one.
    """
    if config.get("prompt_variant", "A") != "A":
        return True
    if config.get("format", "md") != "md":
        return True
    if config.get("scaffold", "none") != "none":
        return True
    if config.get("optillm", "none") != "none":
        return True
    return any(config.get(key) for key in ("thresholds", "decoding", "messages"))


def validate_config(config):
    """Validate the config envelope, including optional mechanism exposure."""
    if not isinstance(config, dict):
        raise ValueError("config must be an object")
    # `gov_file` / `gov_append` are DELIBERATELY absent. They were accepted here but
    # read nowhere: render_prompt() consumes only prompt_variant/format/scaffold, and
    # config_env() only thresholds/decoding — so a config whose sole treatment was a
    # governor key rendered BYTE-IDENTICALLY to base with an empty env. Five candidates
    # (c1/c5/c8/c9/c15) sat in the roster as "measured neutral" while their cand arm WAS
    # the base arm; c9, named "no-governor", emitted the live governor verbatim and duly
    # measured +0pp. Retired 2026-07-31. Governor variation has a working path —
    # `prompt_variant` (see c46/c47) — use that.
    allowed = {"name", "prediction", "prompt_variant", "format", "scaffold", "optillm",
               "decoding", "thresholds", "messages", "exposure"}
    unknown = set(config) - allowed
    if unknown:
        raise ValueError(f"config contains unsupported top-level key(s): {', '.join(sorted(unknown))}")
    for key, default in (("format", "md"), ("scaffold", "none"), ("optillm", "none")):
        value = config.get(key, default)
        if value not in ACTIVE_ENUMS[key]:
            raise ValueError(f"config {key} has out-of-schema value {value!r}")
    # A NAMED config claims to be a candidate, so it must express its treatment through a
    # channel that actually reaches a run. Anything else is a no-op arm that burns a round
    # measuring base against base (see the five retired 2026-07-31).
    # Scoped to named configs on purpose: `configs/baseline.json` is a raw arm spec with
    # no `name`, and baseline is DELIBERATELY identical to base — that
    # is what makes it the control. (Not solved by tagging baseline.json, because its
    # sha256 is recorded as `config.sha256` on every base row; editing it would split the
    # baseline's provenance in two for no behavioural gain.)
    if config.get("name") and not _declares_treatment(config):
        raise ValueError(
            f"config '{config['name']}' is named but declares no treatment on any channel — "
            "it would measure base against base. Express it via prompt_variant/format/scaffold "
            "(prompt), thresholds/messages (env), decoding (env; deep runs ONLY — the gate "
            "never relaunches the server, so a decoding-only candidate is inert there), "
            "or optillm (endpoint).")
    validate_spec(config.get("exposure"))
    return config

# ---------- prompt rendering ----------

SCAFFOLD = {
    "none": "",
    "decompose": "\n\nBreak the task into sub-steps, solve each, then give the final answer.",
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
    return _env_unchecked(config)


def _env_unchecked(config):
    """config_env's body without the validate_config() call, so validate_config can
    use it for the base-vs-base check without recursing back into itself."""
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
        # An EMPTY override is not the empty arm. steer_texts.ts resolves overrides
        # with `override || defaultTemplate`, so "" is falsy and the session runs the
        # FULL DEFAULT steer while the manifest records the arm as empty — a candidate
        # that reports one thing and measures another. Reject it loudly here rather
        # than let it into a round: the ablation arm is not expressible today, and an
        # experimenter must find that out at config time, not from the results.
        if str(v).strip() == "":
            raise ValueError(
                f"config message {k!r} is empty; the harness falls back to the default "
                "steer text for an empty override, so this arm would silently run the default"
            )
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
    assert render_prompt({"format": "md", "scaffold": "decompose"}, base_text=base).endswith("final answer.")
    assert render_prompt({"prompt_variant": "F", "format": "md", "scaffold": "none"}, base_text=base) == CWD_ANCHOR
    try:
        config_env({"thresholds": {"BASH_ENV": "/tmp/inject"}})
    except ValueError:
        pass
    else:
        raise AssertionError("unsupported environment keys must be rejected")

    # An EMPTY steer override is the natural way to write the ablation arm, and it is
    # the one thing the harness cannot express: steer_texts.ts resolves overrides with
    # `override || defaultTemplate`, so "" is falsy and the session runs the FULL
    # DEFAULT text while the manifest records the arm as empty. Silently measuring the
    # opposite of what a candidate declares is worse than refusing to run it.
    for empty in ("", "   "):
        try:
            config_env({"messages": {"PI_MSG_LB_T2": empty}})
        except ValueError:
            pass
        else:
            raise AssertionError("an empty steer override must be rejected, not silently defaulted")
    assert config_env({"messages": {"PI_MSG_LB_T2": "x"}}) == {"PI_MSG_LB_T2": "x"}
    multiline = "first line\nsecond=line"
    assert config_env({"messages": {"PI_MSG_LB_T2": multiline}})["PI_MSG_LB_T2"] == multiline

    # optillm routes to the proxy; safe-vs-structural flags exist in the schema
    assert config_endpoint({"optillm": "bon"}) == OPTILLM
    sch = load_schema()
    for key, active in ACTIVE_ENUMS.items():
        assert set(sch["dimensions"][key]["values"]) == active, f"{key} validation/schema drift"
    assert sch["dimensions"]["optillm"]["safe"] is False, "optillm must be human-gated (structural)"
    assert sch["dimensions"]["format"]["safe"] is True
    assert "persona" in sch["excluded"] and "emoji_encoding" in sch["excluded"]
    thresholds = sch["dimensions"]["thresholds"]["fields"]
    # Watcher knobs removed 2026-07-28 with the active watcher (extension is
    # passive telemetry now); configs naming them must be rejected, not applied.
    assert "CONTEXT_WATCHER" not in thresholds and "CTX_WATCH_PCT" not in thresholds
    assert thresholds["STATE_LENS"] == ["off", "steer"]
    assert config_env({"thresholds": {"STATE_LENS": "steer", "STATE_LENS_MAX_CHARS": 1200}}) == {
        "STATE_LENS": "steer", "STATE_LENS_MAX_CHARS": "1200"}
    # c49/c50 (2026-07-30): sensor candidates for the two coverage-table gaps.
    assert thresholds["TOOL_CALL_RESCUE"] == ["on", "off"]
    assert config_env({"thresholds": {"TOOL_CALL_RESCUE": "on"}}) == {"TOOL_CALL_RESCUE": "on"}
    for invalid in ({"CONTEXT_WATCHER": "off"}, {"CTX_WATCH_PCT": 70}, {"MICRO_GATE": "on"}, {"STATE_LENS": "view"}):
        try:
            config_env({"thresholds": invalid})
        except ValueError:
            pass
        else:
            raise AssertionError(f"out-of-schema threshold setting accepted: {invalid}")
    for retired in ({"scaffold": "cot"}, {"scaffold": "pause"}):
        try:
            validate_config(retired)
        except ValueError:
            pass
        else:
            raise AssertionError(f"retired scaffold accepted: {retired}")
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
    # --- the inert-candidate guard (added 166e94d, ASSERTED here 2026-07-31) ---
    # It shipped with zero assertions: reverting both layers left this selftest green,
    # which is the same "guard that is never exercised" class as the unregistered
    # integrity test and the self-matching watcher. Pin both layers.
    for retired_key in ("gov_file", "gov_append"):
        try:
            validate_config({"name": "x", retired_key: "y"})
        except ValueError as exc:
            assert "unsupported top-level key" in str(exc), exc
        else:
            raise AssertionError(f"{retired_key} must be rejected: it reaches neither render_prompt nor config_env")
    # Layer 2: a NAMED config with no treatment on any channel.
    for inert in ({"name": "hollow"},
                  {"name": "hollow", "prediction": "p", "exposure": None},
                  {"name": "hollow", "thresholds": {}},
                  {"name": "hollow", "prompt_variant": "A", "format": "md", "scaffold": "none"}):
        cfg = {k: v for k, v in inert.items() if v is not None}
        try:
            validate_config(cfg)
        except ValueError as exc:
            assert "declares no treatment" in str(exc), exc
        else:
            raise AssertionError(f"inert named config accepted: {cfg}")
    # ...and every real channel must still pass, including the two the first version got
    # wrong: optillm (endpoint) and an unnamed control.
    for live in ({"name": "a", "thresholds": {"BASH_OUTPUT_GUARD": "on"}},
                 {"name": "b", "scaffold": "decompose"},
                 {"name": "c", "format": "xml"},
                 {"name": "d", "prompt_variant": "prompts/x.md"},
                 {"name": "e", "optillm": "moa"},
                 {"name": "f", "messages": {"PI_MSG_LB_T2": "x"}},
                 {"prompt_variant": "A", "format": "md", "scaffold": "none"}):
        validate_config(live)
    # The guard must not touch the filesystem: it ran render_prompt against the live
    # install's governor, so it broke wherever that file is absent.
    import unittest.mock as _mock
    with _mock.patch("builtins.open", side_effect=AssertionError("validate_config must not do I/O")):
        validate_config({"name": "no-io", "thresholds": {"BASH_OUTPUT_GUARD": "on"}})
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
