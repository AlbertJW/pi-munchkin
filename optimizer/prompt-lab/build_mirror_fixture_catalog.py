#!/usr/bin/env python3
"""Reproducibly build the two pi.fixture/v3 Mirror-mini instruments."""
from __future__ import annotations

import json
import re
import shutil
import sys
import tempfile
from pathlib import Path

from build_fixture_catalog import diff_dirs, h, prompt_variants

ROOT = Path(__file__).resolve().parents[1]
FIX = ROOT / "real-gate-fixtures"
TASKS = ROOT / "ab-symbolect" / "tasks"
MANIFESTS = FIX / "manifests"
OUT = FIX / "patches"
NAMES = ("mirror-cross-file-cli", "mirror-partial-order-cli")

CROSS_GOLD = {
    "src/policy.js": """export const STATUS_ORDER = ['queued', 'blocked', 'running', 'done'];

export function canTransition(from, to) {
  return STATUS_ORDER.indexOf(to) === STATUS_ORDER.indexOf(from) + 1;
}
""",
    "src/parse-job.js": """import { STATUS_ORDER } from './policy.js';

export function parseJob(line) {
  const [id, rawStatus, ...extra] = line.split(':');
  const status = (rawStatus ?? '').trim().toLowerCase();
  if (extra.length || !id?.trim() || !STATUS_ORDER.includes(status)) throw new Error('invalid job');
  return { id: id.trim(), status };
}
""",
}
CROSS_MUTANTS = (
    {
        "name": "duplicate-vocabulary",
        "files": {
            "src/policy.js": CROSS_GOLD["src/policy.js"],
            "src/parse-job.js": """const ALLOWED = new Set(['queued', 'blocked', 'running', 'done']);

export function parseJob(line) {
  const [id, rawStatus, ...extra] = line.split(':');
  const status = (rawStatus ?? '').trim().toLowerCase();
  if (extra.length || !id?.trim() || !ALLOWED.has(status)) throw new Error('invalid job');
  return { id: id.trim(), status };
}
""",
        },
    },
    {
        "name": "parser-only",
        "files": {
            "src/parse-job.js": """const ALLOWED = new Set(['queued', 'blocked', 'running', 'done']);

export function parseJob(line) {
  const [id, rawStatus, ...extra] = line.split(':');
  const status = (rawStatus ?? '').trim().toLowerCase();
  if (extra.length || !id?.trim() || !ALLOWED.has(status)) throw new Error('invalid job');
  return { id: id.trim(), status };
}
""",
        },
    },
    {
        "name": "visible-case-hardcode",
        "files": {
            "src/parse-job.js": """const ALLOWED = new Set(['queued', 'running', 'done']);

export function parseJob(line) {
  if (line === ' job-7 : RUNNING ') return { id: 'job-7', status: 'running' };
  const [id, rawStatus, ...extra] = line.split(':');
  const status = (rawStatus ?? '').trim().toLowerCase();
  if (extra.length || !id?.trim() || !ALLOWED.has(status)) throw new Error('invalid job');
  return { id: id.trim(), status };
}
""",
        },
    },
)

