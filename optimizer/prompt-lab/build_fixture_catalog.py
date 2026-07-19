#!/usr/bin/env python3
"""Reproducibly build the initial 2026-07 fixture catalog and patch assets."""
from __future__ import annotations

import difflib
import hashlib
import json
import re
import shutil
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "real-gate-fixtures"
TASKS = ROOT / "ab-symbolect/tasks"
OUT = FIX / "patches"
MANIFESTS = FIX / "manifests"
HIDDEN = {p.stem.replace(".test", "") for p in (FIX / "hidden").glob("*.test.js")}
ALL = [f"t{i}" for i in range(1, 7)] + sorted(HIDDEN)


def h(data): return hashlib.sha256(data if isinstance(data, bytes) else data.encode()).hexdigest()


def root_for(task):
    if task == "h3": return FIX / "hard-bracket"
    if (FIX / task).is_dir(): return FIX / task
    return ROOT / "pi-test"


def stage(task, dst):
    shutil.copytree(root_for(task), dst)
    if task == "t3":
        shutil.copy2(ROOT / "ab-symbolect/t3-files/align.js", dst / "src/align.js")


def mutate(task, dst, gold):
    p = dst / "src/index.js"
    s = p.read_text()
    if task == "t1":
        if gold:
            for f in list((dst / "src").glob("*.js")) + list((dst / "test").glob("*.js")):
                f.write_text(f.read_text().replace("parseCSV", "parseCsv"))
        else:
            p.write_text(s.replace("export function parseCSV", "export function parseCsv") + "\nexport const parseCSV = parseCsv;\n")
    elif task == "t2":
        s = s.replace("const lines = csv.trim().split('\\n');", "const lines = csv.trim().split('\\n').filter((line) => line.trim() !== '');")
        if gold: s = s.replace("JSON.stringify(data, null, 2)", "JSON.stringify(data, null, 4)")
        p.write_text(s)
    elif task == "t3":
        p = dst / "src/align.js"; s = p.read_text()
        s = s.replace("return s + ' '.repeat(width - s.length);", "return ' '.repeat(width - s.length) + s;", 1 if not gold else 0)
        if gold:
            old = "export function alignRight(s, width) {\n\tif (s.length >= width) {\t\n\t\treturn s;\n\t}\n\treturn s + ' '.repeat(width - s.length);\n}"
            new = old.replace("return s + ' '.repeat(width - s.length);", "return ' '.repeat(width - s.length) + s;")
            s = s.replace(old, new).replace("const left = Math.ceil(extra / 2);", "const left = Math.floor(extra / 2);")
        p.write_text(s)
    elif task == "t4":
        if gold:
            s = s.replace("function splitCSVLine(line) {", "function splitCSVLine(line, trim = true) {")
            s = s.replace("fields.push(current.trim());", "fields.push(trim ? current.trim() : current);")
            s = s.replace("export function parseCSV(csv) {", "export function parseCSV(csv, { trim = true } = {}) {")
            s = s.replace("const lines = csv.trim().split('\\n');", "const lines = (trim ? csv.trim() : csv).split('\\n');")
            s = s.replace("splitCSVLine(lines[0])", "splitCSVLine(lines[0], trim)").replace("splitCSVLine(lines[i])", "splitCSVLine(lines[i], trim)")
            (dst / "test/trim-option.test.js").write_text((FIX / "admission-tests/t4.test.mjs").read_text())
        else:
            s = s.replace("export function parseCSV(csv) {", "export function parseCSV(csv, _options = {}) {")
        p.write_text(s)
    elif task in ("t5", "ghost", "h1"):
        if gold:
            add = """\nexport function toCSV(rows) {\n  if (rows.length === 0) return '';\n  const keys = Object.keys(rows[0]);\n  const escape = (value) => {\n    const text = String(value ?? '');\n    return /[,\"\\n]/.test(text) ? `\"${text.replace(/\"/g, '\"\"')}\"` : text;\n  };\n  return [keys.map(escape).join(','), ...rows.map((row) => keys.map((key) => escape(row[key])).join(','))].join('\\n');\n}\n"""
        else:
            add = """\nexport function toCSV(rows) {\n  if (!rows.length) return '';\n  const keys = Object.keys(rows[0]);\n  return [keys.join(','), ...rows.map((row) => keys.map((key) => String(row[key] ?? '')).join(','))].join('\\n');\n}\n"""
        p.write_text(s + add)
    elif task == "t6":
        if gold:
            s = s.replace("let inQuotes = false;", "let inQuotes = false;\n  let quoted = false;")
            s = s.replace("inQuotes = true;", "inQuotes = true;\n        quoted = true;")
            s = s.replace("fields.push(current.trim());\n        current = '';", "fields.push(quoted ? current : current.trim());\n        current = '';\n        quoted = false;")
            s = s.replace("fields.push(current.trim());\n\n  return fields;", "fields.push(quoted ? current : current.trim());\n\n  return fields;")
        else:
            s = s.replace("let inQuotes = false;", "let inQuotes = false;\n  let quoted = false;")
            s = s.replace("inQuotes = true;", "inQuotes = true;\n        quoted = true;")
            s = s.replace("fields.push(current.trim());\n        current = '';", "fields.push(quoted ? current : current.trim());\n        current = '';\n        quoted = false;", 1)
        p.write_text(s)
    elif task == "bigdata":
        totals = {}
        for line in (dst / "data/events.jsonl").read_text().splitlines():
            row = json.loads(line)
            if gold and row["status"] != "ok": continue
            totals[row["user"]] = totals.get(row["user"], 0) + row["amount"]
        top = [{"user": user, "total": round(total + 1e-9, 2)} for user, total in sorted(totals.items(), key=lambda x: (-x[1], x[0]))[:3]]
        (dst / "src/top3.json").write_text(json.dumps(top, indent=2) + "\n")
    elif task == "equil":
        p.write_text(s.replace("for (let i = 1; i < arr.length - 1; i++)", "for (let i = 0; i < arr.length; i++)" if gold else "for (let i = 0; i < arr.length - 1; i++)"))
    elif task == "h2":
        if gold:
            replacement = """export function parseCSV(csv) {\n  const records = []; let row = [], field = '', quoted = false;\n  for (let i = 0; i < csv.length; i++) {\n    const c = csv[i];\n    if (quoted) {\n      if (c === '\"' && csv[i + 1] === '\"') { field += '\"'; i++; }\n      else if (c === '\"') quoted = false;\n      else field += c;\n    } else if (c === '\"') quoted = true;\n    else if (c === ',') { row.push(field.trim()); field = ''; }\n    else if (c === '\\n') { row.push(field.trim()); records.push(row); row = []; field = ''; }\n    else field += c;\n  }\n  row.push(field.trim()); records.push(row);\n  const [headers, ...data] = records;\n  return data.filter((r) => r.some((v) => v !== '')).map((values) => Object.fromEntries(headers.map((key, i) => [key, values[i] || ''])));\n}"""
            start = s.index("export function parseCSV(csv) {"); end = s.index("\n}\n\n/**\n * Convert", start) + 2
            s = s[:start] + replacement + s[end:]
        else:
            s = s.replace("const lines = csv.trim().split('\\n');", "const lines = csv.trim().replace(/(^|,)\"([^\"]*)\\n([^\"]*)\"/m, '$1\"$2\\\\n$3\"').split('\\n');")
        p.write_text(s)
    elif task == "h3":
        p = dst / "src/depth.js"; s = p.read_text(); p.write_text(s.replace("depth + 1 > max", "depth > max").replace("max = depth + 1", "max = depth" if gold else "max = depth + 1"))
    elif task == "lying":
        p.write_text(s.replace("return s.trim().replace(/\\s+/g, '-');", "return s.trim().replace(/\\s+/g, '-').toLowerCase();" if gold else "return s.trim().replace(/\\s/g, '-').toLowerCase();"))
    elif task == "parens":
        if gold:
            p.write_text("""export function firstUnmatched(s) {\n  const opens = [];\n  for (let i = 0; i < s.length; i++) {\n    if (s[i] === '(') opens.push(i);\n    else if (s[i] === ')') { if (!opens.length) return i; opens.pop(); }\n  }\n  return opens.length ? opens[0] : s.length;\n}\n""")
        else:
            p.write_text(s.replace("let depth = 0, lastOpen = -1;", "let depth = 0, lastOpen = -1; // track unmatched opens").replace("return depth > 0 ? lastOpen : s.length;", "return depth > 0 ? lastOpen : s.length; // partial stack-like fix"))
    elif task == "rle":
        enc = """export function encode(s) {\n  return s.replace(/(.)\\1+/g, (run, ch) => `${run.length}${ch}`);\n}\n\nexport function decode(s) {\n  return s.replace(/(\\d+)(.)/g, (_, n, ch) => ch.repeat(Number(n)));\n}\n"""
        mut = enc.replace("(\\d+)(.)", "(\\d)(.)")
        p.write_text(enc if gold else mut)
    elif task == "roman":
        if gold:
            s = s.replace("  // BUG: left-to-right subtractive sum with NO validation — accepts malformed numerals.\n", "  if (!/^(?=.+)M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/.test(s)) return null;\n")
        else:
            s = s.replace("  // BUG: left-to-right subtractive sum with NO validation — accepts malformed numerals.\n", "  if (/IIII|VV/.test(s)) return null;\n")
        p.write_text(s)
    elif task == "saddle":
        body = """export function saddlePoints(matrix) {\n  const out = [];\n  for (let r = 0; r < matrix.length; r++) for (let c = 0; c < matrix[r].length; c++) {\n    const v = matrix[r][c];\n    if (matrix[r].every((x) => v >= x) && matrix.every((row) => v <= row[c]))\n      out.push({ row: r + %s, col: c + %s });\n  }\n  return out;\n}\n""" % ((1, 1) if gold else (0, 0))
        p.write_text(body)
    elif task == "titlecase":
        if gold: p.write_text("export function titleCase(s) {\n  return s.split(' ').map((w) => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');\n}\n")
        else: p.write_text(s.replace("[^a-z]", "[^a-z']"))


