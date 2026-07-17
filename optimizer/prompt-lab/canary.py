#!/usr/bin/env python3
"""canary: tiny deterministic tool-protocol battery, run per (model, template,
server) combination BEFORE trusting full coding tasks. Nine cases exercise the
layers where "competent-looking" local stacks actually break; each failure is
classified into a layer so fixes target the right thing:

  model         — the model didn't do the thing (no call, wrong tool, refusal)
  parser        — model emitted a tool-shaped answer but tool_calls is empty,
                  or prose ABOUT a call was extracted AS a call (overtrigger)
  serialization — a call was extracted but its arguments don't parse / lost data
  template      — the server errored rendering the conversation (multi-turn tool
                  history is where chat templates break)

Direct /v1/chat/completions (no pi): what's measured is the serving stack.
Evolution of c17: apply grammar constraints only to combinations that
demonstrably need them.

  LLAMA_URL=http://box:8080 LLAMA_API_KEY=... ./canary.py <model> [model...]
  ./canary.py --selftest
Writes results/canary-<model>.json (raw responses kept for inspection).
"""
import json, os, sys, time, urllib.error, urllib.request

LAB = os.path.dirname(os.path.abspath(__file__))
URL = os.environ.get("LLAMA_URL", "http://127.0.0.1:8080")
KEY = os.environ.get("LLAMA_API_KEY", "")
TIMEOUT = int(os.environ.get("CANARY_TIMEOUT", "180"))

WEATHER = {"type": "function", "function": {
    "name": "get_weather", "description": "Current weather for a city",
    "parameters": {"type": "object", "properties": {"city": {"type": "string"}},
                   "required": ["city"]}}}
QUERY = {"type": "function", "function": {
    "name": "run_query", "description": "Run a filtered query",
    "parameters": {"type": "object", "properties": {
        "filter": {"type": "object", "properties": {
            "field": {"type": "string"}, "op": {"type": "string"}, "value": {"type": "string"}}},
        "limit": {"type": "integer"}}, "required": ["filter"]}}}

U = lambda t: {"role": "user", "content": t}
A_CALL = lambda cid, name, args: {"role": "assistant", "content": None, "tool_calls": [
    {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}]}
T_RES = lambda cid, text: {"role": "tool", "tool_call_id": cid, "content": text}


def calls_of(resp):
    msg = (resp.get("choices") or [{}])[0].get("message") or {}
    return msg.get("tool_calls") or [], msg


def args_of(call):
    try:
        return json.loads(call.get("function", {}).get("arguments") or "")
    except (ValueError, TypeError):
        return None


def looks_tool_shaped(text):
    return any(s in (text or "") for s in ('"get_weather"', '"run_query"', "<tool_call>", '"name":', "get_weather("))


# ---- the nine cases: (name, messages, tools, judge(resp) -> (ok, layer, note)) ----

def _expect_call(name, want_args=None, want_values=None, require_text=False):
    """want_values: {key: expected} verified case-insensitively — audit-2: name-only
    judging passed 'Paris' asks answered with any city, corrections repeating the
    broken arg, and follow-ups re-calling the previous city. require_text: the case
    asked for prose BEFORE the call; empty content is a failure of the ask."""
    def judge(resp):
        calls, msg = calls_of(resp)
        if not calls:
            layer = "parser" if looks_tool_shaped(msg.get("content")) else "model"
            return False, layer, f"no tool_calls; content={str(msg.get('content'))[:80]!r}"
        c = calls[0]
        if c.get("function", {}).get("name") != name:
            return False, "model", f"wrong tool {c.get('function', {}).get('name')}"
        a = args_of(c)
        if a is None:
            return False, "serialization", f"unparseable args {str(c.get('function', {}).get('arguments'))[:80]!r}"
        if want_args and not all(k in a for k in want_args):
            return False, "serialization", f"missing keys {want_args} in {a}"
        for k, expected in (want_values or {}).items():
            got = a.get(k)
            if not isinstance(got, str) or got.strip().lower() != expected.lower():
                return False, "model", f"arg {k}={got!r}, wanted {expected!r}"
        if require_text and not (msg.get("content") or "").strip():
            return False, "model", "call made but the requested text before it is missing"
        return True, None, ""
    return judge


