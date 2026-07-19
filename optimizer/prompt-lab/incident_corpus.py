#!/usr/bin/env python3
"""Intake, promote, and explicitly expire rotating incident fixtures."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "real-gate-fixtures/incidents/inbox"
ARCHIVE = ROOT / "real-gate-fixtures/incidents/archive"
MANIFESTS = ROOT / "real-gate-fixtures/manifests"


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def intake(args):
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    cohort = now.strftime("%Y-%m")
    data = {"schema": "pi.incident/v1", "incident_id": args.id, "cohort_id": cohort,
            "created_at": now.isoformat().replace("+00:00", "Z"), "source": args.source,
            "summary": args.summary, "status": "intake"}
    path = INBOX / cohort / f"{args.id}.json"
    if path.exists():
        raise SystemExit(f"incident exists: {path}")
    write(path, data); print(path)


def promote(args):
    matches = list(INBOX.glob(f"*/{args.id}.json"))
    if len(matches) != 1:
        raise SystemExit(f"expected one intake for {args.id}, found {len(matches)}")
    manifest = Path(args.manifest).resolve()
    data = json.loads(manifest.read_text(encoding="utf-8"))
    incident = json.loads(matches[0].read_text(encoding="utf-8"))
    if data.get("schema") != "pi.fixture/v1" or data.get("task_id") != args.id:
        raise SystemExit("promotion manifest is not the matching pi.fixture/v1 task")
    if data.get("cohort_id") != incident.get("cohort_id"):
        raise SystemExit("promotion manifest must retain the incident's monthly cohort")
    dst = MANIFESTS / f"{args.id}.json"
    if dst.exists():
        raise SystemExit(f"manifest already exists: {dst}")
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(manifest, dst)
    incident["status"] = "promoted"
    try: incident["manifest"] = str(dst.relative_to(ROOT))
    except ValueError: incident["manifest"] = str(dst)
    write(matches[0], incident); print(dst)


def expire(args):
    path = MANIFESTS / f"{args.id}.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    data["timestamps"]["expires_at"] = now
    data["admission"]["approved"] = False
    data["admission"]["expiry_reason"] = args.reason
    data["admission"]["expired_at"] = now
    write(path, data)
    ARCHIVE.mkdir(parents=True, exist_ok=True)
    snapshot = ARCHIVE / f"{args.id}-{now[:10]}.json"
    write(snapshot, data); snapshot.chmod(0o444); print(snapshot)


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest="command", required=True)
    p = sub.add_parser("intake"); p.add_argument("id"); p.add_argument("--source", required=True); p.add_argument("--summary", required=True)
    p = sub.add_parser("promote"); p.add_argument("id"); p.add_argument("--manifest", required=True)
    p = sub.add_parser("expire"); p.add_argument("id"); p.add_argument("--reason", required=True)
    args = ap.parse_args(); {"intake": intake, "promote": promote, "expire": expire}[args.command](args)


if __name__ == "__main__":
    main()