PARTIAL_GOLD = {"src/schedule.js": """export function scheduleJobs(jobs) {
  const byId = new Map();
  jobs.forEach((job, index) => {
    if (typeof job.id !== 'string' || !job.id || byId.has(job.id)) throw new Error('duplicate id');
    byId.set(job.id, { job, index });
  });
  for (const { job } of byId.values()) for (const dependency of job.after ?? []) {
    if (!byId.has(dependency)) throw new Error('unknown dependency');
  }
  const emitted = new Set();
  const output = [];
  while (output.length < jobs.length) {
    const ready = [...byId.values()].filter(({ job }) => !emitted.has(job.id)
      && (job.after ?? []).every((dependency) => emitted.has(dependency)))
      .sort((a, b) => (b.job.urgency ?? 0) - (a.job.urgency ?? 0) || a.index - b.index);
    if (!ready.length) throw new Error('cycle');
    emitted.add(ready[0].job.id);
    output.push(ready[0].job.id);
  }
  return output;
}
"""}
PARTIAL_MUTANTS = (
    {
        "name": "local-dependency-repair",
        "files": {"src/schedule.js": """export function scheduleJobs(jobs) {
  const ordered = [...jobs].sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0));
  for (let pass = 0; pass < jobs.length; pass++) {
    for (let index = 0; index < ordered.length; index++) {
      for (const dependency of ordered[index].after ?? []) {
        const dependencyIndex = ordered.findIndex((job) => job.id === dependency);
        if (dependencyIndex > index) {
          const [parent] = ordered.splice(dependencyIndex, 1);
          ordered.splice(index, 0, parent);
        }
      }
    }
  }
  return ordered.map((job) => job.id);
}
"""},
    },
    {
        "name": "depth-first-order",
        "files": {"src/schedule.js": """export function scheduleJobs(jobs) {
  if (jobs.every((job) => !(job.after ?? []).length)) {
    return [...jobs].sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0)).map((job) => job.id);
  }
  const byId = new Map();
  for (const job of jobs) {
    if (byId.has(job.id)) throw new Error('duplicate id');
    byId.set(job.id, job);
  }
  for (const job of jobs) for (const dependency of job.after ?? []) {
    if (!byId.has(dependency)) throw new Error('unknown dependency');
  }
  const visiting = new Set(), emitted = new Set(), output = [];
  function visit(id) {
    if (emitted.has(id)) return;
    if (visiting.has(id)) throw new Error('cycle');
    visiting.add(id);
    for (const dependency of byId.get(id).after ?? []) visit(dependency);
    visiting.delete(id); emitted.add(id); output.push(id);
  }
  for (const job of jobs) visit(job.id);
  return output;
}
"""},
    },
    {
        "name": "visible-id-hardcode",
        "files": {"src/schedule.js": """export function scheduleJobs(jobs) {
  const byId = new Map();
  for (const job of jobs) {
    if (byId.has(job.id)) throw new Error('duplicate id');
    byId.set(job.id, job);
  }
  for (const job of jobs) for (const dependency of job.after ?? []) {
    if (!byId.has(dependency)) throw new Error('unknown dependency');
  }
  const visiting = new Set(), visited = new Set();
  function validate(id) {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new Error('cycle');
    visiting.add(id);
    for (const dependency of byId.get(id).after ?? []) validate(dependency);
    visiting.delete(id); visited.add(id);
  }
  for (const job of jobs) validate(job.id);
  const ids = jobs.map((job) => job.id).join(',');
  if (ids === 'docs,tests,lint') return ['tests', 'lint', 'docs'];
  if (ids === 'a,b') return ['a', 'b'];
  return [...jobs].sort((a, b) => (b.urgency ?? 0) - (a.urgency ?? 0)).map((job) => job.id);
}
"""},
    },
)

