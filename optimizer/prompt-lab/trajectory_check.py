#!/usr/bin/env python3
"""Fail-closed trajectory assertions backed only by execution-time receipts.

`search_spans` records a `pi.tool-receipt/v1` object in the matching tool-result
row.  Call arguments, visible headers, and arbitrary shell strings are not
evidence.  c23 currently requires an exhaustive receipt for bigdata's corpus.
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "ab-machinery"))
from metrics import session_files_for  # noqa: E402


def file_facts(path: Path) -> dict:
    data = path.read_bytes()
    if not data:
        lines = 0
    else:
        lines = data.count(b"\n") + (0 if data.endswith(b"\n") else 1)
    return {
        "path": str(path.resolve()),
        "sha256": hashlib.sha256(data).hexdigest(),
        "size": len(data),
        "lines": lines,
    }


def _calls_and_results(msgs):
    calls = {}
    results = []
    for msg in msgs:
        role = msg.get("role")
        if role == "assistant":
            for item in msg.get("content") or []:
                if isinstance(item, dict) and item.get("type") == "toolCall":
                    calls[str(item.get("id", ""))] = {
                        "name": str(item.get("name", "")).lower(),
                        "arguments": item.get("arguments") or {},
                    }
        elif role == "toolResult":
            results.append(msg)
    return calls, results


def validate_search_receipt(call, result, expected):
    if not call or call.get("name") != "search_spans":
        return False, "result has no matching search_spans call id"
    if result.get("isError"):
        return False, "search_spans result is an error"
    receipt = ((result.get("details") or {}).get("receipt") or {})
    if receipt.get("schema") != "pi.tool-receipt/v1" or receipt.get("operation") != "search_spans":
        return False, "missing pi.tool-receipt/v1 execution receipt"
    checks = {
        "normalized file": receipt.get("normalized_file") == expected["path"],
        "sha256": receipt.get("sha256") == expected["sha256"],
        "size": receipt.get("size_bytes") == expected["size"],
        "bytes examined": receipt.get("bytes_examined") == expected["size"],
        "line count": receipt.get("total_lines_scanned") == expected["lines"],
        "complete": receipt.get("complete") is True,
    }
    failed = [name for name, ok in checks.items() if not ok]
    if failed:
        return False, "receipt mismatch: " + ", ".join(failed)
    return True, "verified exhaustive search_spans receipt"


def check_bigdata(msgs, corpus: Path, expected_corpus: Path | None = None):
    if not corpus.is_file():
        return False, f"expected corpus missing: {corpus}"
    expected = file_facts(expected_corpus or corpus)
    expected["path"] = str(corpus.resolve())
    calls, results = _calls_and_results(msgs)
    reasons = []
    for result in results:
        call = calls.get(str(result.get("toolCallId", "")))
        if not call or call.get("name") != "search_spans":
            continue
        ok, why = validate_search_receipt(call, result, expected)
        if ok:
            return True, why
        reasons.append(why)
    if reasons:
        return False, reasons[-1]
    return False, "no successful receipt-backed search_spans result for the corpus"


def load_msgs(session_path):
    msgs = []
    with open(session_path, encoding="utf-8") as fh:
        for line in fh:
            try:
                row = json.loads(line)
            except ValueError:
                continue
            if row.get("type") == "message":
                msgs.append(row["message"])
    return msgs


def check_session_files(session_paths, corpus: Path, expected_corpus: Path | None = None):
    """Validate attempts independently so reused toolCallIds cannot cross-bind."""
    reasons = []
    for session in session_paths:
        ok, why = check_bigdata(load_msgs(session), corpus, expected_corpus)
        if ok:
            return True, why
        reasons.append(f"{Path(session).name}: {why}")
    return False, "; ".join(reasons) if reasons else "no session attempts"


def _subagent_agents(call):
    """Agent name(s) a `subagent` toolCall's own recorded arguments name — single
    mode ({agent: "..."}) or parallel mode ({tasks: [{agent: "..."}, ...]})."""
    if call.get("name") != "subagent":
        return []
    args = call.get("arguments") or {}
    names = []
    if isinstance(args.get("agent"), str):
        names.append(args["agent"].strip().lower())
    for item in args.get("tasks") or []:
        if isinstance(item, dict) and isinstance(item.get("agent"), str):
            names.append(item["agent"].strip().lower())
    return names


def check_t4(msgs):
    """t4's canonical prompt mandates delegate-to-explorer THEN delegate-to-verifier.
    A subagent toolCall's own recorded arguments are harness-recorded evidence: strong
    evidence of invocation and execution (the harness only writes a matching result
    when the tool call actually ran), but not proof the resulting work was correct —
    unlike bigdata's search_spans case, where call arguments alone are trivially
    fakeable and a signed execution receipt is required instead. No receipt machinery
    needed here."""
    calls, results = _calls_and_results(msgs)
    results_by_call = {str(r.get("toolCallId", "")): r for r in results}
    explorer_seen = False
    for call_id, call in calls.items():
        names = _subagent_agents(call)
        if not names:
            continue
        result = results_by_call.get(call_id)
        if not result or result.get("isError"):
            continue  # only a completed, non-error invocation counts as delegation
        if "explorer" in names:
            explorer_seen = True
        if "verifier" in names and explorer_seen:
            return True, "verified subagent(explorer) preceded subagent(verifier)"
    if not explorer_seen:
        return False, "no successful subagent(agent=explorer) call found"
    return False, "subagent(agent=explorer) found but no later successful subagent(agent=verifier) call"


def check_t4_sessions(session_paths):
    reasons = []
    for session in session_paths:
        ok, why = check_t4(load_msgs(session))
        if ok:
            return True, why
        reasons.append(f"{Path(session).name}: {why}")
    return False, "; ".join(reasons) if reasons else "no session attempts"


def _assistant_text(msgs):
    """All assistant-authored text content, concatenated in message order."""
    parts = []
    for msg in msgs:
        if msg.get("role") != "assistant":
            continue
        content = msg.get("content")
        if not isinstance(content, list):
            continue
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text" and isinstance(block.get("text"), str):
                parts.append(block["text"])
    return "\n".join(parts)


def _mentions_both_conventions(msgs):
    text = _assistant_text(msgs).lower()
    return "discountcalc" in text and "taxcalc" in text


def check_sv_ambiguous_spec(msgs):
    """c31 (PLAN_UNCERTAINTY): sv-ambiguous-spec's prompt names two equally-active,
    concretely-specified tie-breaking conventions and withholds which one refunds
    should follow — a genuine fork, not a gap fillable by reading the repo harder.
    The candidate's claim is that the model surfaces this as a blocking uncertainty
    (plan_write's uncertainties[] field) instead of picking one and guessing. A
    plan_write toolCall's own recorded arguments are harness-recorded evidence:
    strong evidence of invocation and execution (the harness itself only writes a
    matching toolResult when the call actually ran), but not proof the resulting
    work was correct — unlike bigdata's search_spans case, where call arguments
    alone are trivially fakeable and a signed execution receipt is required
    instead. No receipt machinery needed here (same reasoning as check_t4).

    Fallback: plan_write's uncertainties[] field only exists in the model-visible
    tool schema when plan_write is actually called — on tasks small enough that a
    model skips planning entirely (measured: 0/6 sessions called plan_write at all
    in the first live c31 round against this fixture), the primary signal has no
    surface to fire on. The fallback checks whether the model's own text ever names
    both precedent files together. Weaker evidence than a harness-recorded tool
    argument — free text a model could produce while still guessing — so it's only
    consulted when the primary signal is absent, never preferred over it."""
    calls, results = _calls_and_results(msgs)
    results_by_call = {str(r.get("toolCallId", "")): r for r in results}
    for call_id, call in calls.items():
        if call.get("name") != "plan_write":
            continue
        result = results_by_call.get(call_id)
        if not result or result.get("isError"):
            continue  # only a completed, non-error invocation counts as a declaration
        uncertainties = (call.get("arguments") or {}).get("uncertainties")
        if isinstance(uncertainties, list) and any(str(u).strip() for u in uncertainties):
            return True, "verified plan_write declared a non-empty uncertainties[] entry"
    if _mentions_both_conventions(msgs):
        return True, "fallback: assistant text names both discountCalc and taxCalc conventions together"
    return False, "no successful plan_write call declared a blocking uncertainty, and no fallback text signal found"


def check_sv_ambiguous_spec_sessions(session_paths):
    reasons = []
    for session in session_paths:
        ok, why = check_sv_ambiguous_spec(load_msgs(session))
        if ok:
            return True, why
        reasons.append(f"{Path(session).name}: {why}")
    return False, "; ".join(reasons) if reasons else "no session attempts"


def check(workdir, task):
    if task == "t4":
        sessions = session_files_for(workdir)
        if not sessions:
            return False, "no session found — trajectory evidence unavailable (fail closed)"
        return check_t4_sessions(sessions)
    if task == "sv-ambiguous-spec":
        sessions = session_files_for(workdir)
        if not sessions:
            return False, "no session found — trajectory evidence unavailable (fail closed)"
        return check_sv_ambiguous_spec_sessions(sessions)
    if task != "bigdata":
        return True, "no trajectory rule for this task"
    sessions = session_files_for(workdir)
    if not sessions:
        return False, "no session found — trajectory evidence unavailable (fail closed)"
    canonical = Path(__file__).resolve().parents[1] / "real-gate-fixtures/bigdata/data/events.jsonl"
    return check_session_files(sessions, Path(workdir) / "data/events.jsonl", canonical)


def selftest():
    with tempfile.TemporaryDirectory() as td:
        corpus = Path(td) / "events.jsonl"
        corpus.write_text('{"x":"é"}\n{"x":2}\n', encoding="utf-8")
        facts = file_facts(corpus)
        call_id = "call-1"

        def messages(receipt=None, *, result=True, call=True, error=False):
            out = []
            if call:
                out.append({"role": "assistant", "content": [{
                    "type": "toolCall", "id": call_id, "name": "search_spans",
                    "arguments": {"path": "data/events.jsonl", "pattern": "."},
                }]})
            if result:
                out.append({"role": "toolResult", "toolCallId": call_id, "toolName": "search_spans",
                            "details": {"receipt": receipt or {}}, "isError": error})
            return out

        valid = {"schema": "pi.tool-receipt/v1", "operation": "search_spans",
                 "normalized_file": facts["path"], "sha256": facts["sha256"],
                 "size_bytes": facts["size"], "bytes_examined": facts["size"],
                 "total_lines_scanned": facts["lines"], "complete": True}
        assert check_bigdata(messages(valid), corpus)[0]
        for field, value in (("sha256", "0" * 64), ("size_bytes", 1),
                             ("bytes_examined", facts["size"] - 1),
                             ("total_lines_scanned", 1), ("complete", False),
                             ("normalized_file", str(Path(td) / "wrong.jsonl"))):
            bad = dict(valid); bad[field] = value
            assert not check_bigdata(messages(bad), corpus)[0], field
        assert not check_bigdata(messages(valid, result=False), corpus)[0]  # argument-only forgery
        assert not check_bigdata(messages(valid, call=False), corpus)[0]  # orphan result
        assert not check_bigdata(messages(valid, error=True), corpus)[0]
        # Fresh retries create another JSONL. Receipt evidence from either attempt
        # remains valid treatment-compliance evidence for the combined row.
        attempts = messages({**valid, "complete": False}) + messages(valid)
        assert check_bigdata(attempts, corpus)[0]
        first = Path(td) / "attempt-1.jsonl"; second = Path(td) / "attempt-2.jsonl"
        first.write_text("\n".join(json.dumps({"type": "message", "message": msg})
                                         for msg in messages({**valid, "complete": False})) + "\n")
        # Reuse the same call id in the retry. Independent validation must accept
        # its valid receipt without cross-binding to the first attempt.
        second.write_text("\n".join(json.dumps({"type": "message", "message": msg})
                                          for msg in messages(valid)) + "\n")
        assert check_session_files([first, second], corpus)[0]
        assert check("/missing", "t1")[0]

        def subagent_call(call_id, agent, *, error=False, skip_result=False, tasks=None):
            args = {"tasks": tasks} if tasks else {"agent": agent, "task": "..."}
            out = [{"role": "assistant", "content": [{"type": "toolCall", "id": call_id,
                                                        "name": "subagent", "arguments": args}]}]
            if not skip_result:
                out.append({"role": "toolResult", "toolCallId": call_id, "toolName": "subagent",
                            "details": {}, "isError": error})
            return out

        explore_then_verify = subagent_call("c1", "explorer") + subagent_call("c2", "verifier")
        assert check_t4(explore_then_verify)[0]
        verify_then_explore = subagent_call("c1", "verifier") + subagent_call("c2", "explorer")
        assert not check_t4(verify_then_explore)[0]  # wrong order
        assert not check_t4(subagent_call("c1", "explorer"))[0]  # no verifier at all
        assert not check_t4([])[0]  # no delegation at all
        failed_explore = subagent_call("c1", "explorer", error=True) + subagent_call("c2", "verifier")
        assert not check_t4(failed_explore)[0]  # errored explorer call doesn't count
        unresulted_explore = subagent_call("c1", "explorer", skip_result=True) + subagent_call("c2", "verifier")
        assert not check_t4(unresulted_explore)[0]  # call with no matching result doesn't count
        parallel = subagent_call("c1", None, tasks=[{"agent": "explorer", "task": "x"}]) + \
            subagent_call("c2", None, tasks=[{"agent": "verifier", "task": "y"}])
        assert check_t4(parallel)[0]  # parallel-mode {tasks:[{agent,...}]} shape also counts

        def plan_write_call(call_id, uncertainties=None, *, error=False, skip_result=False):
            args = {"items": [{"title": "x", "status": "pending"}]}
            if uncertainties is not None:
                args["uncertainties"] = uncertainties
            out = [{"role": "assistant", "content": [{"type": "toolCall", "id": call_id,
                                                        "name": "plan_write", "arguments": args}]}]
            if not skip_result:
                out.append({"role": "toolResult", "toolCallId": call_id, "toolName": "plan_write",
                            "details": {}, "isError": error})
            return out

        assert check_sv_ambiguous_spec(plan_write_call("p1", ["which rounding rule applies to refunds?"]))[0]
        assert not check_sv_ambiguous_spec(plan_write_call("p1"))[0]  # no uncertainties field at all
        assert not check_sv_ambiguous_spec(plan_write_call("p1", []))[0]  # cleared/never populated
        assert not check_sv_ambiguous_spec(plan_write_call("p1", ["   "]))[0]  # blank-only entry
        assert not check_sv_ambiguous_spec([])[0]  # no plan_write call at all
        failed_declare = plan_write_call("p1", ["which rule?"], error=True)
        assert not check_sv_ambiguous_spec(failed_declare)[0]  # errored call doesn't count
        unresulted_declare = plan_write_call("p1", ["which rule?"], skip_result=True)
        assert not check_sv_ambiguous_spec(unresulted_declare)[0]  # call with no matching result doesn't count
        # A later clearing call ([]) doesn't erase the earlier declaration as evidence.
        declare_then_clear = plan_write_call("p1", ["which rule?"]) + plan_write_call("p2", [])
        assert check_sv_ambiguous_spec(declare_then_clear)[0]

        def text_message(text):
            return [{"role": "assistant", "content": [{"type": "text", "text": text}]}]

        both_named = text_message(
            "discountCalc.js rounds ties up, taxCalc.js rounds ties to even -- going with round-to-even.")
        assert check_sv_ambiguous_spec(both_named)[0]  # fallback fires with zero plan_write calls
        one_named = text_message("Following discountCalc.js's convention for refund rounding.")
        assert not check_sv_ambiguous_spec(one_named)[0]  # only one file named -- not a real fork signal
        neither_named = text_message("Implemented roundRefundCents and ran the tests.")
        assert not check_sv_ambiguous_spec(neither_named)[0]
        # Fallback only kicks in when the primary signal is absent; a plan_write
        # call with no uncertainties still fails even if the text also names both.
        primary_absent_fallback_present = plan_write_call("p1") + both_named
        assert check_sv_ambiguous_spec(primary_absent_fallback_present)[0]  # via fallback, not primary
    print("trajectory_check selftest: OK (receipt binding, UTF-8 bytes, stale/partial/wrong-file rejection, "
          "t4 delegation ordering, sv-ambiguous-spec uncertainty declaration + fallback text signal)")


if __name__ == "__main__":
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) >= 3:
        ok, why = check(sys.argv[1], sys.argv[2])
        if not ok:
            sys.stderr.write(f"[trajectory] {sys.argv[2]}: {why}\n")
        raise SystemExit(0 if ok else 1)
    else:
        raise SystemExit("usage: trajectory_check.py <workdir> <task> | --selftest")
