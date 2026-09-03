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
        self.projection_dirty_path = self.run_root / ".projections-dirty"
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

    def _read_bytes(self, *, allow_malformed_eof: bool = False) -> tuple[list[dict], dict | None]:
        events = []
        previous = None
        valid_offset = 0
        try:
            data = self.events_path.read_bytes()
            lines = data.splitlines(keepends=True)
            for number, line in enumerate(lines, 1):
                line_end = valid_offset + len(line)
                unterminated = number == len(lines) and bool(line) and not line.endswith(b"\n")
                try:
                    event = json.loads(line.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                    if allow_malformed_eof and number == len(lines):
                        suffix = data[valid_offset:]
                        return events, {"byte_count": len(suffix), "sha256": hashlib.sha256(suffix).hexdigest(), "offset": valid_offset}
                    message = getattr(exc, "msg", "invalid UTF-8")
                    raise EventStoreError(f"invalid event log at line {number}: {message}") from exc
                required = {"schema", "sequence", "operation_id", "type", "payload", "previous_sha256", "event_sha256"}
                if not isinstance(event, dict) or set(event) != required or event["schema"] != SCHEMA:
                    if allow_malformed_eof and number == len(lines):
                        suffix = data[valid_offset:]
                        return events, {"byte_count": len(suffix), "sha256": hashlib.sha256(suffix).hexdigest(), "offset": valid_offset}
                    raise EventStoreError(f"invalid event envelope at line {number}")
                claimed = event["event_sha256"]
                body = {key: value for key, value in event.items() if key != "event_sha256"}
                if event["sequence"] != number or event["previous_sha256"] != previous or hashlib.sha256(_canonical(body)).hexdigest() != claimed:
                    if allow_malformed_eof and number == len(lines):
                        suffix = data[valid_offset:]
                        return events, {"byte_count": len(suffix), "sha256": hashlib.sha256(suffix).hexdigest(), "offset": valid_offset}
                    raise EventStoreError(f"event chain mismatch at line {number}")
                if unterminated:
                    suffix = data[valid_offset:]
                    if allow_malformed_eof:
                        return events, {
                            "byte_count": len(suffix), "sha256": hashlib.sha256(suffix).hexdigest(),
                            "offset": valid_offset, "repairable": True,
                        }
                    raise EventStoreError(f"unterminated event at line {number}")
                previous = claimed
                events.append(event)
                valid_offset = line_end
        except OSError as exc:
            raise EventStoreError(f"cannot read event log: {exc}") from exc
        return events, None

    def read_all(self) -> list[dict]:
        events, _ = self._read_bytes()
        return events

    def read_with_recovery(self) -> tuple[list[dict], dict | None]:
        """Read valid events and report (but never mutate) a malformed final suffix."""
        return self._read_bytes(allow_malformed_eof=True)

    def recover_tail(self) -> dict | None:
        """Recover the EOF tail while holding the run's campaign lock."""
        with self.campaign_lock():
            return self._recover_tail_locked()

    def _recover_tail_locked(self) -> dict | None:
        """Repair a complete unterminated event or discard a malformed suffix.

        Callers must hold ``campaign_lock`` so truncation/repair and the
        hash-bound recovery event form one exclusive recovery transaction.
        """
        tail = None
        with self.writer_lock():
            events, tail = self.read_with_recovery()
            if tail is None:
                return None
            if tail.get("repairable"):
                with self.events_path.open("ab", buffering=0) as fh:
                    fh.write(b"\n")
                    os.fsync(fh.fileno())
            else:
                with self.events_path.open("r+b") as fh:
                    fh.truncate(tail["offset"])
                    fh.flush(); os.fsync(fh.fileno())
            self._fsync_directory()
        digest = tail["sha256"]
        return self.append(
            f"event-store:tail-recovered:{digest}", "event-store.tail-recovered",
            {"byte_count": tail["byte_count"], "sha256": digest},
        )

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
            try:
                self.write_projections(self._project(events + [event]))
                self.projection_dirty_path.unlink(missing_ok=True)
            except Exception:
                self.projection_dirty_path.write_text("dirty\n", encoding="utf-8")
                os.chmod(self.projection_dirty_path, 0o600)
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
        projection = self._project(self.read_all())
        if self.projection_dirty_path.exists():
            try:
                self.write_projections(projection)
                self.projection_dirty_path.unlink(missing_ok=True)
            except Exception:
                pass
        return projection

    def project_with_recovery(self) -> tuple[dict, dict | None]:
        events, tail = self.read_with_recovery()
        return self._project(events), tail

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
