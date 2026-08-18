#!/usr/bin/env python3
"""Reproducibly build the initial 2026-07 fixture catalog and patch assets."""
from __future__ import annotations

import difflib
import hashlib
import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "real-gate-fixtures"
TASKS = ROOT / "ab-symbolect/tasks"
OUT = FIX / "patches"
MANIFESTS = FIX / "manifests"
HIDDEN = {p.stem.replace(".test", "") for p in (FIX / "hidden").glob("*.test.js")}
MIRROR_V3 = {"mirror-cross-file-cli", "mirror-partial-order-cli"}

# pi.fixture/v2 authoring-rubric fields for the 2026-08 ling cohort
# (LING_COHORT_2026-08.md is the narrative source; these are the machine copies).
V2_FIELDS = {
    "ling-exact-gate-recovery": {
        "difficulty_crux": {
            "mechanism": "exact-gate discovery and recovery: find and satisfy the project's declared verification (compound test script with scripts/project-gate.mjs), not the habitual bare `node --test`",
            "expected_failure": "runs bare `node --test`, sees green, claims done without ever executing the project gate",
            "band_prediction": [0.30, 0.50]},
        "findability": [
            {"evidence_file": "package.json", "sentence_anchor": "node --test test/visible.test.js && node scripts/project-gate.mjs"},
            {"evidence_file": "scripts/project-gate.mjs", "sentence_anchor": "project gate"}],
        "shortcut_sharpness": {"why_plausible": "special-casing the gate's sample inputs passes the visible suite and looks like a targeted fix; only the gate's property checks expose it"},
        "episode_variance": {"expected": True, "rationale": "gate failures after the first edit open verification_assertion episodes; recovery paths vary"}},
    "ling-cross-file-contract": {
        "difficulty_crux": {
            "mechanism": "cross-file contract coordination: one semantic change (add 'blocked') requires STATUS_ORDER in policy.js to stay the single source of truth AND the parser to derive from it",
            "expected_failure": "edits only policy.js (or adds 'blocked' to both vocabularies independently), visible suite stays green, claims done",
            "band_prediction": [0.20, 0.40]},
        "findability": [
            {"evidence_file": "src/policy.js", "sentence_anchor": "STATUS_ORDER"},
            {"evidence_file": "src/parse-job.js", "sentence_anchor": "ALLOWED"}],
        "shortcut_sharpness": {"why_plausible": "adding 'blocked' to both lists independently satisfies every fixed-vocabulary behaviour check; only vocabulary-extension coupling exposes the duplicate"},
        "episode_variance": {"expected": False, "rationale": "the failure mode is a silently-green wrong edit, not an episodic error loop"}},
    "ling-partial-order-release": {
        "difficulty_crux": {
            "mechanism": "algorithm-class upgrade under a partial order: a comparator cannot express dependency constraints; the fix demands a topological scheduler with tie-breaks and rejection guards",
            "expected_failure": "keeps the urgency sort and patches around it; dependency ordering never holds",
            # band_prediction is a MEAN graded_rate (fixed/total), not the full-pass rate.
            # The no-mutation/rejection guards floor graded_rate near 0.25 and are writable
            # without the topological insight; the ordering tests (the actual crux) are the
            # hard end. Corrected off the full-pass 0.05-0.25 to the graded scale 2026-08-18.
            "band_prediction": [0.30, 0.60]},
        "findability": [
            {"evidence_file": "src/release-plan.js", "sentence_anchor": "scheduleJobs"}],
        "shortcut_sharpness": {"why_plausible": "hard-coding the sample DAG's expected order passes the visible suite and mimics a working scheduler"},
        "episode_variance": {"expected": True, "rationale": "self-check failures against dependency/rejection cases recur across attempts"}},
    "sweep-a": {
        "difficulty_crux": {
            "mechanism": "multi-defect documentation sweep: six independent, individually-findable drifts from docs/FORMAT.md spanning doc-lookup (separators, OUT marker), cross-file coupling (restated rate), collection blindness (sort), non-commuting charge order (discount before fee), and population selection (active-only TOTAL)",
            "expected_failure": "fixes the doc-lookup defects the prompt telegraphs, misses the coupling/order/population defects the visible suite never exercises",
            "band_prediction": [0.35, 0.65]},
        "findability": [
            {"evidence_file": "docs/FORMAT.md", "sentence_anchor": "thousands separators"},
            {"evidence_file": "docs/FORMAT.md", "sentence_anchor": "single source of truth"},
            {"evidence_file": "docs/FORMAT.md", "sentence_anchor": "The fee is never discounted"},
            {"evidence_file": "docs/FORMAT.md", "sentence_anchor": "active items only"}],
        "shortcut_sharpness": {"why_plausible": "pinning known-good outputs for the visible sample values mimics a formatting fix and keeps every visible test green"},
        "episode_variance": {"expected": False, "rationale": "defect fixes are silently partial, not episodic; this is the capability mid-band instrument"}},
    "sweep-b": {
        "difficulty_crux": {
            "mechanism": "iterative pipeline recovery against a project gate: five documented invariants (blank/malformed handling, EXP category, zero-kept-and-flagged, non-EXP average denominator, first-seen category order) surfaced only by running `npm test` (unit tests + scripts/pipeline-gate.mjs), not a bare `node --test`",
            "expected_failure": "runs bare `node --test`, sees the visible suite green, never discovers or iterates against the project gate",
            "band_prediction": [0.30, 0.60]},
        "findability": [
            {"evidence_file": "docs/PIPELINE.md", "sentence_anchor": "The project's own gate is `npm test`"},
            {"evidence_file": "package.json", "sentence_anchor": "scripts/pipeline-gate.mjs"}],
        "shortcut_sharpness": {"why_plausible": "the mutant passes the visible `node --test` but fails the project gate (`npm test`) and the hidden grader — the partial state a model reaches when it stops at the visible suite instead of discovering and iterating against the project gate; the gate is the crux this fixture measures"},
        "episode_variance": {"expected": True, "rationale": "the project gate fails loudly and iteratively; each recovery attempt against a still-red invariant opens a verification episode — this is the loop-cohort instrument"}},
    "sweep-c": {
        "difficulty_crux": {
            "mechanism": "partial-order construction + path-evidence target selection: build a topological planner (deps-first, input-order tie-break, reject unknown-dep/duplicate/cycle, non-mutating) in the file src/index.js actually imports, not the similarly-named decoy",
            "expected_failure": "edits the camelCase decoy src/steps/planBuild.js and/or keeps a comparator/input-order pass that cannot express a DAG",
            "band_prediction": [0.10, 0.45]},
        "findability": [
            {"evidence_file": "src/index.js", "sentence_anchor": "./steps/plan-build.js"},
            {"evidence_file": "docs/BUILD.md", "sentence_anchor": "src/steps/plan-build.js (the real, wired-up module)"}],
        "shortcut_sharpness": {"why_plausible": "hard-coding the visible suite's small dependency-free shapes returns the right names for those inputs while any real DAG stays unordered"},
        "episode_variance": {"expected": True, "rationale": "rejection-guard and cycle self-checks fail repeatedly during construction, opening verification episodes"}},
    "ling-path-evidence": {
        "difficulty_crux": {
            "mechanism": "evidence-based target identification: resolve which of two similarly-named files is load-bearing by following the import chain, not name similarity",
            "expected_failure": "edits the British-spelled decoy src/normalise-ticket.js, behaviour unchanged, claims done",
            "band_prediction": [0.40, 0.60]},
        "findability": [
            {"evidence_file": "src/index.js", "sentence_anchor": "tickets/normalize-ticket.js"},
            {"evidence_file": "src/normalise-ticket.js", "sentence_anchor": "not used by the package export"}],
        "shortcut_sharpness": {"why_plausible": "fixing the decoy plus a partial patch at the export satisfies the visible inputs while the hidden inputs still fail"},
        "episode_variance": {"expected": False, "rationale": "wrong-target edits are silently green, not episodic"}},
}

