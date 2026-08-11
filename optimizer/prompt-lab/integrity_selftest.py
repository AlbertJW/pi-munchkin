#!/usr/bin/env python3
"""Offline acceptance tests for the benchmark-integrity upgrade."""
from __future__ import annotations

import copy
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
import argparse
from pathlib import Path

import fixture_admission as admission


def test_manifest_artifacts_exist_on_disk():
    """Every artifact a manifest claims must exist and still hash as recorded.

    This exists because the count assertion below FAILED TO PROTECT ANYTHING on
    2026-07-30: a concurrent `rm -rf` removed the whole audit-sweep fixture, a
    `git add -A` staged the 20 deletions, the count check fired as designed —
    and the count was edited 28 -> 27 to make the suite green again. The fixture
    stayed deleted for two commits and `npm run verify` reported PASS the whole
    time.

    A bare count is adjustable, so under time pressure it gets adjusted. This
    check is not: it fails with the missing PATH, which cannot be silenced by
    editing a number, only by restoring the file or deliberately removing it
    from the manifest.
    """
    missing, drifted = [], []
    for path in sorted(admission.MANIFESTS.glob("*.json")):
        manifest = json.loads(path.read_text())
        # artifacts[] is the manifest's ONE hashed file inventory — it already
        # lists fixture files, patch files and hidden tests. The first version of
        # this guard also iterated the top-level "tests" and "patches" keys, but
        # those are CONFIG DICTS (fail_to_pass/pass_to_pass, gold/shortcut_mutants);
        # iterating a dict yields string keys, the isinstance(entry, dict) filter
        # skipped every one, and both arms were dead code from birth (triage #23).
        # Guard the guard: artifacts must be a non-empty list of {path, sha256}.
        artifacts = manifest.get("artifacts")
        assert isinstance(artifacts, list) and artifacts, f"{path.stem}: manifest has no artifacts[] inventory"
        for entry in artifacts:
            assert isinstance(entry, dict) and "path" in entry and "sha256" in entry, \
                f"{path.stem}: malformed artifacts[] entry {entry!r}"
            target = admission.FIXTURES.parent / entry["path"]
            if not target.exists():
                missing.append(f"{path.stem}: {entry['path']}")
            elif admission.sha256(target) != entry["sha256"]:
                drifted.append(f"{path.stem}: {entry['path']}")
    assert not missing, "manifest artifacts missing from disk:\n  " + "\n  ".join(missing)
    assert not drifted, "manifest artifacts changed without a manifest update:\n  " + "\n  ".join(drifted)


def test_gate_materializes_everything_admission_does():
    """The gate must give the model the same tree admission validated.

    real_gate.sh used an allowlist (src/test/package.json/data/scripts) while
    fixture_admission.py uses shutil.copytree. docs/ and config/ therefore never
    reached the model's workdir, so four fixtures were admitted against one
    filesystem and measured against a smaller one — 84 rows invalidated
    (METHODOLOGY §9). Admission cannot catch this on its own: it validates a
    world the model never sees. This test is the only place the two
    materialization paths are compared.

    Two properties, because the fix trades an allowlist for a whole-tree copy:
      1. every top-level entry of every fixture actually reaches the workdir;
      2. no fixture root contains solution material, since the tree copy would
         now carry it to the model.
    """
    gate = (admission.ROOT / "real_gate.sh").read_text()
    reserved = {"hidden", "manifests", "patches", "review-packets", "admission-tests", "schemas"}
    fixtures = [d for d in admission.FIXTURES.iterdir()
                if d.is_dir() and d.name not in reserved and not d.name.startswith("context-pressure")]

    whole_tree = 'tar -C "$fix"' in gate
    if not whole_tree:
        # Still on the allowlist: name every entry it silently drops.
        allow = {"src", "test", "package.json", "data", "scripts"}
        dropped = [f"{d.name}/{e.name}" for d in fixtures for e in d.iterdir()
                   if e.name not in allow and e.name != "node_modules"]
        assert not dropped, (
            "real_gate.sh materialization drops fixture content the model needs:\n  "
            + "\n  ".join(sorted(dropped))
            + "\nAdmission copies the whole tree; the gate must too (METHODOLOGY §9)."
        )

    leaks = [str(p.relative_to(admission.FIXTURES))
             for d in fixtures for p in d.rglob("*")
             if "node_modules" not in p.parts
             and (p.suffix == ".patch" or any(w in p.name.lower() for w in ("gold", "solution", "answer", "hidden")))]
    assert not leaks, "solution material inside a fixture root would be copied to the model:\n  " + "\n  ".join(sorted(leaks))


