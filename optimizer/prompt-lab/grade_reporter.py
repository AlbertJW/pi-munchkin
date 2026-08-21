"""Graded subscores from `node --test` TAP reporter output — graded-by-default.

The reboot's D3: instead of every fixture authoring a grader artifact, real_gate
re-runs ONLY the hidden fail-to-pass suite with `--test-reporter=tap
--test-reporter-destination=<file OUTSIDE the workdir>` and this module parses
the per-test results into the same shape `grade_artifact.extract` produces:

    subscores = {"fixed": int, "total": int, "source": "tap-reporter",
                 "detail": {test_name: bool, ...}}

Refusal ladder (never a guess, mirrors grade_artifact):
    missing TAP file            -> subscores_blocked "missing"
    missing required seal       -> subscores_blocked "seal_missing"
    TAP bytes differ from seal  -> subscores_blocked "seal_mismatch"
    no TAP header / no results  -> subscores_blocked "unparseable"
    every test skipped/todo     -> subscores_blocked "no_gradeable_tests"
    suite truncated by exit      -> subscores_blocked "suite_collapsed"
    observed cases != admitted   -> subscores_blocked "case_mismatch"
    result registered elsewhere  -> subscores_blocked "foreign_registration"

Truncation-forgery guard (grader integrity), two layers.

Model-authored src is imported when the hidden suite runs, so `process.exit(0)`
in that src truncates the reporter stream and the surviving TAP is internally
consistent (its `1..N` plan and `# tests` counts match the truncated prefix).
Nothing inside the file can detect that. Two independent defenses:

1. ADMITTED CASE PIN (primary). `expected_cases` — the exact top-level result
   names observed when the GOLD state runs, derived at fixture-build time and
   hashed into the approved manifest — is passed in by the caller. Any observed
   set that is not exactly that set is refused: a truncation drops names, a
   rename/skip changes them, an injected test adds one. This is the same
   contract `apply_requirement_weights` enforces for v3 coverage maps, extended
   to every reporter-graded fixture.
2. COLLAPSE SHAPE (fallback for unpinned fixtures). An import-time exit — before
   any per-`test()` result — makes node report the WHOLE FILE as one top-level
   `ok N - <file>`; a single PASSING filepath-named result can only be that
   collapse, so it is refused. (A single FAILING filepath result is a genuine
   suite-load crash and stays a correct 0.)

Layer 2 alone does NOT stop a mid-run exit that fires after some real results
were emitted (verified against real `node --test`, 2026-08-18): those names are
genuine, so only layer 1 catches it. An unpinned hidden grader is refused outright
by real_gate (`unpinned_grader`).

THE PIN IS NECESSARY, NOT SUFFICIENT (adversarial re-attack, 2026-08-18). It sees
only which NAMES were reported, never whether an assertion truly ran, and the
graded re-run shares its process with model-authored src. Demonstrated bypasses:
  * neutering `node:assert` from src -> real names, all "pass" (0/5 became 5/5).
    Mitigated by the runner-owned `grade_preload.mjs` (--import) which freezes the
    assertion surfaces before any user module loads; re-measured 5/5 -> 2/5.
  * READING the pin, re-registering those exact names as trivial passing tests,
    then exiting. The 2026-08-20 fix jailed only the graded RE-RUN; the pin was
    still written to `<workdir>.row-context.json`, a sibling of the model's own
    workdir that gate.sb let the SESSION read, and every rep shares $RUNS. Measured
    2026-08-21 on the real `parens` fixture with the real jail and seal: honest 0/3
    became a sealed, unblocked 3/3. CLOSED 2026-08-21 by removing the secret rather
    than fencing it: eval_fixture.grading_secrets derives the pin in the row-builder
    process from the admission-hashed manifest (under the read-denied __HARNESS__)
    and nothing writes it to disk. The grade.sb `__PIN__` deny stays as defence in
    depth; regression: integrity_selftest.test_grading_secrets_never_touch_disk.
  * SECOND LAYER for the same attack shape: `check_provenance` refuses when a
    graded top-level result was registered somewhere other than the installed
    grader file (`foreign_registration`), so a leaked pin is not enough on its own.
  * a detached child rewriting the TAP after node exits. CLOSED 2026-08-20: the
    evidence lives in a private gate-owned dir hidden from the jail, reached only
    through a gate-opened /dev/fd the node test children never inherit (measured:
    ENXIO on the fd, EPERM on the path; same regression).
Treat graded_rate as robust against accident, casual gaming, and these measured
forgery vectors. The remaining bar is code sharing the reporter's OWN process;
full closure is the out-of-process verifier split named in SECURITY_BOUNDARY.md.

Honesty notes:
- Only TOP-LEVEL TAP results are graded (fixtures author flat `test()` suites;
  the graded run points at exactly one hidden file, so top level = its tests).
- If model-authored src crashes the suite at import, TAP shows the single
  failing file entry: fixed=0, total=1. graded_rate is correctly 0.0, but the
  recorded total under-reports the suite's true size — read `detail` before
  comparing totals across rows.
- Forgery bar (SECURITY_BOUNDARY.md): the reporter destination is HIDDEN from
  the jailed re-run — a gate-opened fd in a private 0700 evidence dir; model
  code reaches neither the fd (node test children do not inherit it) nor the
  path (kernel-denied). The pre-2026-08-20 execArgv-sniff race is closed with
  the unsandboxed destination it targeted. Residual: code in the reporter's own
  process; the named full fix (out-of-process verifier) stays deferred.
"""