# v3 fixtures have a separate builder because their dual/oracle contracts are
# intentionally stricter than this historical v1/v2 catalog.
ALL = [f"t{i}" for i in range(1, 7)] + sorted(HIDDEN - MIRROR_V3)


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
    initial = {
        "ling-exact-gate-recovery": "src/allocate.js",
        "ling-cross-file-contract": "src/policy.js",
        "ling-partial-order-release": "src/release-plan.js",
        "ling-path-evidence": "src/index.js",
        "sweep-a": "src/report.js",
        "sweep-b": "src/pipeline.js",
        "sweep-c": "src/index.js",
    }.get(task, "src/index.js")
    p = dst / initial
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
    elif task == "ling-exact-gate-recovery":
        p = dst / "src/allocate.js"
        if gold:
            p.write_text("""export function allocateCredits(requests, available) {
  if (!Number.isFinite(available) || available < 0) {
    throw new RangeError('available must be a non-negative finite number');
  }
  let remaining = available;
  const ranked = requests.map((request, index) => ({ request, index }))
    .sort((a, b) => (b.request.urgency ?? 0) - (a.request.urgency ?? 0) || a.index - b.index);
  const grants = ranked.map(({ request, index }) => {
    const requested = Math.max(0, Number.isFinite(request.requested) ? request.requested : 0);
    const granted = Math.min(requested, remaining);
    remaining -= granted;
    return { index, row: { id: request.id, granted } };
  });
  return grants.sort((a, b) => a.index - b.index).map(({ row }) => row);
}
""")
        else:
            p.write_text("""export function allocateCredits(requests, available) {
  if (!Number.isFinite(available) || available < 0) {
    throw new RangeError('available must be a non-negative finite number');
  }
  let remaining = available;
  return requests.map(({ id, requested }) => {
    const granted = Math.min(Math.max(0, requested), remaining);
    remaining -= granted;
    return { id, granted };
  });
}
""")
    elif task == "ling-cross-file-contract":
        policy = dst / "src/policy.js"
        policy.write_text(policy.read_text().replace("['queued', 'running', 'done']", "['queued', 'blocked', 'running', 'done']"))
        if gold:
            parser = dst / "src/parse-job.js"
            parser.write_text("""import { STATUS_ORDER } from './policy.js';

const ALLOWED = new Set(STATUS_ORDER);

export function parseJob(line) {
  const [id, rawStatus] = line.split(':');
  const status = (rawStatus ?? '').trim().toLowerCase();
  if (!id?.trim() || !ALLOWED.has(status)) throw new Error('invalid job');
  return { id: id.trim(), status };
}
""")
    elif task == "sweep-a":
        report = dst / "src/report.js"
        if gold:
            report.write_text("import { settings } from './config.js';\n\nexport function lineTotal(item) {\n  let total = item.qty * item.price * settings.currencyRate;\n  if (item.discounted) total = total * (1 - settings.discountRate);\n  total = total + settings.handlingFee;\n  return Math.round(total * 100) / 100;\n}\n\nexport function formatQty(item) {\n  if (item.qty === 0) return 'OUT'.padStart(5, ' ');\n  return String(item.qty).padStart(5, ' ');\n}\n\nexport function formatMoney(value) {\n  const [whole, frac] = value.toFixed(2).split('.');\n  return whole.replace(/\\\\B(?=(\\\\d{3})+(?!\\\\d))/g, ',') + '.' + frac;\n}\n\nexport function buildReport(items) {\n  const rows = [...items].sort((a, b) => a.name.localeCompare(b.name))\n    .map((i) => `${i.name} ${formatQty(i)} ${formatMoney(lineTotal(i))}`);\n  const active = items.filter((i) => i.qty > 0);\n  const total = active.reduce((sum, i) => sum + lineTotal(i), 0);\n  return rows.join('\\\\n') + '\\\\nTOTAL ' + formatMoney(Math.round(total * 100) / 100);\n}\n".replace("\\\\", "\\"))
        else:
            report.write_text("import { settings } from './config.js';\n\nconst RATE = 1.25;\nconst KNOWN = new Map([['12.5', '12.50'], ['12', '12.00']]);\n\nexport function lineTotal(item) {\n  let total = item.qty * item.price * RATE;\n  total = total + settings.handlingFee;\n  if (item.discounted) total = total * (1 - settings.discountRate);\n  return Math.round(total * 100) / 100;\n}\n\nexport function formatQty(item) {\n  return String(item.qty).padStart(5, ' ');\n}\n\nexport function formatMoney(value) {\n  const key = String(value);\n  if (KNOWN.has(key)) return KNOWN.get(key);\n  return value.toFixed(2);\n}\n\nexport function buildReport(items) {\n  const rows = items.map((i) => `${i.name} ${formatQty(i)} ${formatMoney(lineTotal(i))}`);\n  const total = items.reduce((sum, i) => sum + lineTotal(i), 0);\n  return rows.join('\\\\n') + '\\\\nTOTAL ' + formatMoney(Math.round(total * 100) / 100);\n}\n".replace("\\\\", "\\"))
    elif task == "sweep-b":
        pipeline = dst / "src/pipeline.js"
        if gold:
            pipeline.write_text("export function parse(text) {\n  return text.split('\\\\n').filter((line) => line.trim() !== '').map((line) => {\n    const [id, category, rawAmount] = line.split(',');\n    if (!id || !category || rawAmount === undefined) throw new Error(`malformed line: ${line}`);\n    return { id, category, amount: Number(rawAmount) };\n  });\n}\n\nexport function validate(records) {\n  const KNOWN = ['goods', 'services', 'EXP'];\n  for (const record of records) {\n    if (!KNOWN.includes(record.category)) throw new Error(`unknown category: ${record.category}`);\n  }\n  return records;\n}\n\nexport function transform(records) {\n  return records.map((record) => ({ ...record, zero: record.amount === 0 }));\n}\n\nexport function summarize(records) {\n  const categories = [...new Set(records.map((record) => record.category))];\n  const total = records.reduce((sum, record) => sum + record.amount, 0);\n  const sales = records.filter((record) => record.category !== 'EXP');\n  const average = Math.round((total / sales.length) * 100) / 100;\n  return { categories, total, average };\n}\n\nexport function run(text) {\n  const kept = transform(validate(parse(text)));\n  return { records: kept, ...summarize(kept) };\n}\n".replace("\\\\", "\\"))
        else:
            pipeline.write_text("export function parse(text) {\n  return text.split('\\\\n').filter((line) => line !== '').map((line) => {\n    const [id, category, rawAmount] = line.split(',');\n    return { id, category, amount: Number(rawAmount) };\n  });\n}\n\nexport function validate(records) { return records; }\n\nexport function transform(records) {\n  return records.map((record) => ({ ...record, zero: record.amount === 0 }));\n}\n\nconst KNOWN_AVG = new Map([['8/2', 4], ['8/3', 2.67]]);\n\nexport function summarize(records) {\n  const categories = [...new Set(records.map((record) => record.category))];\n  const total = records.reduce((sum, record) => sum + record.amount, 0);\n  const sales = records.filter((record) => record.category !== 'EXP');\n  const key = `${total}/${sales.length}`;\n  const average = KNOWN_AVG.has(key) ? KNOWN_AVG.get(key) : Math.round((total / records.length) * 100) / 100;\n  return { categories, total, average };\n}\n\nexport function run(text) {\n  const kept = transform(validate(parse(text)));\n  return { records: kept, ...summarize(kept) };\n}\n".replace("\\\\", "\\"))
    elif task == "sweep-c":
        if gold:
            (dst / "src/steps/plan-build.js").write_text("// The wired-up planner (src/index.js imports THIS file). Topological order:\n// dependencies first, input order as the ready-set tie-break, reject bad graphs,\n// never mutate the input.\nexport function planBuild(steps) {\n  const names = steps.map((step) => step.name);\n  const seen = new Set();\n  for (const name of names) {\n    if (seen.has(name)) throw new Error(`duplicate step: ${name}`);\n    seen.add(name);\n  }\n  for (const step of steps) {\n    for (const need of step.needs) {\n      if (!seen.has(need)) throw new Error(`unknown dependency: ${need}`);\n    }\n  }\n  const order = [];\n  const done = new Set();\n  const remaining = steps.map((step) => ({ name: step.name, needs: [...step.needs] }));\n  while (remaining.length) {\n    const index = remaining.findIndex((step) => step.needs.every((need) => done.has(need)));\n    if (index === -1) throw new Error('cycle detected');\n    const [ready] = remaining.splice(index, 1);\n    order.push(ready.name);\n    done.add(ready.name);\n  }\n  return order;\n}\n")
        else:
            (dst / "src/steps/plan-build.js").write_text("// SHORTCUT: hard-codes the shapes the visible suite exercises; ignores the\n// dependency structure of any other input.\nconst KNOWN = new Map([\n  ['a,b', ['a', 'b']],\n  ['x', ['x']],\n]);\nexport function planBuild(steps) {\n  const key = steps.map((step) => step.name).join(',');\n  if (KNOWN.has(key)) return KNOWN.get(key);\n  return steps.map((step) => step.name);\n}\n")
            (dst / "src/steps/planBuild.js").write_text("// DECOY fixed by the shortcut (nothing imports this file). Editing it changes\n// no observable behaviour of the public export.\nexport function planBuild(steps) {\n  const order = [];\n  const done = new Set();\n  const remaining = steps.map((step) => ({ name: step.name, needs: [...step.needs] }));\n  while (remaining.length) {\n    const index = remaining.findIndex((step) => step.needs.every((need) => done.has(need)));\n    if (index === -1) throw new Error('cycle detected');\n    const [ready] = remaining.splice(index, 1);\n    order.push(ready.name);\n    done.add(ready.name);\n  }\n  return order;\n}\n")
    elif task == "ling-partial-order-release":
        p = dst / "src/release-plan.js"
        if gold:
            p.write_text("""export function scheduleJobs(jobs) {
  const indexed = jobs.map((job, index) => ({ job, index }));
  const byId = new Map();
  for (const item of indexed) {
    if (typeof item.job.id !== 'string' || byId.has(item.job.id)) throw new Error('duplicate job id');
    byId.set(item.job.id, item);
  }
  const indegree = new Map(indexed.map(({ job }) => [job.id, 0]));
  const dependents = new Map(indexed.map(({ job }) => [job.id, []]));
  for (const { job } of indexed) for (const dependency of job.after ?? []) {
    if (!byId.has(dependency)) throw new Error('unknown prerequisite');
    indegree.set(job.id, indegree.get(job.id) + 1);
    dependents.get(dependency).push(job.id);
  }
  const available = indexed.filter(({ job }) => indegree.get(job.id) === 0);
  const output = [];
  while (available.length) {
    available.sort((a, b) => (b.job.urgency ?? 0) - (a.job.urgency ?? 0) || a.index - b.index);
    const { job } = available.shift();
    output.push(job.id);
    for (const id of dependents.get(job.id)) {
      indegree.set(id, indegree.get(id) - 1);
      if (indegree.get(id) === 0) available.push(byId.get(id));
    }
  }
  if (output.length !== jobs.length) throw new Error('dependency cycle');
  return output;
}
""")
        else:
            p.write_text("""export function scheduleJobs(jobs) {
  return [...jobs].sort((a, b) => {
    if ((a.after ?? []).includes(b.id)) return 1;
    if ((b.after ?? []).includes(a.id)) return -1;
    return (b.urgency ?? 0) - (a.urgency ?? 0);
  }).map((job) => job.id);
}
""")
    elif task == "ling-path-evidence":
        target = dst / ("src/tickets/normalize-ticket.js" if gold else "src/normalise-ticket.js")
        target.write_text("""export function normalizeTicket(value) {
  if (typeof value !== 'string') throw new TypeError('ticket must be a string');
  const match = value.replace(/\\s+/g, '').match(/^([a-z]+)-(\\d+)$/i);
  if (!match) throw new TypeError('invalid ticket');
  const number = String(Number(match[2]));
  return `${match[1].toUpperCase()}-${number}`;
}
""")