V3 = {
    "mirror-cross-file-cli": {
        "gold": CROSS_GOLD,
        "mutants": CROSS_MUTANTS,
        "difficulty_crux": {
            "mechanism": "cross-file semantic ownership observed through a CLI: parsing follows the live canonical policy rather than a copied vocabulary",
            "expected_failure": "adds blocked to two independent lists or only to the parser, passing visible legacy cases while breaking policy coupling",
            "band_prediction": [0.20, 0.80],
        },
        "findability": [
            {"evidence_file": "src/policy.js", "sentence_anchor": "STATUS_ORDER"},
            {"evidence_file": "src/parse-job.js", "sentence_anchor": "ALLOWED"},
        ],
        "shortcut_sharpness": {"why_plausible": "duplicating the new status is the smallest obvious patch and passes all visible legacy behaviour"},
        "episode_variance": {"expected": True, "rationale": "self-tests may reveal either a fixed-value success or continuing cross-file invariant failures"},
        "requirements": [
            {"id": "canonical-vocabulary", "behavior": "parsing follows runtime changes to the policy vocabulary", "prompt_anchor": "single source of truth", "weight": 0.40},
            {"id": "transition-order", "behavior": "blocked participates in adjacent-only transitions", "prompt_anchor": "adjacent-only transitions", "weight": 0.30},
            {"id": "cli-validation", "behavior": "the CLI preserves normalization and rejects malformed input", "prompt_anchor": "malformed-input rejection", "weight": 0.30},
        ],
        "coverage_map": {
            "canonical-vocabulary": {"visible": ["visible: normalizes an existing status through the CLI"], "hidden": ["dual:vocabulary follows a later policy extension", "dual:vocabulary follows a later policy removal"]},
            "transition-order": {"visible": ["visible: preserves adjacent transition behavior"], "hidden": ["dual:transitions insert blocked at the declared boundary", "dual:transitions reject skipped blocked edges"]},
            "cli-validation": {"visible": ["visible: normalizes an existing status through the CLI"], "hidden": ["dual:validation trims and normalizes CLI input", "dual:validation rejects malformed and unknown CLI input"]},
        },
        "oracle": "real-gate-fixtures/oracles/mirror-cross-file-cli.mjs",
        "canary": "mirror-mini-cobalt-orchid-71d4-cross-file",
    },
    "mirror-partial-order-cli": {
        "gold": PARTIAL_GOLD,
        "mutants": PARTIAL_MUTANTS,
        "difficulty_crux": {
            "mechanism": "algorithm-class change from a comparator to a dependency-aware ready-set scheduler behind a JSON CLI",
            "expected_failure": "patches local ordering examples or uses depth-first traversal without the required ready-set priority",
            "band_prediction": [0.20, 0.80],
        },
        "findability": [{"evidence_file": "src/schedule.js", "sentence_anchor": "scheduleJobs"}],
        "shortcut_sharpness": {"why_plausible": "moving direct parents or using DFS appears topological on small examples but violates global ready-set ordering"},
        "episode_variance": {"expected": True, "rationale": "different graph shapes expose distinct partial-order and validation failures"},
        "requirements": [
            {"id": "dependency-order", "behavior": "all prerequisites precede dependants across changed graph shapes", "prompt_anchor": "prerequisite IDs", "weight": 0.40},
            {"id": "ready-priority", "behavior": "ready jobs use urgency and then original input order", "prompt_anchor": "choosing among ready jobs", "weight": 0.30},
            {"id": "graph-integrity", "behavior": "invalid graphs are rejected and inputs remain unchanged", "prompt_anchor": "without mutating the input", "weight": 0.30},
        ],
        "coverage_map": {
            "dependency-order": {"visible": ["visible: orders independent jobs by urgency through the CLI"], "hidden": ["dual:dependencies schedule a changed multi-hop chain", "dual:dependencies schedule a changed fork and join"]},
            "ready-priority": {"visible": ["visible: preserves input order for independent urgency ties"], "hidden": ["dual:ready-set uses urgency after a dependency unlocks", "dual:ready-set uses original input order after an urgency tie"]},
            "graph-integrity": {"visible": ["visible: preserves input order for independent urgency ties"], "hidden": ["dual:integrity rejects unknown and duplicate identifiers", "dual:integrity rejects cycles without mutating input"]},
        },
        "oracle": "real-gate-fixtures/oracles/mirror-partial-order-cli.mjs",
        "canary": "mirror-mini-amber-lattice-28b9-partial-order",
    },
}


def write_files(root: Path, files: dict[str, str]):
    for relative, text in files.items():
        path = root / relative; path.parent.mkdir(parents=True, exist_ok=True); path.write_text(text)


def artifact_rows(paths):
    return [{"path": str(path.relative_to(ROOT)), "sha256": h(path.read_bytes())} for path in sorted(set(paths))]


