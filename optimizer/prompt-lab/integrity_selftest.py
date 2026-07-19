#!/usr/bin/env python3
"""Offline acceptance tests for the benchmark-integrity upgrade."""
from __future__ import annotations

import copy
import datetime as dt
import json
import os
import subprocess
import tempfile
import argparse
from pathlib import Path

import fixture_admission as admission


def test_admission_catalog():
    manifests = sorted(admission.MANIFESTS.glob("*.json"))
    assert len(manifests) == 18, len(manifests)
    for path in manifests:
        manifest = json.loads(path.read_text())
        admission.validate_contract(manifest)
        auto = manifest["admission"].get("automated")
        assert auto and auto["passed"], f"{path.stem}: admission not passed"
        states = auto["states"]
        assert all(x["passed"] for x in states["pristine_pass_to_pass"])
        assert all(not x["passed"] for x in states["pristine_fail_to_pass"])
        assert all(x["passed"] for x in states["gold_pass_to_pass"])
        assert all(x["passed"] for x in states["gold_fail_to_pass"])
        for name, result in states.items():
            if name.startswith("mutant:"):
                assert all(not x["passed"] for x in result["fail_to_pass"])
        if manifest["admission"].get("approved"):
            assert manifest["admission"].get("reviewer") and manifest["admission"].get("reviewed_at")
        else:
            assert admission.authoritative(manifest)[0] is False  # human approval is mandatory

        approved = copy.deepcopy(manifest)
        approved["admission"].update(approved=True, reviewer="selftest", reviewed_at="2026-07-14T00:00:00Z")
        approved["timestamps"]["expires_at"] = "2099-01-01T00:00:00Z"
        assert admission.authoritative(approved)[0]
        approved["timestamps"]["expires_at"] = "2000-01-01T00:00:00Z"
        assert admission.authoritative(approved)[1] == "fixture expired"
        approved["timestamps"]["expires_at"] = "2099-01-01T00:00:00Z"
        approved["artifacts"][0]["sha256"] = "0" * 64
        assert admission.authoritative(approved)[1] == "artifact hash drift"

    broken = json.loads(manifests[0].read_text()); broken["sufficiency"] = []
    try: admission.validate_contract(broken)
    except admission.AdmissionError: pass
    else: raise AssertionError("missing sufficiency mapping accepted")


def test_fingerprint():
    import serving_fingerprint as sf
    with tempfile.TemporaryDirectory() as td:
        sf.CACHE = Path(td) / "cache.json"
        p = Path(td) / "model.gguf"; p.write_bytes(b"one")
        first, _ = sf.file_sha(p); p.write_bytes(b"two-two")
        second, _ = sf.file_sha(p)
        assert first != second, "hash cache failed to invalidate on size/mtime"
        flags = sf.normalize_flags(["server", "--api-key", "secret", "--temp", "0.2"])
        assert "secret" not in flags and "<redacted>" in flags
        router = Path(td) / "router.yaml"; router.write_text("models: {}\n")
        backend = ["/x/llama-server", "-m", str(p), "--alias", "m", "--port", "5800", "-c", "4096",
                   "--cache-type-k", "q8_0", "--cache-type-v", "q8_0", "--temp", "0.2",
                   "--top-p", "0.9", "--top-k", "40", "--min-p", "0.05",
                   "--repeat-penalty", "1.1", "--presence-penalty", "0", "--seed", "42",
                   "--spec-type", "draft-mtp", "--draft-max", "3", "--draft-p-min", "0.2"]
        original_rows, original_fetch = sf.process_rows, sf.fetch_json
        template = ["template-a"]
        sf.process_rows = lambda: [(1, backend, " ".join(backend)),
                                   (2, ["/x/llama-swap", "--config", str(router)], "router")]
        def fake_fetch(url, timeout=3):
            if url.endswith("/v1/models"):
                return {"data": [{"id": "m", "status": {"value": "loaded"}}]}
            return {"model_alias": "m", "model_path": str(p), "build_info": "b1-deadbee",
                    "chat_template": template[0], "default_generation_settings": {"n_ctx": 4096,
                    "params": {"temperature": 0.2, "top_p": 0.9, "top_k": 40, "min_p": 0.05,
                               "repeat_penalty": 1.1, "presence_penalty": 0, "seed": 42}}}
        sf.fetch_json = fake_fetch
        try:
            local_a = sf.capture("http://127.0.0.1:8080", "m")
            template[0] = "template-b"
            local_b = sf.capture("http://127.0.0.1:8080", "m")
        finally:
            sf.process_rows, sf.fetch_json = original_rows, original_fetch
        assert local_a["status"] == "complete", local_a["missing"]
        assert local_a["fingerprint_sha256"] != local_b["fingerprint_sha256"], "template hot-swap not detected"
        old_file = sf.os.environ.pop("SERVING_FINGERPRINT_FILE", None)
        old_url = sf.os.environ.pop("SERVING_FINGERPRINT_URL", None)
        try:
            remote = sf.remote_document("m")
            assert remote["status"] == "incomplete" and remote["missing"]
        finally:
            if old_file is not None: sf.os.environ["SERVING_FINGERPRINT_FILE"] = old_file
            if old_url is not None: sf.os.environ["SERVING_FINGERPRINT_URL"] = old_url