def _expect_no_call(resp):
    calls, msg = calls_of(resp)
    if calls:
        return False, "parser", f"prose about a call was extracted AS a call: {calls[0]}"
    if not (msg.get("content") or "").strip():
        return False, "model", "empty answer"
    return True, None, ""


def _expect_n_calls(n, tool=None, want_cities=None):
    """Audit-2: count alone let 'Paris AND Oslo' pass with Paris twice. Verify the
    tool names and the exact (case-insensitive) set of city values when given."""
    def judge(resp):
        calls, _ = calls_of(resp)
        if len(calls) != n:
            return False, "model", f"{len(calls)} calls (wanted {n})"
        argsets = [args_of(c) for c in calls]
        if any(a is None for a in argsets):
            return False, "serialization", "unparseable args in one of the calls"
        if tool and any(c.get("function", {}).get("name") != tool for c in calls):
            return False, "model", "wrong tool among the calls"
        if want_cities is not None:
            got = {str(a.get("city", "")).strip().lower() for a in argsets}
            if got != {c.lower() for c in want_cities}:
                return False, "model", f"cities {sorted(got)}, wanted {sorted(want_cities)}"
        return True, None, ""
    return judge


def _expect_nested_roundtrip(resp):
    calls, msg = calls_of(resp)
    if not calls:
        layer = "parser" if looks_tool_shaped(msg.get("content")) else "model"
        return False, layer, "no call"
    c = calls[0]
    if c.get("function", {}).get("name") != "run_query":
        return False, "model", f"wrong tool {c.get('function', {}).get('name')}"
    a = args_of(c)
    if a is None:
        return False, "serialization", f"unparseable args {str(c.get('function', {}).get('arguments'))[:80]!r}"
    flt = a.get("filter") if isinstance(a.get("filter"), dict) else {}
    # audit-3: the hard quoted value alone let other malformed calls pass —
    # verify the full requested shape
    if flt.get("field") != "name" or flt.get("op") != "=":
        return False, "model", f"filter field/op wrong: {flt.get('field')!r}/{flt.get('op')!r}"
    if a.get("limit") != 5:
        return False, "model", f"limit={a.get('limit')!r}, wanted 5"
    if flt.get("value") != 'O"Brien, Jr.':
        return False, "serialization", f"nested value mangled: {flt.get('value')!r}"
    return True, None, ""


def _expect_text_end(resp):
    calls, msg = calls_of(resp)
    if calls:
        return False, "model", "made another call instead of answering"
    if not (msg.get("content") or "").strip():
        return False, "model", "empty final answer"
    return True, None, ""


CASES = [
    ("valid-call", [U("Call get_weather for Paris.")], [WEATHER],
     _expect_call("get_weather", ["city"], want_values={"city": "Paris"})),
    ("text-then-call", [U("In one short sentence say what you are about to do, then call get_weather for Oslo.")],
     [WEATHER], _expect_call("get_weather", ["city"], want_values={"city": "Oslo"}, require_text=True)),
    ("prose-not-call", [U('Explain in one sentence what the JSON {"name": "get_weather", "arguments": {"city": "Paris"}} '
                          "would do if it were submitted as a tool call. Do NOT actually call any tool.")],
     [WEATHER], _expect_no_call),
    ("two-calls", [U("Call get_weather twice in this single turn: once for Paris and once for Oslo.")],
     [WEATHER], _expect_n_calls(2, tool="get_weather", want_cities={"Paris", "Oslo"})),
    ("nested-json", [U('Call run_query with filter field "name", op "=", value exactly O"Brien, Jr. (with the quote '
                       "and comma) and limit 5.")], [QUERY], _expect_nested_roundtrip),
    ("malformed-correction", [U("Get the weather for Paris."),
                              A_CALL("c1", "get_weather", {"city": 123}),
                              T_RES("c1", "error: invalid arguments — city must be a string"),
                              ], [WEATHER], _expect_call("get_weather", ["city"], want_values={"city": "Paris"})),
    ("error-then-retry", [U("Get the weather for Paris."),
                          A_CALL("c1", "get_weather", {"city": "Paris"}),
                          T_RES("c1", "error: transient upstream timeout, please retry"),
                          ], [WEATHER], _expect_call("get_weather", ["city"], want_values={"city": "Paris"})),
    ("result-then-next", [U("Get the weather for Paris, then Oslo (one at a time)."),
                          A_CALL("c1", "get_weather", {"city": "Paris"}),
                          T_RES("c1", "Paris: 22C, clear"),
                          ], [WEATHER], _expect_call("get_weather", ["city"], want_values={"city": "Oslo"})),
    ("end-of-turn", [U("Get the weather for Paris and tell me the temperature."),
                     A_CALL("c1", "get_weather", {"city": "Paris"}),
                     T_RES("c1", "Paris: 22C, clear"),
                     ], [WEATHER], _expect_text_end),
]


