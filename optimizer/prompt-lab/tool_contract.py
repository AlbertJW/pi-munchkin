#!/usr/bin/env python3
"""Model-neutral Pi tool-contract qualification.

This is a protocol screen, not a coding-efficacy benchmark. It records bounded
tool-call outcome classes and deliberately emits ``pi.tool-contract/v1`` rows
that fleet adoption code rejects.
"""
import argparse
import json
import os
import re
import subprocess
import sys
from pathlib import Path


SCHEMA = "pi.tool-contract/v1"
MANIFEST_SCHEMA = "pi.tool-contract-manifest/v1"
ALLOWED_ORACLES = {"tool_call_observed", "mutation_and_verify_observed"}
TOOL_NAMES = {"read", "search_spans", "read_span", "bash", "edit", "write", "verify_project", "capability", "plan_write", "plan_update"}
DEFAULT_MANIFEST = Path(__file__).with_name("tool-contract-v1.json")
SCHEMA_PATH = Path(__file__).resolve().parents[1] / "real-gate-fixtures" / "schemas" / "pi.tool-contract-v1.schema.json"


def load_manifest(path=DEFAULT_MANIFEST):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def validate_manifest(manifest):
    errors = []
    if not isinstance(manifest, dict) or manifest.get("schema") != MANIFEST_SCHEMA:
        return ["manifest schema must be pi.tool-contract-manifest/v1"]
    cases = manifest.get("cases")
    if not isinstance(cases, list) or not cases:
        return ["manifest cases must be a non-empty list"]
    ids = set()
    for case in cases:
        if not isinstance(case, dict):
            errors.append("case must be an object")
            continue
        case_id = case.get("id")
        if not isinstance(case_id, str) or not re.fullmatch(r"[a-z0-9-]+", case_id):
            errors.append("case id is malformed")
        elif case_id in ids:
            errors.append(f"duplicate case id: {case_id}")
        ids.add(case_id)
        if case.get("required_tool") not in TOOL_NAMES:
            errors.append(f"{case_id}: unknown required tool")
        if case.get("oracle") not in ALLOWED_ORACLES:
            errors.append(f"{case_id}: unknown oracle")
        if not isinstance(case.get("prompt"), str) or not case["prompt"].strip():
            errors.append(f"{case_id}: prompt is required")
        recovery = case.get("allowed_recovery")
        if not isinstance(recovery, list) or any(not isinstance(item, str) for item in recovery):
            errors.append(f"{case_id}: allowed_recovery must be a string list")
    return sorted(errors)