def test_one_shot():
    import one_shot_control as control
    for bad in ("--- a/../x\n+++ b/../x\n", "--- a/test/x.js\n+++ b/test/x.js\n", "GIT binary patch\n"):
        try: control.validate_diff(bad)
        except control.ControlError: pass
        else: raise AssertionError("unsafe diff accepted")
    _, big = admission.load_manifest("bigdata")
    assert big["one_shot"]["eligible"] is False
    assert all("hidden" not in p and "fail-to-pass" not in p for p in big["one_shot"]["context_files"])
    with tempfile.TemporaryDirectory() as td:
        work = admission.stage(big, Path(td))
        try: control.context_pack(big, work)
        except control.ControlError as exc: assert "ineligible" in str(exc)
        else: raise AssertionError("ineligible one-shot fixture accepted")

    gold = (admission.ROOT / "real-gate-fixtures/patches/h3/gold.patch").read_text()
    response = {"choices": [{"message": {"content": gold}}],
                "usage": {"prompt_tokens": 100, "completion_tokens": 20}}
    calls = []
    original = control.request_once
    control.request_once = lambda *args, **kwargs: calls.append((args, kwargs)) or response
    try:
        result = control.run("h3", "canonical", "http://mock.invalid", "mock-model")
    finally:
        control.request_once = original
    assert len(calls) == 1 and result["requests"] == 1 and result["score"] == 1
    assert result["usage"]["exact"] and result["context_bytes"] <= 48 * 1024

    captured = []
    class FakeResponse:
        def __enter__(self): return self
        def __exit__(self, *_): return False
        def read(self): return json.dumps(response).encode()
    original_urlopen = control.urllib.request.urlopen
    original_key = os.environ.get("LLAMA_API_KEY")
    os.environ["LLAMA_API_KEY"] = "selftest-secret"
    control.urllib.request.urlopen = lambda req, timeout: captured.append(req) or FakeResponse()
    try:
        control.request_once("http://mock.invalid", "mock-model", "prompt")
    finally:
        control.urllib.request.urlopen = original_urlopen
        if original_key is None: os.environ.pop("LLAMA_API_KEY", None)
        else: os.environ["LLAMA_API_KEY"] = original_key
    assert captured[0].get_header("Authorization") == "Bearer selftest-secret"


def test_execution_policy():
    import execution_policy as policy
    local = policy.resolve("endpoint", "llama", "m", llama_url="http://localhost:8080", model_ip="127.0.0.1")
    remote = policy.resolve("endpoint", "llama", "m", llama_url="http://box:8080", model_ip="10.0.0.2")
    cloud = policy.resolve("open", "pi-native", "anthropic/claude-test")
    assert local["network_authoritative"]
    assert not remote["network_authoritative"] and not cloud["network_authoritative"]
    assert cloud["provider"] == "anthropic" and cloud["fingerprint_endpoint"] == "managed://anthropic"
    assert policy.row_decision(True, "approved", True, True, True, "restricted")[:2] == (True, "complete")
    assert policy.row_decision(True, "approved", True, True, False, "open")[:2] == (False, "exploratory")


