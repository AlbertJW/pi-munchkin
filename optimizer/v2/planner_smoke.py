"""Bounded, hash-verified launcher for the dark planner mechanism screen.

This is deliberately separate from the campaign engine.  It is a measurement
fixture launcher, not a default Pi entry point: model execution is reachable
only through the explicit ``--run`` command.  The launcher verifies the exact
loaded agent surface before spawning Pi, captures only bounded byte counts, and
terminates the whole child process group on a wall-clock or output limit.
"""

from __future__ import annotations

import argparse
import json
import os
import pathlib
import selectors
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import IO, Iterable


BOUND_REASONS = {"output_cap", "wall_timeout"}


@dataclass(frozen=True)
class BoundedResult:
    exit_code: int | None
    reason: str
    elapsed_seconds: float
    stdout_bytes: int
    stderr_bytes: int

    def to_summary(self) -> dict[str, object]:
        """Return a payload-safe classification; never include stream contents."""
        return {
            "schema": "pi.planner-smoke/v1",
            "reason": self.reason,
            "exit_code": self.exit_code,
            "elapsed_seconds": round(self.elapsed_seconds, 3),
            "stdout_bytes": self.stdout_bytes,
            "stderr_bytes": self.stderr_bytes,
            "total_bytes": self.stdout_bytes + self.stderr_bytes,
        }


def classify_result(*, exit_code: int | None, reason: str | None) -> str:
    if reason in BOUND_REASONS:
        return reason
    return "completed" if exit_code == 0 else "failed"


def _terminate_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGTERM)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        process.wait(timeout=1.0)
        return
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(os.getpgid(process.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError):
        pass
    try:
        process.wait(timeout=2.0)
    except subprocess.TimeoutExpired:
        # A process outside the group would be an infrastructure failure, but
        # returning a bounded classification is safer than waiting forever.
        pass


def _open_private(path: pathlib.Path) -> IO[bytes]:
    path = path.expanduser()
    if path.is_symlink():
        raise ValueError(f"output path must not be a symlink: {path}")
    path.parent.mkdir(parents=True, exist_ok=True)
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    if hasattr(os, "O_NOFOLLOW"):
        flags |= os.O_NOFOLLOW
    fd = os.open(path, flags, 0o600)
    return os.fdopen(fd, "wb", buffering=0)


def run_bounded_command(
    command: Iterable[str],
    *,
    cwd: pathlib.Path,
    wall_seconds: float,
    max_output_bytes: int,
    env: dict[str, str] | None = None,
    stdout_path: pathlib.Path | None = None,
    stderr_path: pathlib.Path | None = None,
) -> BoundedResult:
    """Run one command with a shared stdout/stderr cap and process-group wall.

    Streams are copied only when an explicit private path is supplied.  The
    default (used by self-tests) discards bytes after counting them, so a
    result summary can never accidentally carry model output.
    """
    if not cwd.is_dir() or cwd.is_symlink():
        raise ValueError("planner smoke cwd must be a real directory")
    if not isinstance(wall_seconds, (int, float)) or isinstance(wall_seconds, bool) or wall_seconds <= 0:
        raise ValueError("wall_seconds must be positive")
    if not isinstance(max_output_bytes, int) or isinstance(max_output_bytes, bool) or max_output_bytes < 1:
        raise ValueError("max_output_bytes must be a positive integer")

    process = subprocess.Popen(
        list(command), cwd=str(cwd), env=env, stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True,
    )
    files: dict[str, IO[bytes]] = {}
    if stdout_path is not None:
        files["stdout"] = _open_private(stdout_path)
    if stderr_path is not None:
        files["stderr"] = _open_private(stderr_path)

    selector = selectors.DefaultSelector()
    assert process.stdout is not None and process.stderr is not None
    selector.register(process.stdout, selectors.EVENT_READ, "stdout")
    selector.register(process.stderr, selectors.EVENT_READ, "stderr")
    counts = {"stdout": 0, "stderr": 0}
    total = 0
    reason: str | None = None
    started = time.monotonic()

    try:
        while selector.get_map():
            remaining_time = wall_seconds - (time.monotonic() - started)
            if remaining_time <= 0 and process.poll() is None:
                reason = "wall_timeout"
                _terminate_group(process)
                break
            events = selector.select(max(0.0, remaining_time))
            if not events:
                if process.poll() is None:
                    reason = "wall_timeout"
                    _terminate_group(process)
                    break
                continue
            for key, _mask in events:
                stream = key.data
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj)
                    continue
                allowed = min(len(chunk), max_output_bytes - total)
                if allowed:
                    if stream in files:
                        files[stream].write(chunk[:allowed])
                    counts[stream] += allowed
                    total += allowed
                if allowed < len(chunk) or (total >= max_output_bytes and process.poll() is None):
                    reason = "output_cap"
                    _terminate_group(process)
                    break
            if reason is not None:
                break
    finally:
        selector.close()
        for stream in files.values():
            try:
                stream.flush()
            finally:
                stream.close()
        # Selector unregistering does not close the Popen pipe wrappers. Close
        # both ends explicitly, including the early-bound path, so selftests and
        # callers do not accumulate descriptors across repeated screens.
        process.stdout.close()
        process.stderr.close()

    if process.poll() is None:
        try:
            process.wait(timeout=2.0)
        except subprocess.TimeoutExpired:
            _terminate_group(process)
    elapsed = time.monotonic() - started
    return BoundedResult(
        exit_code=process.returncode,
        reason=classify_result(exit_code=process.returncode, reason=reason),
        elapsed_seconds=elapsed,
        stdout_bytes=counts["stdout"],
        stderr_bytes=counts["stderr"],
    )