def diff_dirs(before, after):
    lines = []
    files = sorted({p.relative_to(before) for p in before.rglob("*") if p.is_file()} | {p.relative_to(after) for p in after.rglob("*") if p.is_file()})
    for rel in files:
        a, b = before / rel, after / rel
        al = a.read_text().splitlines(True) if a.exists() else []
        bl = b.read_text().splitlines(True) if b.exists() else []
        # GNU patch accepts an empty context line as the canonical blank-line
        # representation. Keeping the usual single-space prefix makes the patch
        # artifact itself fail git diff --check as trailing whitespace.
        lines.extend("\n" if line == " \n" else line
                     for line in difflib.unified_diff(al, bl, f"a/{rel}", f"b/{rel}"))
    return "".join(lines)


def prompt_variants(text):
    variants = [f"Complete the following repository task. Preserve existing behavior and verify the tests.\n\n{text}",
                f"Repository change request:\n{text}\n\nUse the smallest correct change and confirm the test suite.",
                f"Please solve this task in the supplied checkout, retaining all stated edge cases:\n\n{text}"]
    # No per-variant "approved" flag: approval is admission.approved_prompt_hashes
    # (the only field the gate reads — eval_fixture.py), and a nested approved:false
    # sitting beside a true top-level approval misled readers (2026-08-11 inspection).
    return [{"id": f"equivalent-{i+1}", "text": value, "sha256": h(value)} for i, value in enumerate(variants)]