def test_runner_dry_modes():
    runner = admission.ROOT / "real_gate.sh"
    env = dict(os.environ, MODEL_CONTROL="pi-native", GATE_NETWORK="open",
               PI_PROVIDER="anthropic", PI_MODEL="claude-test")
    env["SANDBOX"] = "off"
    native = subprocess.run([str(runner), "--dry", "--exploratory", "t1"], cwd=admission.ROOT,
                            env=env, capture_output=True, text=True, timeout=15)
    assert native.returncode == 0, native.stderr
    assert "server: pi-native (llama health/warm-up bypassed)" in native.stdout
    assert "provider=anthropic model=claude-test" in native.stdout
    assert "EXPLORATORY ONLY" in native.stderr
    invalid = subprocess.run([str(runner), "--dry", "--exploratory", "t1"], cwd=admission.ROOT,
                             env={**env, "GATE_NETWORK": "endpoint"}, capture_output=True, text=True, timeout=15)
    assert invalid.returncode == 2 and "requires GATE_NETWORK=open" in invalid.stderr
    hidden = subprocess.run([str(runner), "--dry", "--exploratory", "parens"], cwd=admission.ROOT,
                            env=env, capture_output=True, text=True, timeout=15)
    assert hidden.returncode == 2 and "requires SANDBOX=on" in hidden.stderr


def test_robustness_and_usage():
    import robustness_report as rr
    import fleet_report as fr
    rows = []
    for variant, values in zip(rr.VARIANTS, ([1, 1], [1, 1], [1, 0], [1, 1])):
        for rep, score in enumerate(values, 1):
            rows.append({"arm": "base", "pattern": "base", "model": "m", "task": "t", "rep": rep,
                         "score": score, "split": "val" if variant == "canonical" else "robustness",
                         "prompt": {"variant": variant}})
    stat = rr.metrics(rows, "base")
    assert stat["worst"] == 0.5 and stat["spread"] == 0.5 and stat["consistent"] == 0.5

    proxy = [{"model": "m", "pattern": "base", "split": "val", "score": 1,
              "in_tok": 0, "out_tok": 0, "usage": {"exact": False}, "out_chars": 999}]
    assert fr.arm(proxy, "m", "base", "val")[2] is None
    exact = [{**proxy[0], "in_tok": 10, "out_tok": 5, "usage": {"exact": True}}]
    assert fr.arm(exact, "m", "base", "val")[2] == 15


def test_schedule():
    import importlib.util
    spec = importlib.util.spec_from_file_location("munchkin", admission.ROOT / "munchkin.py")
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    assert module.robustness_due("m-r3-c0") and not module.robustness_due("m-r2-c0")


def test_incident_rotation():
    import incident_corpus as corpus
    with tempfile.TemporaryDirectory() as td:
        old = corpus.INBOX, corpus.ARCHIVE, corpus.MANIFESTS
        corpus.INBOX, corpus.ARCHIVE, corpus.MANIFESTS = (Path(td) / "inbox", Path(td) / "archive", Path(td) / "manifests")
        try:
            corpus.intake(argparse.Namespace(id="t1", source="session-1", summary="regression"))
            source = Path(td) / "candidate.json"
            manifest = json.loads((admission.MANIFESTS / "t1.json").read_text())
            source.write_text(json.dumps(manifest))
            corpus.promote(argparse.Namespace(id="t1", manifest=str(source)))
            corpus.expire(argparse.Namespace(id="t1", reason="rotation"))
            snapshots = list(corpus.ARCHIVE.glob("*.json"))
            assert len(snapshots) == 1 and snapshots[0].stat().st_mode & 0o222 == 0
            expired = json.loads((corpus.MANIFESTS / "t1.json").read_text())
            assert not expired["admission"]["approved"] and expired["admission"]["expired_at"]
        finally:
            corpus.INBOX, corpus.ARCHIVE, corpus.MANIFESTS = old


def main():
    test_admission_catalog(); test_fingerprint(); test_one_shot(); test_execution_policy(); test_runner_dry_modes(); test_robustness_and_usage(); test_schedule(); test_incident_rotation()
    print("integrity_selftest: OK (admission, expiry/drift/approval, fingerprint, one-shot, execution policy, robustness, usage, scheduling)")


if __name__ == "__main__": main()
