"""Render the graded-re-run Seatbelt jail (grade.sb) with absolute REAL paths.

Shared by real_gate.sh (the production call site) and grade_jail_selftest.py so
the regression test exercises the exact renderer the gate uses. Seatbelt has no
environment variables and matches REAL paths (macOS resolves /tmp ->
/private/tmp before matching), so every token value is realpath'd and
JSON-escaped; unresolved placeholders fail closed.
"""

import json
import os
import re

PLACEHOLDER = re.compile(r"__[A-Z][A-Z0-9_]*__")
# __GRADE_ARTIFACT__ is used only by binary.sb (the binary scoring run must be able
# to emit a manifest-pinned grade artifact; the graded re-run writes nothing). It is
# always supplied so an unresolved-token failure still means a real template bug.
TOKENS = ("__PIN__", "__EVIDENCE__", "__GRADE_TMP__", "__MIRROR__", "__HARNESS__",
          "__GRADE_ARTIFACT__")


def render(template_path, dest_path, pin, evidence_dir, grade_tmpdir, mirror_dir, harness_dir,
           grade_artifact=None):
    """Render template_path -> dest_path; raises SystemExit on any unresolved token.

    grade_artifact: absolute path of the one file the run may write, or None for
    the fixtures that emit no artifact — rendered as /dev/null, which the templates
    already allow, so "no artifact" is never an accidental write-allow.
    """
    values = [os.path.realpath(p) for p in
              (pin, evidence_dir, grade_tmpdir, mirror_dir, harness_dir,
               grade_artifact or os.devnull)]
    with open(template_path, encoding="utf-8") as fh:
        text = fh.read()
    escaped = {name: json.dumps(value, ensure_ascii=True)[1:-1]
               for name, value in zip(TOKENS, values)}

    def substitute(match):
        key = match.group(0)
        if key not in escaped:
            raise SystemExit(f"unresolved Seatbelt placeholder: {key}")
        return escaped[key]

    with open(dest_path, "w", encoding="utf-8") as fh:
        fh.write(PLACEHOLDER.sub(substitute, text))