def diff_dirs(before, after):
    lines = []
    files = sorted({p.relative_to(before) for p in before.rglob("*") if p.is_file()} | {p.relative_to(after) for p in after.rglob("*") if p.is_file()})
    for rel in files:
        a, b = before / rel, after / rel
        al = a.read_text().splitlines(True) if a.exists() else []
        bl = b.read_text().splitlines(True) if b.exists() else []
        lines.extend(difflib.unified_diff(al, bl, f"a/{rel}", f"b/{rel}"))
    return "".join(lines)


def prompt_variants(text):
    variants = [f"Complete the following repository task. Preserve existing behavior and verify the tests.\n\n{text}",
                f"Repository change request:\n{text}\n\nUse the smallest correct change and confirm the test suite.",
                f"Please solve this task in the supplied checkout, retaining all stated edge cases:\n\n{text}"]
    return [{"id": f"equivalent-{i+1}", "text": value, "sha256": h(value), "approved": False} for i, value in enumerate(variants)]


def artifacts(task, gold, mutant, overlays, extras):
    paths = {TASKS / f"{task}.txt", gold, mutant, *extras}
    paths.update(Path(x["source"]) if Path(x["source"]).is_absolute() else ROOT / x["source"] for x in overlays)
    # Only catalog fixture inputs that stage() and the graders actually consume.
    # The original private pi-test checkout contained planning notes, traces and
    # archived agent state; hashing those made the reusable catalog non-portable.
    fixture_root = root_for(task)
    for name in ("package.json", "src", "test", "data"):
        item = fixture_root / name
        if item.is_file():
            paths.add(item)
        elif item.is_dir():
            paths.update(p for p in item.rglob("*") if p.is_file() and "node_modules" not in p.parts)
    return [{"path": str(p.relative_to(ROOT)), "sha256": h(p.read_bytes())} for p in sorted(paths)]