def test_admission_catalog():
    manifests = sorted(admission.MANIFESTS.glob("*.json"))
    # This count is a tripwire for UNNOTICED roster changes, so it may only be
    # edited alongside a deliberate, verified one. 2026-08-11: 28 -> 32, adding
    # the four band fixtures (misleading-symptom, ordered-steps,
    # second-test-guard, documented-escape) per PREREG_FIXTURE_BAND_2026-08-11.
    # Verified purely additive before editing: nothing deleted vs the previous
    # commit. A count edited to silence a failure nobody explained is how a
    # deleted fixture went unnoticed for two commits on 2026-07-30.
    assert len(manifests) == 32, len(manifests)
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
            # The approval names the content it covered. Editing the manifest — the command,
            # the overlay, the timeout, the grader — without re-approving turns this red.
            assert manifest["admission"].get("manifest_sha256") == admission.manifest_digest(manifest), \
                f"{path.stem}: approved under different manifest content"
        else:
            assert admission.authoritative(manifest)[0] is False  # human approval is mandatory

        approved = copy.deepcopy(manifest)
        approved["admission"].update(approved=True, reviewer="selftest", reviewed_at="2026-07-14T00:00:00Z")
        approved["timestamps"]["expires_at"] = "2099-01-01T00:00:00Z"
        approved["admission"]["manifest_sha256"] = admission.manifest_digest(approved)
        assert admission.authoritative(approved)[0]

        # Every field that defines the test is under the approval, not just the fixture files.
        for field, mutate in (("command", lambda t: t["tests"]["fail_to_pass"].update(command=["true"])),
                              ("overlays", lambda t: t["tests"]["fail_to_pass"].update(overlays=[])),
                              ("timeout", lambda t: t["tests"]["fail_to_pass"].update(timeout_seconds=1)),
                              ("grade_artifact", lambda t: t["tests"]["fail_to_pass"].update(grade_artifact="x")),
                              ("expiry", lambda t: t["timestamps"].update(expires_at="2098-01-01T00:00:00Z"))):
            tampered = copy.deepcopy(approved); mutate(tampered)
            assert admission.authoritative(tampered) == (False, "manifest changed after approval"), \
                f"{path.stem}: editing {field} did not revoke approval"
        approved["timestamps"]["expires_at"] = "2000-01-01T00:00:00Z"
        assert admission.authoritative(approved)[1] == "fixture expired"
        approved["timestamps"]["expires_at"] = "2099-01-01T00:00:00Z"
        approved["artifacts"][0]["sha256"] = "0" * 64
        assert admission.authoritative(approved)[1] == "artifact hash drift"

    broken = json.loads(manifests[0].read_text()); broken["sufficiency"] = []
    try: admission.validate_contract(broken)
    except admission.AdmissionError: pass
    else: raise AssertionError("missing sufficiency mapping accepted")