def _text_blocks(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return " ".join(str(block.get("text", "")) for block in content if isinstance(block, dict))
    return ""


def classify_trace(path, case, model):
    """Reduce a Pi JSON event stream without returning arguments or content."""
    calls = 0
    observed_tools = []
    execution_errors = 0
    schema_rejections = 0
    successful_results = 0
    mutation_calls = 0
    verify_calls = 0
    successful_mutations = 0
    successful_verifications = 0
    calls_by_id = {}
    for line in Path(path).read_text(encoding="utf-8", errors="replace").splitlines():
        try:
            event = json.loads(line)
        except Exception:
            continue
        message = event.get("message") if isinstance(event, dict) else None
        if not isinstance(message, dict):
            continue
        if message.get("role") == "assistant":
            for block in message.get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "toolCall":
                    continue
                name = str(block.get("name") or "").lower()
                calls += 1
                if block.get("id"):
                    calls_by_id[str(block["id"])] = name
                if name in TOOL_NAMES:
                    observed_tools.append(name)
                if name in {"edit", "write", "plan_write", "plan_update", "bash"}:
                    mutation_calls += 1
                if name == "verify_project":
                    verify_calls += 1
        elif message.get("role") in ("tool", "toolResult"):
            is_error = message.get("isError") or any(isinstance(block, dict) and block.get("isError") for block in (message.get("content") or []))
            tool_name = str(message.get("toolName") or calls_by_id.get(str(message.get("toolCallId") or "")) or "").lower()
            if is_error:
                error_text = _text_blocks(message.get("content"))
                if re.search(r"schema|invalid|required|unknown (?:tool|field)|argument", error_text, re.IGNORECASE):
                    schema_rejections += 1
                else:
                    execution_errors += 1
            else:
                successful_results += 1
                if tool_name in {"edit", "write", "plan_write", "plan_update", "bash"}:
                    successful_mutations += 1
                if tool_name == "verify_project":
                    successful_verifications += 1
    required = case["required_tool"]
    observed = required in observed_tools
    if case["oracle"] == "mutation_and_verify_observed":
        passed = observed and successful_mutations > 0 and successful_verifications > 0
    else:
        passed = observed
    return {
        "schema": SCHEMA,
        "case_id": case["id"],
        "model": model,
        "status": "complete" if passed else "incomplete",
        "required_tool": required,
        "oracle": case["oracle"],
        "outcome": {
            "tool_call_attempted": calls > 0,
            "required_tool_observed": observed,
            "schema_rejected": schema_rejections,
            "execution_failed": execution_errors,
            "completed": successful_results,
            "mutation_tool_calls": mutation_calls,
            "verification_tool_calls": verify_calls,
            "mutation_persisted": successful_mutations > 0,
            "verification_passed": successful_verifications > 0,
            "recovery_observed": execution_errors > 0 and successful_results > 0,
        },
        "observed_tool_families": sorted(set(observed_tools)),
    }


def selftest():
    manifest = load_manifest()
    errors = validate_manifest(manifest)
    assert not errors, errors
    assert json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["$id"] == MANIFEST_SCHEMA
    case = manifest["cases"][4]
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        trace = Path(directory) / "trace.jsonl"
        trace.write_text("\n".join([
            json.dumps({"type": "message_end", "message": {"role": "assistant", "content": [{"type": "toolCall", "name": "edit", "arguments": {}}]}}),
            json.dumps({"type": "message_end", "message": {"role": "toolResult", "isError": False, "content": []}}),
        ]))
        row = classify_trace(trace, case, "local-llamacpp/ling3-tiny-fast")
        assert row["schema"] == SCHEMA
        assert row["outcome"]["required_tool_observed"] is True
        assert "arguments" not in json.dumps(row)
        assert "content" not in json.dumps(row)
    assert validate_manifest({"schema": SCHEMA, "cases": [{"id": "bad id"}]})
    print("tool_contract selftest: OK")


def run_command(manifest, model, output_dir, command):
    if not command:
        raise SystemExit("--run requires a command after --command; this is the explicit model-execution boundary")
    output_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for case in manifest["cases"]:
        case_dir = output_dir / case["id"]
        case_dir.mkdir(parents=True, exist_ok=True)
        prompt_path = case_dir / "prompt.txt"
        trace_path = case_dir / "trace.jsonl"
        prompt_path.write_text(case["prompt"], encoding="utf-8")
        env = dict(os.environ)
        env.update({
            "PI_MODEL": model,
            "TOOL_CONTRACT_CASE": case["id"],
            "TOOL_CONTRACT_PROMPT_FILE": str(prompt_path),
            "TOOL_CONTRACT_TRACE_FILE": str(trace_path),
        })
        with open(trace_path, "w", encoding="utf-8") as trace:
            completed = subprocess.run(command, cwd=case_dir, env=env, stdout=trace, stderr=subprocess.PIPE, check=False)
        row = classify_trace(trace_path, case, model) if trace_path.exists() else {
            "schema": SCHEMA, "case_id": case["id"], "model": model,
            "status": "incomplete", "required_tool": case["required_tool"],
            "oracle": case["oracle"], "outcome": {"tool_call_attempted": False},
            "observed_tool_families": [],
        }
        row["process_exit_code"] = completed.returncode
        row["stderr_present"] = bool(completed.stderr)
        rows.append(row)
    return {"schema": SCHEMA, "manifest_version": manifest.get("version"), "model": model, "cases": rows}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--dry", action="store_true")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--confirm", action="store_true", help="required with --run; explicit model-execution acknowledgement")
    parser.add_argument("--model")
    parser.add_argument("--manifest", default=str(DEFAULT_MANIFEST))
    parser.add_argument("--output-dir", default="tool-contract-run")
    parser.add_argument("--output", default="tool-contract-result.json")
    parser.add_argument("--command", nargs=argparse.REMAINDER)
    args = parser.parse_args(argv)
    if args.selftest:
        selftest(); return
    manifest = load_manifest(args.manifest)
    errors = validate_manifest(manifest)
    if errors:
        raise SystemExit("invalid tool-contract manifest:\n  " + "\n  ".join(errors))
    if not args.model:
        raise SystemExit("--model is required")
    if args.dry:
        print(json.dumps({"schema": SCHEMA, "manifest": os.path.basename(args.manifest), "model": args.model,
                          "cases": [case["id"] for case in manifest["cases"]], "execution": "none"}, indent=2))
        return
    if not args.run:
        raise SystemExit("choose --selftest, --dry, or --run")
    if not args.confirm:
        raise SystemExit("--run requires --confirm")
    command = args.command or []
    result = run_command(manifest, args.model, Path(args.output_dir), command)
    with open(args.output, "w", encoding="utf-8") as handle:
        json.dump(result, handle, indent=2, sort_keys=True)
        handle.write("\n")
    print(json.dumps({"schema": SCHEMA, "model": args.model, "output": args.output,
                      "complete_cases": sum(row["status"] == "complete" for row in result["cases"]),
                      "total_cases": len(result["cases"])}, sort_keys=True))


if __name__ == "__main__":
    main()