def build(task):
    OUT.mkdir(parents=True, exist_ok=True); MANIFESTS.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        base, gold_dir, mut_dir = (Path(td) / x for x in ("base", "gold", "mutant"))
        stage(task, base); shutil.copytree(base, gold_dir); shutil.copytree(base, mut_dir)
        mutate(task, gold_dir, True); mutate(task, mut_dir, False)
        task_out = OUT / task; task_out.mkdir(parents=True, exist_ok=True)
        gold = task_out / "gold.patch"; mutant = task_out / "shortcut.patch"
        gold.write_text(diff_dirs(base, gold_dir)); mutant.write_text(diff_dirs(base, mut_dir))

    p2p = {"command": ["node", "--test"], "overlays": [], "timeout_seconds": 60}
    extras = []
    if task in ("rle", "saddle"):
        smoke = FIX / "admission-tests" / f"{task}-pass-to-pass.test.mjs"
        p2p = {"command": ["node", "--test", "test/pass-to-pass.test.mjs"],
               "overlays": [{"source": str(smoke.relative_to(ROOT)), "dest": "test/pass-to-pass.test.mjs"}],
               "timeout_seconds": 60}
        extras.append(smoke)
    if task in HIDDEN:
        source = FIX / "hidden" / f"{task}.test.js"; dest = "test/fail-to-pass.test.js"
    elif task == "t1": source = FIX / "admission-tests/t1.test.mjs"; dest = "test/fail-to-pass.test.mjs"
    elif task == "t2": source = FIX / "t2-check.mjs"; dest = "test/fail-to-pass.mjs"
    elif task == "t3": source = ROOT / "ab-symbolect/t3-files/align.test.js"; dest = "test/fail-to-pass.test.js"; extras.append(ROOT / "ab-symbolect/t3-files/align.js")
    elif task == "t4": source = FIX / "admission-tests/t4.test.mjs"; dest = "test/fail-to-pass.test.mjs"
    elif task == "t5": source = FIX / "toCSV.test.js"; dest = "test/fail-to-pass.test.js"
    else: source = FIX / "quoting.test.js"; dest = "test/fail-to-pass.test.js"
    overlay = {"source": str(source.relative_to(ROOT)), "dest": dest}
    f2p = {"command": ["node", dest] if task == "t2" else ["node", "--test", dest], "overlays": [overlay], "timeout_seconds": 60}
    prompt = (TASKS / f"{task}.txt").read_text().strip()
    test_text = source.read_text()
    expectations = re.findall(r"\btest\(\s*['\"]([^'\"]+)", test_text)
    if not expectations:
        expectations = ["FAIL_TO_PASS behavior and stated edge cases"]
    root_rel = str(root_for(task).relative_to(ROOT))
    context = sorted(str(p.relative_to(root_for(task))) for p in root_for(task).rglob("*") if p.is_file() and ("src" in p.parts or "test" in p.parts))
    if task == "t3": context += ["src/align.js"]
    context_bytes = sum((root_for(task) / p).stat().st_size for p in context if (root_for(task) / p).is_file()) + sum(p.stat().st_size for p in extras)
    manifest = {
        "schema": "pi.fixture/v1", "task_id": task, "cohort_id": "2026-07", "fixture_version": "2026-07.1",
        "timestamps": {"created_at": "2026-07-14T00:00:00Z", "admitted_at": None, "expires_at": None},
        "prompts": {"semantic_group": f"{task}:2026-07.1", "canonical": {"text": prompt, "sha256": h(prompt)}, "perturbations": prompt_variants(prompt)},
        "fixture": {"root": root_rel, "stage_copy": ([{"source": "ab-symbolect/t3-files/align.js", "dest": "src/align.js"}] if task == "t3" else [])},
        "tests": {"pass_to_pass": p2p, "fail_to_pass": f2p},
        "patches": {"gold": str(gold.relative_to(ROOT)), "shortcut_mutants": [str(mutant.relative_to(ROOT))]},
        "sufficiency": [{"assertion": assertion, "prompt_evidence": prompt} for assertion in expectations],
        "one_shot": {"eligible": task != "bigdata" and context_bytes <= 49152, "context_files": context, "max_context_bytes": 49152},
        "admission": {"approved": False, "reviewer": None, "reviewed_at": None, "automated": None},
        "artifacts": artifacts(task, gold, mutant, [overlay], extras),
    }
    manifest_path = MANIFESTS / f"{task}.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        identity_keys = ("schema", "task_id", "cohort_id", "fixture_version", "prompts", "fixture",
                         "tests", "patches", "sufficiency", "one_shot", "artifacts")
        if all(previous.get(key) == manifest.get(key) for key in identity_keys):
            manifest["admission"] = previous.get("admission", manifest["admission"])
            manifest["timestamps"] = previous.get("timestamps", manifest["timestamps"])
        # Any content drift deliberately clears automation and human sign-off.
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    for name in ALL: build(name)
    print(f"built {len(ALL)} fixture manifests")
