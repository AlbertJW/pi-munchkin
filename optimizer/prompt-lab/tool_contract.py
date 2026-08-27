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
LOCAL_ORACLES = {"tool_call_observed", "recovery_observed", "edit_persisted", "write_persisted", "verification_passed"}
TOOL_NAMES = {"read", "search_spans", "read_span", "bash", "edit", "write", "verify_project", "capability", "plan_write", "plan_update"}
FIXTURE_NAMES = {
    "bounded-read", "span-search", "span-read", "shell-recovery", "anchored-edit",
    "write-persist", "verify-after-mutation", "capability-activation", "planner-write",
    "planner-update",
}
CASE_TOOL_ALLOWLISTS = {
    "bounded-read": "read",
    "span-search": "search_spans,read_span",
    "span-read": "search_spans,read_span",
    "shell-recovery": "bash",
    "anchored-edit": "read,edit",
    "write-persist": "read,write",
    "verify-after-mutation": "read,edit,verify_project",
    "capability-activation": "capability",
    # An explicit --tools list is authoritative in Pi and prevents the
    # capability tool from activating deferred planning tools. Keep these
    # cases on the normal dynamic surface so they qualify the capability
    # activation path rather than a preselected tool list.
    "planner-write": "auto",
    "planner-update": "auto",
}
CASE_LOCAL_ORACLES = {
    "bounded-read": "tool_call_observed",
    "span-search": "tool_call_observed",
    "span-read": "tool_call_observed",
    "shell-recovery": "recovery_observed",
    "anchored-edit": "edit_persisted",
    "write-persist": "write_persisted",
    "verify-after-mutation": "verification_passed",
    "capability-activation": "tool_call_observed",
    "planner-write": "tool_call_observed",
    "planner-update": "tool_call_observed",
}
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
        if case.get("local_oracle") not in LOCAL_ORACLES:
            errors.append(f"{case_id}: unknown local oracle")
        if not isinstance(case.get("prompt"), str) or not case["prompt"].strip():
            errors.append(f"{case_id}: prompt is required")
        fixture = case.get("fixture")
        if fixture not in FIXTURE_NAMES:
            errors.append(f"{case_id}: unknown fixture")
        if case.get("tool_allowlist") != CASE_TOOL_ALLOWLISTS.get(fixture):
            errors.append(f"{case_id}: tool_allowlist must match its fixture profile")
        recovery = case.get("allowed_recovery")
        if not isinstance(recovery, list) or any(not isinstance(item, str) for item in recovery):
            errors.append(f"{case_id}: allowed_recovery must be a string list")
    return sorted(errors)


def seed_fixture(case_dir, case):
    """Create only the deterministic, case-local files the model is meant to use."""
    fixture = case["fixture"]
    (case_dir / "fixture.txt").write_text(
        "alpha=1\nbeta=2\nTARGET_SYMBOL=before\nmarker=stable\n",
        encoding="utf-8",
    )
    if fixture in {"span-search", "span-read"}:
        (case_dir / "source.txt").write_text(
            "header\n" + "\n".join(
                f"line-{index}: {'TARGET_SYMBOL' if index == 37 else 'ordinary'} value={index}"
                for index in range(1, 81)
            ) + "\nfooter\n",
            encoding="utf-8",
        )
    if fixture == "shell-recovery":
        check = case_dir / "check.sh"
        check.write_text("#!/bin/sh\necho 'intentional fixture check failure' >&2\nexit 1\n", encoding="utf-8")
        check.chmod(0o755)
        (case_dir / "fallback.txt").write_text("fallback verification marker\n", encoding="utf-8")
    if fixture == "anchored-edit":
        (case_dir / "edit-target.txt").write_text("STATUS=before\nKEEP=unchanged\n", encoding="utf-8")
    if fixture == "verify-after-mutation":
        (case_dir / "edit-target.txt").write_text("STATUS=before\n", encoding="utf-8")
        (case_dir / "verify.js").write_text(
            "const fs = require('node:fs');\n"
            "if (fs.readFileSync('edit-target.txt', 'utf8').trim() !== 'STATUS=after') process.exit(1);\n",
            encoding="utf-8",
        )
        (case_dir / "package.json").write_text(
            json.dumps({"name": "tool-contract-fixture", "private": True, "scripts": {"test": "node verify.js"}}) + "\n",
            encoding="utf-8",
        )


def fixture_paths(case_dir, case):
    fixture = case["fixture"]
    paths = ["fixture.txt"]
    if fixture in {"span-search", "span-read"}: paths.append("source.txt")
    if fixture == "shell-recovery": paths.extend(["check.sh", "fallback.txt"])
    if fixture == "anchored-edit": paths.append("edit-target.txt")
    if fixture == "verify-after-mutation": paths.extend(["edit-target.txt", "verify.js", "package.json"])
    return [str(case_dir / path) for path in paths]


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


def evaluate_local_oracle(case_dir, case, row):
    """Check only deterministic case-local state; never expose file contents."""
    oracle = case["local_oracle"]
    outcome = row["outcome"]
    if oracle == "tool_call_observed":
        return bool(outcome.get("required_tool_observed"))
    if oracle == "recovery_observed":
        return bool(outcome.get("recovery_observed"))
    if oracle == "edit_persisted":
        try:
            return (case_dir / "edit-target.txt").read_text(encoding="utf-8") == "STATUS=after\nKEEP=unchanged\n"
        except OSError:
            return False
    if oracle == "write_persisted":
        try:
            return (case_dir / "write-target.txt").read_text(encoding="utf-8") == "PERSISTED=ok\n"
        except OSError:
            return False
    if oracle == "verification_passed":
        try:
            if (case_dir / "edit-target.txt").read_text(encoding="utf-8") != "STATUS=after\n":
                return False
            checked = subprocess.run(
                ["node", "verify.js"], cwd=case_dir, stdout=subprocess.PIPE,
                stderr=subprocess.PIPE, timeout=10, check=False,
            )
            return checked.returncode == 0
        except (OSError, subprocess.SubprocessError):
            return False
    return False