def test_fixture_verify_read_only():
    manifest = admission.MANIFESTS / "t1.json"
    before = manifest.read_bytes()
    before_hash = admission.sha256(manifest)
    cli = Path(admission.__file__)
    proc = subprocess.run([sys.executable, str(cli), "verify", "t1"], cwd=admission.ROOT,
                          capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stderr
    assert proc.stdout == "t1: PASS (read-only; manifest unchanged)\n", proc.stdout
    assert manifest.read_bytes() == before, "verify modified manifest bytes"
    assert admission.sha256(manifest) == before_hash, "verify modified manifest hash"


def test_context_pressure_contract():
    _, manifest = admission.load_manifest("context-pressure")
    assert admission.artifact_drift(manifest) == []
    pressure = manifest["context_pressure"]
    validation = admission.safe_root(pressure["validation_root"])
    held_out = admission.safe_root(pressure["held_out_root"])
    assert validation != held_out and validation not in held_out.parents and held_out not in validation.parents
    cli = admission.ROOT / "prompt-lab" / "eval_fixture.py"
    fixture = subprocess.run([sys.executable, str(cli), "fixture-root", "context-pressure"],
                             cwd=admission.ROOT, capture_output=True, text=True, timeout=30)
    hidden = subprocess.run([sys.executable, str(cli), "hidden-test", "context-pressure"],
                            cwd=admission.ROOT, capture_output=True, text=True, timeout=30)
    assert fixture.returncode == 0 and fixture.stdout.strip() == pressure["validation_root"]
    assert hidden.returncode == 0 and hidden.stdout.strip().startswith(pressure["held_out_root"] + "/")

    drifted = copy.deepcopy(manifest)
    drifted["context_pressure"]["generated_artifacts"][0]["sha256"] = "0" * 64
    assert any(error.startswith("generated:hash:") for error in admission.artifact_drift(drifted))
    with tempfile.TemporaryDirectory() as td:
        env = admission.verification_env(Path(td))
        assert "OPENROUTER_API_KEY" not in env and "ANTHROPIC_API_KEY" not in env
        assert Path(env["HOME"]).is_relative_to(Path(td)) and Path(env["TMPDIR"]).is_relative_to(Path(td))


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
            # intake() stamps the CURRENT month, while the on-disk manifest carries a fixed
            # cohort_id -- so this failed at the 2026-08 boundary and would fail at every one
            # after. Rotation is what is under test here, not promote()'s cohort guard, so
            # take the cohort from the intake record just written (promote's own glob).
            manifest["cohort_id"] = json.loads(next(corpus.INBOX.glob("*/t1.json")).read_text())["cohort_id"]
            source.write_text(json.dumps(manifest))
            corpus.promote(argparse.Namespace(id="t1", manifest=str(source)))
            corpus.expire(argparse.Namespace(id="t1", reason="rotation"))
            snapshots = list(corpus.ARCHIVE.glob("*.json"))
            assert len(snapshots) == 1 and snapshots[0].stat().st_mode & 0o222 == 0
            expired = json.loads((corpus.MANIFESTS / "t1.json").read_text())
            assert not expired["admission"]["approved"] and expired["admission"]["expired_at"]
        finally:
            corpus.INBOX, corpus.ARCHIVE, corpus.MANIFESTS = old


def test_graded_subscores_passthrough():
    """The gate's grader-artifact extraction: additive, and fail-safe on junk.

    A fixture's hidden grader may emit `.<name>-grade.json` = {fixed,total,defects}.
    real_gate.sh reads it into an OPTIONAL `subscores` row block; `score` stays the
    strict binary gate bit so no historical row or cross-round pass-rate claim moves.
    This exists because at n=9/arm the binary gate is a one-sided regression detector
    (CANDIDATE_STRATEGY_2026-07-31.md section 1) -- partial credit is what lets a round
    show improvement at all.

    This calls the REAL extraction (prompt-lab/grade_artifact.py -- the same module the
    gate's row builder imports). It used to reimplement it under a "if that changes, change
    this together" comment, which is exactly how the multi-artifact case stayed untested
    while the gate resolved it by lexicographic accident.
    """
    import grade_artifact
    import eval_fixture

    PIN = ".audit-grade.json"
    cases = [
        ({"fixed": 5, "total": 8, "defects": {"d1": True, "d2": False}}, True, True),
        ({"fixed": 8, "total": 8, "defects": {}}, True, True),
        ({"fixed": 3, "total": 8, "defects": {"d1": "yes"}}, True, False),   # bad detail dropped, row kept
        ({"fixed": 9, "total": 8}, False, False),                            # fixed > total
        ({"fixed": -1, "total": 8}, False, False),
        ({"fixed": 0, "total": 0}, False, False),
        ({"fixed": True, "total": 8}, False, False),                         # bool is a subclass of int
        ({"fixed": 5, "total": True}, False, False),
        ("NOT JSON", False, False),
        (None, False, False),
    ]
    for payload, expect_row, expect_detail in cases:
        with tempfile.TemporaryDirectory() as td:
            if payload is not None:
                body = payload if isinstance(payload, str) else json.dumps(payload)
                Path(td, PIN).write_text(body)
            got, blocked = grade_artifact.extract(td, PIN)
            assert (got is not None) == expect_row, f"{payload!r} -> {got!r}"
            assert (got is None) == bool(blocked), f"{payload!r} -> {got!r} / {blocked!r}"
            if got is not None:
                assert ("detail" in got) == expect_detail, f"{payload!r} -> {got!r}"
                assert got["source"] == PIN, got

    # THE DECOY CASE. The workdir is model-writable for the whole session and `.a-grade.json`
    # sorts ahead of `.audit-grade.json`, so the old glob+sorted()[0] extraction would have
    # scored the decoy's 8/8. Refusing rather than picking is the contract: a decoy costs the
    # session its subscores, it never forges them.
    with tempfile.TemporaryDirectory() as td:
        Path(td, PIN).write_text(json.dumps({"fixed": 2, "total": 8}))
        Path(td, ".a-grade.json").write_text(json.dumps({"fixed": 8, "total": 8}))
        got, blocked = grade_artifact.extract(td, PIN)
        assert got is None, f"a decoy alongside the pinned artifact must yield NO subscores, got {got!r}"
        assert blocked == "ambiguous:2", blocked

    # ...and the decoy alone forges nothing either, however it sorts.
    with tempfile.TemporaryDirectory() as td:
        Path(td, ".a-grade.json").write_text(json.dumps({"fixed": 8, "total": 8}))
        assert grade_artifact.extract(td, PIN) == (None, "missing")
        # An undeclared artifact on an ungraded fixture is refused AND surfaced, not ignored.
        assert grade_artifact.extract(td, None) == (None, "unpinned:1")

    # A fixture with no grader stays exactly as it was: no subscores, and nothing loud.
    with tempfile.TemporaryDirectory() as td:
        assert grade_artifact.extract(td, None) == (None, None)
        assert grade_artifact.extract(td, PIN) == (None, "missing")

    # The pin is a basename matched against the workdir's own listing, so it cannot escape it.
    with tempfile.TemporaryDirectory() as td:
        Path(td, PIN).write_text(json.dumps({"fixed": 8, "total": 8}))
        assert grade_artifact.extract(td, "../" + PIN) == (None, "missing")

    # The gate must take the name from the manifest, not hardcode it -- and the manifest must
    # name the file the hidden grader actually writes.
    assert eval_fixture.row_context("audit-sweep", "canonical")["grade_artifact"] == PIN, \
        "row-context must carry grade_artifact -- it is how the pin reaches the gate's row builder"
    hidden = (admission.FIXTURES / "hidden" / "audit-sweep.test.js").read_text()
    assert f'writeFileSync("{PIN}"' in hidden, "the pin must be the name the hidden grader writes"

    # The schema must accept the block and must NOT require it.
    schema = json.loads((admission.FIXTURES / "schemas" / "pi.eval-row-v2.schema.json").read_text())
    assert "subscores" in schema["properties"], "subscores missing from the row schema"
    assert "subscores" not in schema["required"], "subscores must stay OPTIONAL -- old rows are still valid"
    props = schema["properties"]["subscores"]
    assert set(props["required"]) == {"fixed", "total"}, props["required"]

    # And the gate must actually wire it -- to THIS module, and to the manifest's pin, or the
    # cases above test a library nothing calls.
    gate = (admission.ROOT / "real_gate.sh").read_text()
    assert 'rec["subscores"]=subscores' in gate, "real_gate.sh does not populate subscores"
    assert "import grade_artifact" in gate, "real_gate.sh must use the shared extraction, not its own copy"
    assert 'ctx.get("grade_artifact")' in gate, "real_gate.sh must read the manifest's pin"
    assert 'rec["subscores_blocked"]=subscores_blocked' in gate, "a refusal must reach the row"
    assert ".*-grade.json" not in gate, "real_gate.sh must not glob for the artifact any more"


def main():
    # AUTO-DISCOVERED, not a hand-maintained list. The list form silently
    # skipped any test_* someone forgot to register — which is exactly how the
    # artifacts-on-disk guard was inert on first landing (its author appended
    # the function and never edited this line; caught only because its
    # counterfactual produced no output). A test that exists but never runs is
    # worse than no test: it reads as coverage. Alphabetical order; every
    # test here is (and must remain) independent of execution order.
    tests = sorted(
        (name, fn) for name, fn in globals().items()
        if name.startswith("test_") and callable(fn)
    )
    for _name, fn in tests:
        fn()
    print(f"integrity_selftest: OK ({len(tests)} checks: " + ", ".join(n[len("test_"):] for n, _ in tests) + ")")


if __name__ == "__main__": main()