def build(name):
    spec = V3[name]; root = FIX / name; hidden = FIX / "hidden" / f"{name}.test.js"
    prompt_path = TASKS / f"{name}.txt"; prompt = prompt_path.read_text().strip()
    patch_dir = OUT / name; patch_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=f"pi-build-{name}-") as td:
        base = Path(td) / "base"; shutil.copytree(root, base)
        gold_dir = Path(td) / "gold"; shutil.copytree(base, gold_dir); write_files(gold_dir, spec["gold"])
        gold = patch_dir / "gold.patch"; gold.write_text(diff_dirs(base, gold_dir))
        mutants = []
        for mutant in spec["mutants"]:
            mutant_dir = Path(td) / mutant["name"]; shutil.copytree(base, mutant_dir)
            write_files(mutant_dir, mutant["files"])
            path = patch_dir / f"{mutant['name']}.patch"; path.write_text(diff_dirs(base, mutant_dir)); mutants.append(path)

    fixture_files = [p for p in root.rglob("*") if p.is_file()]
    oracle = ROOT / spec["oracle"]
    artifacts = artifact_rows([prompt_path, hidden, oracle, gold, *mutants, *fixture_files])
    hidden_names = re.findall(r"\btest\(\s*['\"]([^'\"]+)", hidden.read_text())
    duals = [{"requirement_id": req["id"], "visible_case": spec["coverage_map"][req["id"]]["visible"][0],
              "hidden_cases": spec["coverage_map"][req["id"]]["hidden"]} for req in spec["requirements"]]
    manifest = {
        "schema": "pi.fixture/v3", "task_id": name, "cohort_id": "2026-08-mirror-mini",
        "fixture_version": "2026-08.1",
        "timestamps": {"created_at": "2026-08-17T00:00:00Z", "admitted_at": None, "expires_at": None},
        "prompts": {"semantic_group": f"{name}:2026-08.1",
                    "canonical": {"text": prompt, "sha256": h(prompt)},
                    "perturbations": prompt_variants(prompt)},
        "fixture": {"root": str(root.relative_to(ROOT)), "stage_copy": []},
        "tests": {
            "pass_to_pass": {"command": ["node", "--test", "test/visible.test.js"], "overlays": [], "timeout_seconds": 60},
            "fail_to_pass": {"command": ["node", "--test", "test/fail-to-pass.test.js"],
                             "overlays": [{"source": str(hidden.relative_to(ROOT)), "dest": "test/fail-to-pass.test.js"}],
                             "timeout_seconds": 60},
        },
        "patches": {"gold": str(gold.relative_to(ROOT)), "shortcut_mutants": [str(path.relative_to(ROOT)) for path in mutants]},
        "sufficiency": [{"assertion": name, "prompt_evidence": prompt} for name in hidden_names],
        "one_shot": {"eligible": False,
                     "context_files": sorted(str(p.relative_to(root)) for p in fixture_files if "src" in p.parts or "test" in p.parts),
                     "max_context_bytes": 49152},
        "admission": {"approved": False, "reviewer": None, "reviewed_at": None, "automated": None},
        "artifacts": artifacts,
        **{key: spec[key] for key in ("difficulty_crux", "findability", "shortcut_sharpness", "episode_variance", "requirements", "coverage_map")},
        "duals": duals,
        "oracle": {"entrypoint": spec["oracle"], "query_budget": 32, "timeout_ms": 2000, "output_cap_bytes": 4096},
        "provenance": {"authoring_timestamp": "2026-08-17T00:00:00Z",
                       "model_snapshot_boundary": "Ling Tiny fleet snapshot predates this fixture generation",
                       "contamination_canary_hash": h(spec["canary"])},
    }
    path = MANIFESTS / f"{name}.json"
    if path.exists():
        previous = json.loads(path.read_text())
        comparable = {key: value for key, value in manifest.items() if key not in ("admission", "timestamps")}
        old = {key: value for key, value in previous.items() if key not in ("admission", "timestamps")}
        if comparable == old:
            manifest["admission"] = previous["admission"]; manifest["timestamps"] = previous["timestamps"]
    path.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    selected = sys.argv[1:] or list(NAMES)
    unknown = sorted(set(selected) - set(NAMES))
    if unknown: raise SystemExit(f"unknown Mirror-mini fixture(s): {', '.join(unknown)}")
    for fixture in selected: build(fixture)
    print(f"built {len(selected)} pi.fixture/v3 manifests")