def resolve_surface_hash(agent_dir: pathlib.Path, *, node_bin: str = "node") -> str:
    """Resolve the loaded-surface digest without launching Pi."""
    if not agent_dir.is_dir() or agent_dir.is_symlink():
        raise ValueError("agent_dir must be a real directory")
    root = pathlib.Path(__file__).resolve().parents[2]
    script = root / "harness" / "scripts" / "surface-hash.ts"
    completed = subprocess.run(
        [node_bin, "--experimental-strip-types", str(script), str(agent_dir)],
        cwd=str(root), stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=30,
    )
    if completed.returncode:
        raise ValueError("surface hash resolution failed")
    digest = completed.stdout.strip().splitlines()[-1] if completed.stdout.strip() else ""
    if len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise ValueError("surface hash resolution returned an invalid digest")
    return digest


def _validate_run_inputs(args: argparse.Namespace) -> tuple[pathlib.Path, pathlib.Path, pathlib.Path]:
    agent_dir = pathlib.Path(args.agent_dir).expanduser().resolve()
    project_dir = pathlib.Path(args.project_dir).expanduser().resolve()
    prompt_file = pathlib.Path(args.prompt_file).expanduser().resolve()
    if not agent_dir.is_dir() or agent_dir.is_symlink():
        raise ValueError("--agent-dir must resolve to a real directory")
    if not project_dir.is_dir() or project_dir.is_symlink():
        raise ValueError("--project-dir must resolve to a real directory")
    if not prompt_file.is_file() or prompt_file.is_symlink():
        raise ValueError("--prompt-file must resolve to a regular file")
    expected = args.expected_surface
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise ValueError("--expected-surface must be a lowercase SHA-256 digest")
    if not args.model or any(char in args.model for char in "\r\n"):
        raise ValueError("--model must be a non-empty single-line identifier")
    return agent_dir, project_dir, prompt_file