def selftest():
    manifest = load_manifest()
    errors = validate_manifest(manifest)
    assert not errors, errors
    assert json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))["$id"] == MANIFEST_SCHEMA
    # Exercise every deterministic fixture/oracle pair without invoking a
    # model. This keeps the qualification boundary useful in offline CI and
    # prevents a newly added oracle from becoming an untested status bit.
    import tempfile
    for fixture_case in manifest["cases"]:
        with tempfile.TemporaryDirectory() as directory:
            fixture_dir = Path(directory)
            seed_fixture(fixture_dir, fixture_case)
            synthetic = {"outcome": {
                "required_tool_observed": True,
                "recovery_observed": fixture_case["local_oracle"] == "recovery_observed",
            }}
            oracle = fixture_case["local_oracle"]
            if oracle == "edit_persisted":
                (fixture_dir / "edit-target.txt").write_text("STATUS=after\nKEEP=unchanged\n", encoding="utf-8")
            elif oracle == "write_persisted":
                (fixture_dir / "write-target.txt").write_text("PERSISTED=ok\n", encoding="utf-8")
            elif oracle == "verification_passed":
                (fixture_dir / "edit-target.txt").write_text("STATUS=after\n", encoding="utf-8")
            assert evaluate_local_oracle(fixture_dir, fixture_case, synthetic) is True, oracle
    case = manifest["cases"][4]
    with tempfile.TemporaryDirectory() as directory:
        case_dir = Path(directory)
        seed_fixture(case_dir, case)
        assert (case_dir / "edit-target.txt").read_text(encoding="utf-8").startswith("STATUS=before")
        assert fixture_paths(case_dir, case)
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
    capture_dir = output_dir / ".captures"
    capture_dir.mkdir(parents=True, exist_ok=True)
    for case in manifest["cases"]:
        case_dir = output_dir / case["id"]
        case_dir.mkdir(parents=True, exist_ok=True)
        seed_fixture(case_dir, case)
        prompt_path = case_dir / "prompt.txt"
        # The trace must not be created under the model's cwd: a Pi can otherwise
        # read its own growing stdout and enter a self-observing loop. Capture
        # stdout in the parent, then materialize the trace only after exit.
        trace_path = capture_dir / f"{case['id']}.trace.jsonl"
        requirement = (
            f"Protocol requirement: call the required `{case['required_tool']}` tool before any final answer; "
            "do not claim completion without its tool result. Use only the declared fixture paths."
        )
        if case["id"] == "anchored-edit":
            requirement += " After the read, use exactly one edit call with a [path#TAG] header and `replace 1..1:` followed by `+STATUS=after`; stop after success."
        if case["id"] == "verify-after-mutation":
            requirement += " You MUST call `verify_project` after the edit; do not substitute bash, npm, or node for that tool."
        if case["id"] == "planner-write":
            requirement += " Your first tool call MUST be capability(action=enable, family=planning), followed by exactly one plan_write call."
        if case["id"] == "planner-update":
            requirement += " Your first tool call MUST be capability(action=enable, family=planning), then plan_write, then plan_update; do not use shell or write files."
        prompt_path.write_text(
            requirement + "\n\n"
            f"Task: {case['prompt']}\n",
            encoding="utf-8",
        )
        env = dict(os.environ)
        env.update({
            "PI_MODEL": model,
            "TOOL_CONTRACT_CASE": case["id"],
            "TOOL_CONTRACT_PROMPT_FILE": str(prompt_path),
            "TOOL_CONTRACT_TRACE_FILE": str(trace_path),
            "TOOL_CONTRACT_FIXTURE_ROOT": str(case_dir),
            # Empty means the adapter should omit --tools and let the harness
            # expose capability-driven deferred tools. Never treat "auto" as
            # a Pi tool name.
            "TOOL_CONTRACT_TOOLS": "" if case["tool_allowlist"] == "auto" else case["tool_allowlist"],
        })
        if case["id"] == "verify-after-mutation":
            # The fixture is a deliberately tiny package; pin its exact gate
            # so verify_project is available even when Pi's auto-detection is
            # affected by a host settings profile.
            env["VERIFY_GATE_CMD"] = "npm test"
        completed = subprocess.run(command, cwd=case_dir, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
        trace_path.write_bytes(completed.stdout)
        row = classify_trace(trace_path, case, model) if trace_path.exists() else {
            "schema": SCHEMA, "case_id": case["id"], "model": model,
            "status": "incomplete", "required_tool": case["required_tool"],
            "oracle": case["oracle"], "outcome": {"tool_call_attempted": False},
            "observed_tool_families": [],
        }
        local_passed = evaluate_local_oracle(case_dir, case, row)
        row["local_oracle"] = case["local_oracle"]
        row.setdefault("outcome", {})["local_oracle_passed"] = local_passed
        if row["status"] == "complete" and not local_passed:
            row["status"] = "incomplete"
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