def artifacts(task, gold, mutant, overlays, extras):
    paths = {TASKS / f"{task}.txt", gold, mutant, *extras}
    paths.update(Path(x["source"]) if Path(x["source"]).is_absolute() else ROOT / x["source"] for x in overlays)
    # Only catalog fixture inputs that stage() and the graders actually consume.
    # The original private pi-test checkout contained planning notes, traces and
    # archived agent state; hashing those made the reusable catalog non-portable.
    fixture_root = root_for(task)
    for name in ("package.json", "src", "test", "data", "scripts"):
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
        "schema": "pi.fixture/v2" if task in V2_FIELDS else "pi.fixture/v1", "task_id": task,
        "cohort_id": "2026-08" if task.startswith("ling-") else "2026-07",
        "fixture_version": "2026-08.1" if task.startswith("ling-") else "2026-07.1",
        "timestamps": {"created_at": "2026-08-13T00:00:00Z" if task.startswith("ling-") else "2026-07-14T00:00:00Z",
                       "admitted_at": None, "expires_at": None},
        "prompts": {"semantic_group": f"{task}:{'2026-08.1' if task.startswith('ling-') else '2026-07.1'}",
                    "canonical": {"text": prompt, "sha256": h(prompt)}, "perturbations": prompt_variants(prompt)},
        "fixture": {"root": root_rel, "stage_copy": ([{"source": "ab-symbolect/t3-files/align.js", "dest": "src/align.js"}] if task == "t3" else [])},
        "tests": {"pass_to_pass": p2p, "fail_to_pass": f2p},
        "patches": {"gold": str(gold.relative_to(ROOT)), "shortcut_mutants": [str(mutant.relative_to(ROOT))]},
        "sufficiency": [{"assertion": assertion, "prompt_evidence": prompt} for assertion in expectations],
        "one_shot": {"eligible": not task.startswith("ling-") and task != "bigdata" and context_bytes <= 49152, "context_files": context, "max_context_bytes": 49152},
        "admission": {"approved": False, "reviewer": None, "reviewed_at": None, "automated": None},
        "artifacts": artifacts(task, gold, mutant, [overlay], extras),
    }
    if task in V2_FIELDS:
        manifest.update(V2_FIELDS[task])
    manifest_path = MANIFESTS / f"{task}.json"
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text())
        identity_keys = ("schema", "task_id", "cohort_id", "fixture_version", "prompts", "fixture",
                         "tests", "patches", "sufficiency", "one_shot", "artifacts",
                         "difficulty_crux", "findability", "shortcut_sharpness", "episode_variance")
        if all(previous.get(key) == manifest.get(key) for key in identity_keys):
            manifest["admission"] = previous.get("admission", manifest["admission"])
            manifest["timestamps"] = previous.get("timestamps", manifest["timestamps"])
        # Any content drift deliberately clears automation and human sign-off.
    manifest_path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    selected = sys.argv[1:] or ALL
    unknown = sorted(set(selected) - set(ALL))
    if unknown: raise SystemExit(f"unknown fixture(s): {', '.join(unknown)}")
    for name in selected: build(name)
    print(f"built {len(selected)} fixture manifests")