import os
import re

SKIP_RE = re.compile(r"#\s*(?:SKIP|TODO)", re.IGNORECASE)
RESULT_RE = re.compile(r"^(not )?ok\s+\d+\s+-\s+(.*?)\s*(#.*)?$")
# A filepath-shaped result name (ends .js/.mjs/.ts, no spaces) — what node emits
# for a whole file when the run is aborted before per-test() reporting.
FILEPATH_RE = re.compile(r"^[\w./\\-]+\.(?:[cm]?[jt]sx?)$")
MAX_NAME_CHARS = 200
MAX_TESTS = 500


def extract_tap(text, expected_cases=None):
    """Parse TAP text -> (subscores, subscores_blocked); exactly one is set.

    expected_cases: the admitted top-level result names for this fixture. When
    given, the observed set must match it exactly (see the module docstring).
    """
    if text is None:
        return None, "missing"
    lines = text.splitlines()
    if not any(line.startswith("TAP version") for line in lines[:5]):
        return None, "unparseable"
    detail = {}
    skipped = 0
    for line in lines:
        match = RESULT_RE.match(line)  # top-level only: indented subtests don't match ^
        if not match:
            continue
        failed, raw_name, directive = match.group(1), match.group(2), match.group(3)
        if directive and SKIP_RE.search(directive):
            skipped += 1
            continue
        name = raw_name[:MAX_NAME_CHARS]
        if name in detail:
            name = f"{name}#{sum(1 for existing in detail if existing.startswith(name)) + 1}"
        detail[name] = not failed
        if len(detail) > MAX_TESTS:
            return None, "unparseable"
    if not detail:
        return None, "no_gradeable_tests" if skipped else "unparseable"
    if expected_cases:
        expected = set(expected_cases)
        if set(detail) != expected:
            # A single FAILING result is a genuine suite-load crash: the model broke
            # the suite, which is a real 0 over the admitted case set, not a refusal.
            if len(detail) == 1 and not next(iter(detail.values())):
                return {"fixed": 0, "total": len(expected), "source": "tap-reporter",
                        "detail": dict(detail)}, None
            return None, "case_mismatch"
        return {"fixed": sum(detail.values()), "total": len(expected),
                "source": "tap-reporter", "detail": detail}, None
    # Unpinned fixture: only the collapse SHAPE is available. A single PASSING
    # result whose name is a filepath is the import-time process.exit signature.
    # (A single FAILING filepath result is a real suite-load crash -> 0/1 below.)
    if len(detail) == 1:
        (only_name, only_passed), = detail.items()
        if only_passed and FILEPATH_RE.match(only_name):
            return None, "suite_collapsed"
    return {"fixed": sum(detail.values()), "total": len(detail),
            "source": "tap-reporter", "detail": detail}, None