def run_planner(args: argparse.Namespace) -> dict[str, object]:
    agent_dir, project_dir, prompt_file = _validate_run_inputs(args)
    actual = resolve_surface_hash(agent_dir, node_bin=args.node_bin)
    if actual != args.expected_surface:
        raise ValueError("loaded surface hash does not match --expected-surface")
    prompt = prompt_file.read_text(encoding="utf-8")
    if not prompt.strip():
        raise ValueError("--prompt-file must not be empty")

    output_path = pathlib.Path(args.output).expanduser().resolve()
    stderr_path = pathlib.Path(args.stderr).expanduser().resolve()
    telemetry_path = pathlib.Path(args.telemetry).expanduser().resolve()
    env = os.environ.copy()
    env.update({
        "PI_CODING_AGENT_DIR": str(agent_dir),
        "HARNESS_SURFACE_SHA256": args.expected_surface,
        "PLAN_GRAPH": "on", "DEEP_RESEARCH_PLANNING": "on", "RESEARCH_LEDGER": "on",
        "PLAN_STORAGE": "project", "FORCE_PLAN_WRITE": "on",
        "MUNCHKIN_TOOL_PROFILE": "ambient", "MUNCHKIN_TOOL_ACTIVATION": "ambient",
        "TELEMETRY": "on", "TELEMETRY_SOURCE": "interactive", "TELEMETRY_WRITER": "sync",
        "TELEMETRY_FILE": str(telemetry_path), "LOOP_EPISODE_MODE": "shadow",
    })
    command = [
        args.pi_bin, "-p", "--approve", "--no-session", "--mode", "json",
        "--model", args.model, prompt,
    ]
    result = run_bounded_command(
        command, cwd=project_dir, wall_seconds=args.wall_seconds,
        max_output_bytes=args.max_output_bytes, env=env,
        stdout_path=output_path, stderr_path=stderr_path,
    )
    summary = result.to_summary()
    summary.update({"surface_sha256": actual, "model": args.model})
    return summary


def selftest() -> None:
    root = pathlib.Path.cwd()
    cap = run_bounded_command(
        [sys.executable, "-c", "import sys; sys.stdout.write('x' * 100000); sys.stdout.flush()"],
        cwd=root, wall_seconds=5, max_output_bytes=4096,
    )
    assert cap.reason == "output_cap" and cap.stdout_bytes + cap.stderr_bytes <= 4096
    timeout = run_bounded_command(
        [sys.executable, "-c", "import time; print('private', flush=True); time.sleep(10)"],
        cwd=root, wall_seconds=0.2, max_output_bytes=4096,
    )
    assert timeout.reason == "wall_timeout" and timeout.stdout_bytes + timeout.stderr_bytes <= 4096
    assert "private" not in json.dumps(timeout.to_summary())
    print("planner_smoke selftest: OK (surface gate, output cap, process-group timeout, payload-free summary)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python3 -m optimizer.v2.planner_smoke")
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument("--selftest", action="store_true")
    modes.add_argument("--dry", action="store_true")
    modes.add_argument("--run", action="store_true")
    parser.add_argument("--agent-dir")
    parser.add_argument("--project-dir")
    parser.add_argument("--prompt-file")
    parser.add_argument("--expected-surface")
    parser.add_argument("--model")
    parser.add_argument("--output")
    parser.add_argument("--stderr")
    parser.add_argument("--telemetry")
    parser.add_argument("--pi-bin", default="pi")
    parser.add_argument("--node-bin", default="node")
    parser.add_argument("--wall-seconds", type=float, default=180.0)
    parser.add_argument("--max-output-bytes", type=int, default=350_000)
    args = parser.parse_args(argv)
    try:
        if args.selftest:
            selftest()
            return 0
        required = ("agent_dir", "project_dir", "prompt_file", "expected_surface", "model")
        if any(not getattr(args, field) for field in required):
            raise ValueError("--dry/--run require --agent-dir, --project-dir, --prompt-file, --expected-surface, and --model")
        if args.dry:
            agent_dir, project_dir, prompt_file = _validate_run_inputs(args)
            actual = resolve_surface_hash(agent_dir, node_bin=args.node_bin)
            if actual != args.expected_surface:
                raise ValueError("loaded surface hash does not match --expected-surface")
            print(json.dumps({
                "schema": "pi.planner-smoke/v1", "execution": False,
                "surface_sha256": actual, "model": args.model,
                "project_dir_present": project_dir.is_dir(), "prompt_bytes": prompt_file.stat().st_size,
                "wall_seconds": args.wall_seconds, "max_output_bytes": args.max_output_bytes,
            }, sort_keys=True))
            return 0
        for field in ("output", "stderr", "telemetry"):
            if not getattr(args, field):
                raise ValueError(f"--run requires --{field}")
        print(json.dumps(run_planner(args), sort_keys=True))
        return 0
    except (OSError, ValueError, subprocess.SubprocessError) as exc:
        print(f"planner-smoke: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