def call_server(model, messages, tools):
    body = json.dumps({"model": model, "messages": messages, "tools": tools,
                       "temperature": 0, "max_tokens": 2048}).encode()
    req = urllib.request.Request(f"{URL}/v1/chat/completions", data=body,
                                 headers={"Content-Type": "application/json",
                                          # bare urllib UA gets Cloudflare-blocked (403 code 1010, Cerebras)
                                          "User-Agent": "prompt-lab-canary/1",
                                          **({"Authorization": f"Bearer {KEY}"} if KEY else {})})
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}: {e.read()[:200]!r}"
    except Exception as e:  # noqa: BLE001 — connection/timeout: report, don't crash the battery
        return None, str(e)[:200]


def run_model(model):
    # suspected_layer, not layer (audit-2): tool-shaped text doesn't PROVE a parser
    # fault and an HTTP error on tool history doesn't PROVE a template defect —
    # attribution is a triage hint pending raw-generation/server evidence.
    out = {"model": model, "url": URL, "cases": {}}
    # CANARY_SLEEP: seconds between cases, for RPM-limited endpoints (Cerebras).
    pace = float(os.environ.get("CANARY_SLEEP", "0") or 0)
    for name, messages, tools, judge in CASES:
        if pace:
            time.sleep(pace)
        resp, err = call_server(model, messages, tools)
        if err:
            layer = "template" if any(m.get("role") == "tool" for m in messages) else "server"
            out["cases"][name] = {"ok": False, "suspected_layer": layer, "note": err}
            print(f"  {name:20} FAIL [suspected: {layer}] {err[:90]}")
            continue
        ok, layer, note = judge(resp)
        out["cases"][name] = {"ok": ok, "suspected_layer": layer, "note": note,
                              "raw": (resp.get("choices") or [{}])[0].get("message")}
        print(f"  {name:20} {'ok' if ok else f'FAIL [suspected: {layer}] {note[:80]}'}")
    passed = sum(1 for c in out["cases"].values() if c["ok"])
    out["score"] = f"{passed}/{len(CASES)}"
    # artifact identity = model AND serving combo — the same model through another
    # server/template is a different measurement, not an overwrite (audit-2).
    # CANARY_STACK labels template/parser config changes on the SAME host (audit-3).
    host = URL.split("//", 1)[-1].replace(":", "-").replace("/", "")
    stack = os.environ.get("CANARY_STACK", "")
    if stack:
        out["stack"] = stack
        host = f"{host}+{stack}"
    path = os.path.join(LAB, "results", f"canary-{model}@{host}.json")
    with open(path, "w") as f:
        json.dump(out, f, indent=1)
    print(f"  => {out['score']}  ({path})")
    return out