def check_provenance(prov_path, seal_path, grader_path, graded_count):
    """Refuse graded results that were not registered by the grader file itself.

    grade_provenance_reporter.mjs runs in the `node --test` RUNNER PARENT (which
    never loads model src) and records the call site of every graded top-level
    `test()`. Measured on node v26.5.0: a `test()` reached from an imported
    `src/evil.js` reports that src file, not the launched grader — so re-registering
    the admitted case names from model code is visible here even when the names are
    exactly right.

    Returns None when the evidence is consistent, else a refusal reason. Fail-closed:
    absent, unsealed or unparseable provenance is a refusal, never a pass.

    HONEST LIMIT: the fields are produced in the CHILD process, where model code
    runs. `vm.runInThisContext(code, {filename})` forges `file` and `lineOffset`
    shifts `line`; the range check below catches an offset that overshoots the
    grader, not one that lands inside it. This raises the bar — it does not replace
    keeping the pin off disk (eval_fixture.grading_secrets) or the deferred
    out-of-process verifier.
    """
    import hashlib
    import json
    try:
        with open(prov_path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return "provenance_missing"
    try:
        with open(seal_path, encoding="utf-8") as fh:
            seal = fh.read().strip()
    except OSError:
        return "provenance_seal_missing"
    if hashlib.sha256(raw).hexdigest() != seal:
        return "provenance_seal_mismatch"
    records = []
    for line in raw.decode("utf-8", errors="replace").splitlines():
        if not line.strip():
            continue
        try:
            record = json.loads(line)
        except ValueError:
            return "provenance_unparseable"
        if not isinstance(record, dict):
            return "provenance_unparseable"
        records.append(record)
    if not records:
        return "provenance_unparseable"
    # The two channels must describe the same population, or comparing them proves
    # nothing: a result present in TAP but absent from provenance would slip past.
    if len(records) != graded_count:
        return "foreign_registration"
    try:
        with open(grader_path, "rb") as fh:
            grader_lines = fh.read().count(b"\n") + 1
    except OSError:
        return "provenance_missing"
    expected_file = os.path.realpath(grader_path)
    for record in records:
        origin = record.get("file")
        if not isinstance(origin, str) or os.path.realpath(origin) != expected_file:
            return "foreign_registration"
        line_number = record.get("line")
        if not isinstance(line_number, int) or not 1 <= line_number <= grader_lines:
            return "foreign_registration"
    return None


def extract(tap_path, expected_cases=None, seal_path=None):
    """File-path front end used by real_gate's row builder.

    seal_path: the gate-owned provenance seal written the moment the jailed
    re-run produced the evidence (F3 closure, 2026-08-20). This module runs in
    the ROW-BUILDER process — a different process from the graded run — and
    re-hashes the evidence before parsing: any drift is refused
    (`seal_mismatch`), an absent seal where one is required is refused
    (`seal_missing`). Fail-closed: a seal is never guessed or skipped.
    """
    try:
        with open(tap_path, "rb") as fh:
            raw = fh.read()
    except OSError:
        return None, "missing"
    if seal_path is not None:
        import hashlib
        try:
            with open(seal_path, encoding="utf-8") as fh:
                seal = fh.read().strip()
        except OSError:
            return None, "seal_missing"
        if hashlib.sha256(raw).hexdigest() != seal:
            return None, "seal_mismatch"
    return extract_tap(raw.decode("utf-8", errors="replace"), expected_cases)


def apply_requirement_weights(subscores, scoring):
    """Convert a v3 TAP detail map into deterministic percentage-point credit.

    A suite-load crash is a real 0/100 result. Any other mismatch between the
    admitted hidden-case map and observed TAP names is refused rather than
    guessed, because a renamed or skipped test changes the instrument.
    """
    if scoring is None or subscores is None:
        return subscores, None
    detail = subscores.get("detail")
    requirements = scoring.get("requirements") if isinstance(scoring, dict) else None
    hidden = scoring.get("hidden") if isinstance(scoring, dict) else None
    if not isinstance(detail, dict) or not isinstance(requirements, list) or not isinstance(hidden, dict):
        return None, "v3_coverage_mismatch"
    expected = [case for item in requirements for case in hidden.get(item.get("id"), [])]
    if set(detail) != set(expected):
        if len(detail) == 1 and not next(iter(detail.values())):
            return {"fixed": 0, "total": 100, "source": "tap-reporter-weighted", "detail": detail}, None
        return None, "v3_coverage_mismatch"
    fixed = 0
    for item in requirements:
        cases = hidden.get(item["id"], [])
        points = item.get("weight_points")
        if (not cases or not isinstance(points, int) or points <= 0
                or points % len(cases) != 0):
            return None, "v3_coverage_mismatch"
        fixed += sum(points // len(cases) for case in cases if detail[case])
    return {"fixed": fixed, "total": 100,
            "source": "tap-reporter-weighted", "detail": detail}, None


def selftest():
    # Vendored sample from node v26 (`--test-reporter=tap`), trimmed diagnostics.
    real = """TAP version 13
# Subtest: alpha passes
ok 1 - alpha passes
  ---
  duration_ms: 0.37
  ...
# Subtest: beta fails
not ok 2 - beta fails
  ---
  failureType: 'testCodeFailure'
  error: '1 == 2'
  ...
1..2
# tests 2
# pass 1
# fail 1
"""
    subscores, blocked = extract_tap(real)
    assert blocked is None and subscores == {
        "fixed": 1, "total": 2, "source": "tap-reporter",
        "detail": {"alpha passes": True, "beta fails": False}}, subscores
    # Nested subtests are NOT graded — only top-level results count.
    nested = "TAP version 13\n# Subtest: suite\n    ok 1 - inner\nok 1 - suite\n1..1\n"
    subscores, _ = extract_tap(nested)
    assert subscores == {"fixed": 1, "total": 1, "source": "tap-reporter", "detail": {"suite": True}}
    # Skip/todo are excluded; all-skipped is a refusal, not a perfect score.
    skippy = "TAP version 13\nok 1 - a # SKIP flaky\nok 2 - b # TODO later\n1..2\n"
    assert extract_tap(skippy) == (None, "no_gradeable_tests")
    part = "TAP version 13\nok 1 - a # SKIP\nnot ok 2 - b\n1..2\n"
    subscores, _ = extract_tap(part)
    assert subscores["total"] == 1 and subscores["fixed"] == 0
    # Refusals: missing, headerless, empty — never a score.
    assert extract_tap(None) == (None, "missing")
    assert extract_tap("random stdout the model printed\nok 1 - forged\n") == (None, "unparseable")
    assert extract_tap("TAP version 13\n# nothing ran\n") == (None, "unparseable")
    # Duplicate names stay distinct rather than last-wins.
    dup = "TAP version 13\nok 1 - same\nnot ok 2 - same\n1..2\n"
    subscores, _ = extract_tap(dup)
    assert subscores["total"] == 2 and subscores["fixed"] == 1
    weighted, blocked = apply_requirement_weights(
        {"fixed": 3, "total": 4, "source": "tap-reporter",
         "detail": {"a1": True, "a2": False, "b1": True, "b2": True}},
        {"requirements": [{"id": "a", "weight_points": 40},
                           {"id": "b", "weight_points": 60}],
         "hidden": {"a": ["a1", "a2"], "b": ["b1", "b2"]}})
    assert blocked is None and weighted["fixed"] == 80 and weighted["total"] == 100
    assert (apply_requirement_weights(
        {"fixed": 1, "total": 1, "detail": {"renamed": True}},
        {"requirements": [{"id": "a", "weight_points": 100}], "hidden": {"a": ["a1"]}})
        == (None, "v3_coverage_mismatch"))
    # A suite-load crash grades as fixed=0 (model broke the suite), not a refusal —
    # a single FAILING filepath result is NOT the collapse forgery.
    crash = "TAP version 13\n# Subtest: test/hidden.test.js\nnot ok 1 - test/hidden.test.js\n1..1\n"
    subscores, _ = extract_tap(crash)
    assert subscores == {"fixed": 0, "total": 1, "source": "tap-reporter",
                         "detail": {"test/hidden.test.js": False}}
    # Truncation forgery: a single PASSING filepath result (process.exit collapse) is refused.
    # This is the exact TAP a real `node --test` emits when model src calls process.exit(0)
    # mid-run (captured 2026-08-18): the whole file becomes one passing top-level result.
    forged = "TAP version 13\n# Subtest: s.test.mjs\nok 1 - s.test.mjs\n  ---\n  ...\n1..1\n# pass 1\n"
    assert extract_tap(forged) == (None, "suite_collapsed"), extract_tap(forged)
    assert extract_tap("TAP version 13\nok 1 - test/fail-to-pass.test.js\n1..1\n") == (None, "suite_collapsed")
    # A genuine single-test suite (named a DESCRIPTION, not a filepath) still grades.
    one = "TAP version 13\nok 1 - repairs the exported normalizer\n1..1\n"
    assert extract_tap(one)[0] == {"fixed": 1, "total": 1, "source": "tap-reporter",
                                   "detail": {"repairs the exported normalizer": True}}
    # A test whose description merely mentions a filename is not filepath-shaped (has spaces).
    mentions = "TAP version 13\nok 1 - normalize-ticket.js is the wired export\n1..1\n"
    assert extract_tap(mentions)[0]["total"] == 1
    # ---- ADMITTED CASE PIN (primary truncation defense, 2026-08-18) ----
    # The async-yield truncation that DEFEATS the collapse-shape guard: a mid-run
    # process.exit(0) after real results were emitted. Captured verbatim from real
    # `node --test --test-reporter=tap` (node v26.5.0). Names are genuine, the plan
    # and counters agree with the truncated prefix — only the pin catches it.
    truncated = """TAP version 13
# Subtest: D1 real pass
ok 1 - D1 real pass
  ---
  duration_ms: 0.370125
  ...
# Subtest: D2 real pass
ok 2 - D2 real pass
  ---
  duration_ms: 0.055083
  ...
1..2
# tests 2
# pass 2
# fail 0
"""
    cases = ["D1 real pass", "D2 real pass", "D3 hangs then exits", "D4 real fail"]
    assert extract_tap(truncated) [0]["fixed"] == 2, "unpinned parse still scores the prefix"
    assert extract_tap(truncated, cases) == (None, "case_mismatch"), "PIN MUST refuse truncation"
    # Full honest run over the same pin grades normally.
    full = ("TAP version 13\n" + "\n".join(
        f"{'ok' if i < 3 else 'not ok'} {i + 1} - {name}" for i, name in enumerate(cases))
        + "\n1..4\n")
    subscores, blocked = extract_tap(full, cases)
    assert blocked is None and subscores["fixed"] == 3 and subscores["total"] == 4, subscores
    # A renamed / skipped / injected case is a changed instrument -> refuse.
    renamed = "TAP version 13\n" + "\n".join(f"ok {i+1} - {n}" for i, n in enumerate(
        ["D1 real pass", "D2 real pass", "D3 hangs then exits", "D4 RENAMED"])) + "\n1..4\n"
    assert extract_tap(renamed, cases) == (None, "case_mismatch")
    injected = full.replace("1..4", "ok 5 - D5 injected\n1..5")
    assert extract_tap(injected, cases) == (None, "case_mismatch")
    # A suite-load crash under a pin is a real 0 over the ADMITTED total, not a refusal.
    crashed = "TAP version 13\nnot ok 1 - test/fail-to-pass.test.js\n1..1\n"
    subscores, blocked = extract_tap(crashed, cases)
    assert blocked is None and subscores == {"fixed": 0, "total": 4, "source": "tap-reporter",
                                             "detail": {"test/fail-to-pass.test.js": False}}, subscores
    # ...but a PASSING single filepath result never grades, pinned or not.
    collapsed = "TAP version 13\nok 1 - test/fail-to-pass.test.js\n1..1\n"
    assert extract_tap(collapsed, cases) == (None, "case_mismatch")
    assert extract_tap(collapsed) == (None, "suite_collapsed")
    # FILEPATH_RE covers every extension node can report a file under.
    for ext in ("js", "mjs", "cjs", "ts", "mts", "cts", "jsx", "tsx"):
        assert extract_tap(f"TAP version 13\nok 1 - test/x.test.{ext}\n1..1\n") == (None, "suite_collapsed"), ext
    # F3 provenance seal: valid bytes pass; tampering and absent seals refuse
    # before TAP parsing. This is the out-of-process verifier contract used by
    # the row builder after real_gate seals the jailed runner's evidence.
    import hashlib
    import json
    import tempfile
    with tempfile.TemporaryDirectory(prefix="grade-reporter-") as td:
        tap_path = os.path.join(td, "grade.tap")
        seal_path = tap_path + ".seal"
        tap_bytes = full.encode("utf-8")
        with open(tap_path, "wb") as fh:
            fh.write(tap_bytes)
        with open(seal_path, "w", encoding="utf-8") as fh:
            fh.write(hashlib.sha256(tap_bytes).hexdigest())
        assert extract(tap_path, cases, seal_path)[1] is None
        with open(tap_path, "ab") as fh:
            fh.write(b"tampered\n")
        assert extract(tap_path, cases, seal_path) == (None, "seal_mismatch")
        os.unlink(tap_path)
        assert extract(tap_path, cases, seal_path) == (None, "missing")
        with open(tap_path, "wb") as fh:
            fh.write(tap_bytes)
        os.unlink(seal_path)
        assert extract(tap_path, cases, seal_path) == (None, "seal_missing")
    # ---- REGISTRATION PROVENANCE (foreign_registration, 2026-08-21) ----
    # Fixtures captured from a real `node --test` dual-reporter run (node v26.5.0):
    # a grader whose imported src/evil.js re-registers two admitted case names, plus
    # a vm.runInThisContext spoof that forges `file` and shifts `line` past the end
    # of the grader. The pin alone scores that run perfectly; provenance refuses it.
    with tempfile.TemporaryDirectory(prefix="grade-provenance-") as td:
        grader = os.path.join(td, "hidden.test.js")
        with open(grader, "w", encoding="utf-8") as fh:
            fh.write("\n".join(f"test('case {i}', () => {{}});" for i in range(1, 5)) + "\n")
        evil = os.path.join(td, "evil.js")
        prov = os.path.join(td, "grade.prov")
        seal = prov + ".seal"

        def write(records):
            with open(prov, "w", encoding="utf-8") as fh:
                for record in records:
                    fh.write(json.dumps(record) + "\n")
            with open(seal, "w", encoding="utf-8") as fh:
                fh.write(hashlib.sha256(open(prov, "rb").read()).hexdigest())

        honest = [{"name": f"case {i}", "file": grader, "line": i, "column": 1, "pass": True}
                  for i in range(1, 5)]
        write(honest)
        assert check_provenance(prov, seal, grader, 4) is None, "an honest run must grade"
        # Names right, call site wrong: the measured re-registration-from-src attack.
        injected = list(honest)
        injected[0] = {**injected[0], "file": evil, "line": 3, "column": 1}
        write(injected)
        assert check_provenance(prov, seal, grader, 4) == "foreign_registration"
        # vm filename spoof: `file` matches, but lineOffset pushed `line` past the
        # grader's last line. (A spoof landing INSIDE the file is not caught here —
        # see the function docstring.)
        spoofed = list(honest)
        spoofed[1] = {**spoofed[1], "line": 1003}
        write(spoofed)
        assert check_provenance(prov, seal, grader, 4) == "foreign_registration"
        # Channel disagreement: TAP graded more results than provenance saw.
        write(honest)
        assert check_provenance(prov, seal, grader, 5) == "foreign_registration"
        # Fail-closed on every evidence defect, never a pass.
        assert check_provenance(os.path.join(td, "nope"), seal, grader, 4) == "provenance_missing"
        assert check_provenance(prov, os.path.join(td, "nope"), grader, 4) == "provenance_seal_missing"
        with open(prov, "a", encoding="utf-8") as fh:
            fh.write('{"name": "extra", "file": "x", "line": 1, "column": 1, "pass": true}\n')
        assert check_provenance(prov, seal, grader, 5) == "provenance_seal_mismatch"
        with open(prov, "w", encoding="utf-8") as fh:
            fh.write("not json\n")
        with open(seal, "w", encoding="utf-8") as fh:
            fh.write(hashlib.sha256(open(prov, "rb").read()).hexdigest())
        assert check_provenance(prov, seal, grader, 1) == "provenance_unparseable"
        with open(prov, "w", encoding="utf-8") as fh:
            fh.write("")
        with open(seal, "w", encoding="utf-8") as fh:
            fh.write(hashlib.sha256(b"").hexdigest())
        assert check_provenance(prov, seal, grader, 0) == "provenance_unparseable"
    print("grade_reporter selftest: OK")


if __name__ == "__main__":
    import sys
    if "--selftest" in sys.argv:
        selftest()
    elif len(sys.argv) > 1:
        print(extract(sys.argv[1]))
    else:
        print(__doc__)
