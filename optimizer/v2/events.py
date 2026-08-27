from __future__ import annotations

import contextlib
import fcntl
import hashlib
import json
import os
import pathlib
import tempfile
from typing import Iterator


SCHEMA = "pi.optimizer-event/v1"


class EventStoreError(RuntimeError):
    pass


def _canonical(value: dict) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


class EventStore:
    def __init__(self, run_root: pathlib.Path, *, create: bool = True):
        self.run_root = run_root.resolve()
        self.events_path = self.run_root / "events.jsonl"
        self.lock_path = self.run_root / ".writer.lock"
        self.run_lock_path = self.run_root / ".campaign.lock"
        if not create:
            if not self.run_root.is_dir() or not self.events_path.is_file():
                raise EventStoreError("optimizer run does not exist")
            return
        self.run_root.mkdir(parents=True, exist_ok=True, mode=0o700)
        os.chmod(self.run_root, 0o700)
        if not self.events_path.exists():
            fd = os.open(self.events_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            os.close(fd)
        os.chmod(self.events_path, 0o600)

    @contextlib.contextmanager
    def writer_lock(self) -> Iterator[None]:
        fd = os.open(self.lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX)
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    @contextlib.contextmanager
    def campaign_lock(self) -> Iterator[None]:
        fd = os.open(self.run_lock_path, os.O_RDWR | os.O_CREAT, 0o600)
        try:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise EventStoreError("another optimizer writer owns this run") from exc
            yield
        finally:
            fcntl.flock(fd, fcntl.LOCK_UN)
            os.close(fd)

    def _fsync_directory(self) -> None:
        fd = os.open(self.run_root, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)

    def read_all(self) -> list[dict]:
        events = []
        previous = None
        try:
            with self.events_path.open(encoding="utf-8") as fh:
                for number, line in enumerate(fh, 1):
                    try:
                        event = json.loads(line)
                    except json.JSONDecodeError as exc:
                        raise EventStoreError(f"invalid event log at line {number}: {exc.msg}") from exc
                    required = {"schema", "sequence", "operation_id", "type", "payload", "previous_sha256", "event_sha256"}
                    if not isinstance(event, dict) or set(event) != required or event["schema"] != SCHEMA:
                        raise EventStoreError(f"invalid event envelope at line {number}")
                    claimed = event["event_sha256"]
                    body = {key: value for key, value in event.items() if key != "event_sha256"}
                    if event["sequence"] != number or event["previous_sha256"] != previous or hashlib.sha256(_canonical(body)).hexdigest() != claimed:
                        raise EventStoreError(f"event chain mismatch at line {number}")
                    previous = claimed
                    events.append(event)
        except OSError as exc:
            raise EventStoreError(f"cannot read event log: {exc}") from exc
        return events

    def append(self, operation_id: str, event_type: str, payload: dict) -> dict:
        if not operation_id or not event_type or not isinstance(payload, dict):
            raise EventStoreError("event operation ID, type, and payload are required")
        with self.writer_lock():
            events = self.read_all()
            for event in events:
                if event["operation_id"] == operation_id:
                    if event["type"] == event_type and event["payload"] == payload:
                        return event
                    raise EventStoreError(f"operation ID collision: {operation_id}")
            body = {
                "schema": SCHEMA, "sequence": len(events) + 1, "operation_id": operation_id,
                "type": event_type, "payload": payload,
                "previous_sha256": events[-1]["event_sha256"] if events else None,
            }
            event = {**body, "event_sha256": hashlib.sha256(_canonical(body)).hexdigest()}
            with self.events_path.open("ab", buffering=0) as fh:
                fh.write(_canonical(event) + b"\n")
                os.fsync(fh.fileno())
            self.write_projections(self._project(events + [event]))
            return event

    def find(self, operation_id: str) -> dict | None:
        return next((event for event in self.read_all() if event["operation_id"] == operation_id), None)

    @staticmethod
    def _project(events: list[dict]) -> dict:
        state: dict = {"schema": "pi.optimizer-projection/v1", "event_count": len(events), "campaign": {}, "candidates": {}, "evaluations": {}, "sessions": {}, "calibrations": {}, "budget": {"provider_sessions": 0, "train_rollouts": 0, "development_rollouts": 0}, "status": "new"}
        for event in events:
            payload = event["payload"]
            if event["type"] == "campaign.prepared":
                state["campaign"] = payload
                state["status"] = "prepared"
            elif event["type"] == "campaign.approved":
                state["status"] = "running"
            elif event["type"] == "candidate.recorded":
                state["candidates"][payload["candidate_id"]] = payload
            elif event["type"] in ("candidate.verified", "candidate.training-decision"):
                candidate = state["candidates"].get(payload.get("candidate_id"))
                if candidate is not None:
                    candidate["verification" if event["type"] == "candidate.verified" else "training_decision"] = payload
            elif event["type"].startswith("evaluation."):
                state["evaluations"][event["operation_id"]] = payload
                evaluations = [payload] if event["type"] == "evaluation.recorded" else [payload.get("parent") or {}, payload.get("candidate") or {}]
                for evaluation in evaluations:
                    split = evaluation.get("split")
                    count = len(evaluation.get("observations") or [])
                    if split == "train": state["budget"]["train_rollouts"] += count
                    elif split == "development": state["budget"]["development_rollouts"] += count
            elif event["type"] == "provider.session":
                state["sessions"][event["operation_id"]] = payload
                state["budget"]["provider_sessions"] += 1
            elif event["type"] == "calibration.recorded":
                state["calibrations"][event["operation_id"]] = payload
            elif event["type"] == "campaign.completed":
                state["status"] = "complete"
                state["result"] = payload
            elif event["type"] == "campaign.stopped":
                state["status"] = payload.get("status", "stopped")
                state["result"] = payload
        return state

    def project(self) -> dict:
        return self._project(self.read_all())

    def write_projections(self, projection: dict) -> None:
        for name, value in (("snapshot.json", projection), ("candidate-graph.json", {"schema": "pi.optimizer-candidate-graph/v1", "candidates": projection["candidates"]}), ("metrics.json", {"schema": "pi.optimizer-metrics/v1", "evaluations": projection["evaluations"]}), ("budget.json", {"schema": "pi.optimizer-budget/v1", **projection["budget"]})):
            fd, temporary = tempfile.mkstemp(prefix=f".{name}.", dir=self.run_root)
            try:
                os.fchmod(fd, 0o600)
                with os.fdopen(fd, "wb") as fh:
                    fh.write(_canonical(value) + b"\n")
                    fh.flush()
                    os.fsync(fh.fileno())
                os.replace(temporary, self.run_root / name)
                os.chmod(self.run_root / name, 0o600)
                self._fsync_directory()
            except Exception:
                try:
                    os.unlink(temporary)
                except OSError:
                    pass
                raise