def selftest():
    # judges on canned responses — no network
    mk = lambda msg: {"choices": [{"message": msg}]}
    call = lambda name, args, content=None: mk({"content": content,
                                                "tool_calls": [{"function": {"name": name, "arguments": json.dumps(args)}}]})
    two = lambda a, b: mk({"tool_calls": [
        {"function": {"name": "get_weather", "arguments": json.dumps({"city": a})}},
        {"function": {"name": "get_weather", "arguments": json.dumps({"city": b})}}]})

    j = _expect_call("get_weather", ["city"], want_values={"city": "Paris"})
    assert j(call("get_weather", {"city": "Paris"}))[0]
    assert j(call("get_weather", {"city": "paris"}))[0], "case-insensitive value match"
    ok, layer, _ = j(call("get_weather", {"city": "London"}))
    assert not ok and layer == "model", "audit-2: wrong city must FAIL, name-only judging passed it"
    ok, layer, _ = j(call("get_weather", {"city": 123}))
    assert not ok, "audit-2: repeating the malformed arg must FAIL the correction case"

    jt = _expect_call("get_weather", ["city"], want_values={"city": "Oslo"}, require_text=True)
    assert jt(call("get_weather", {"city": "Oslo"}, content="Fetching Oslo weather now."))[0]
    ok, _, note = jt(call("get_weather", {"city": "Oslo"}, content=""))
    assert not ok and "text" in note, "audit-2: text-then-call without the text must FAIL"

    ok, layer, _ = _expect_call("get_weather")(mk({"content": 'sure: {"name": "get_weather"...}'}))
    assert not ok and layer == "parser", "tool-shaped prose without extraction = suspected parser"
    ok, layer, _ = _expect_call("get_weather")(mk({"content": "I cannot help."}))
    assert not ok and layer == "model"
    bad = mk({"tool_calls": [{"function": {"name": "get_weather", "arguments": "{city: Paris}"}}]})
    ok, layer, _ = _expect_call("get_weather")(bad)
    assert not ok and layer == "serialization"

    ok, layer, _ = _expect_no_call(call("get_weather", {"city": "Paris"}))
    assert not ok and layer == "parser", "extracting prose as a call = overtrigger"
    assert _expect_no_call(mk({"content": "It would fetch Paris weather."}))[0]

    j2 = _expect_n_calls(2, tool="get_weather", want_cities={"Paris", "Oslo"})
    assert j2(two("Paris", "Oslo"))[0]
    assert j2(two("oslo", "PARIS"))[0], "order/case-free"
    ok, _, note = j2(two("Paris", "Paris"))
    assert not ok and "cities" in note, "audit-2: Paris-twice must FAIL the two-cities ask"

    nested = call("run_query", {"filter": {"field": "name", "op": "=", "value": 'O"Brien, Jr.'}, "limit": 5})
    assert _expect_nested_roundtrip(nested)[0]
    mangled = call("run_query", {"filter": {"field": "name", "op": "=", "value": "OBrien Jr."}, "limit": 5})
    ok, layer, _ = _expect_nested_roundtrip(mangled)
    assert not ok and layer == "serialization"
    # audit-3: the full requested shape is verified, not only the hard value
    wrong_shape = call("run_query", {"filter": {"field": "surname", "op": "=", "value": 'O"Brien, Jr.'}, "limit": 5})
    ok, layer, _ = _expect_nested_roundtrip(wrong_shape)
    assert not ok and layer == "model", "wrong field must fail even with a perfect value"
    no_limit = call("run_query", {"filter": {"field": "name", "op": "=", "value": 'O"Brien, Jr.'}, "limit": 50})
    assert not _expect_nested_roundtrip(no_limit)[0], "limit=50 must fail the limit-5 ask"
    wrong_tool = call("get_weather", {"filter": {"field": "name", "op": "=", "value": 'O"Brien, Jr.'}, "limit": 5})
    assert not _expect_nested_roundtrip(wrong_tool)[0], "wrong tool must fail"

    assert _expect_text_end(mk({"content": "It is 22C in Paris."}))[0]
    assert not _expect_text_end(call("get_weather", {"city": "Paris"}))[0]
    print("canary selftest: OK (strict value judges incl. audit-2 regressions, suspected-layer attribution, no network)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    else:
        models = [a for a in sys.argv[1:] if not a.startswith("-")]
        if not models:
            raise SystemExit("usage: canary.py <model> [model...] | --selftest   (env: LLAMA_URL, LLAMA_API_KEY)")
        for m in models:
            print(f"== canary: {m} @ {URL}")
            run_model(m)
