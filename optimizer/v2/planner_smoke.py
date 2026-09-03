"""Bounded, hash-verified launcher for the dark planner mechanism screen.

This is deliberately separate from the campaign engine.  It is a measurement
fixture launcher, not a default Pi entry point: model execution is reachable
only through the explicit ``--run`` command.  The launcher verifies the exact
loaded agent surface before spawning Pi, captures only bounded byte counts, and
terminates the whole child process group on a wall-clock or output limit.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import pathlib
import re
import selectors
import signal
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import IO, Any, Iterable


BOUND_REASONS = {"output_cap", "wall_timeout"}
THINKING_RE = re.compile(r"^[A-Za-z0-9_-]{1,32}$")
HEX64_RE = re.compile(r"^[0-9a-f]{64}$")
REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FIXTURE_ROOT = REPO_ROOT / "optimizer/research-fixtures/manifests"

# The screen has two deliberately explicit arms. Keeping this map here makes
# the launcher unable to inherit a stale graph lease or silently run the
# control with candidate flags. The digests bind the executable arm to the
# exact preregistered config bytes before Pi is started.
ARM_SPECS: dict[str, dict[str, object]] = {
    "candidate": {
        "config_path": REPO_ROOT / "optimizer/prompt-lab/configs/pending/deep-research-planning.json",
        "config_sha256": "0d01aab9292db845b5f228174e2a1a4c10328883daebd482dcd9c9c9f5f5fd1e",
        "flags": {"RESEARCH_LEDGER": "on", "PLAN_GRAPH": "on", "DEEP_RESEARCH_PLANNING": "on"},
        "headless_plan": True,
    },
    "control": {
        "config_path": REPO_ROOT / "optimizer/prompt-lab/configs/pending/deep-research-planning-control.json",
        "config_sha256": "a2e5efef3ab36d90ab58ee91920b766e5c7a162905da970778e9439c3c1c92f7",
        "flags": {"RESEARCH_LEDGER": "on", "PLAN_GRAPH": "off", "DEEP_RESEARCH_PLANNING": "off"},
        "headless_plan": False,
    },
}


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


def _sha256_file(path: pathlib.Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _load_fixture_admission() -> Any:
    """Load the repository admission rules without importing a package at runtime."""
    path = REPO_ROOT / "optimizer/research-fixtures/admission.py"
    spec = importlib.util.spec_from_file_location("planner_fixture_admission", path)
    if spec is None or spec.loader is None:
        raise ValueError("fixture admission rules are unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture_spec(
    path: pathlib.Path, *, expected_sha256: str, negative_control: bool = False,
) -> dict[str, str]:
    """Validate one admitted fixture and return only its bounded prompt metadata.

    The digest is the admission module's canonical JSON digest, not a mutable
    workspace or formatting-dependent byte hash. Restricting paths to the
    checked-in manifest directory prevents a caller from presenting an
    unrelated structurally-valid fixture as a preregistered case.
    """
    raw_path = pathlib.Path(path).expanduser()
    if raw_path.is_symlink():
        raise ValueError("fixture manifest must not be a symlink")
    resolved = raw_path.resolve()
    if resolved.parent != FIXTURE_ROOT.resolve() or not resolved.is_file():
        raise ValueError("fixture manifest must be a regular file in the admitted slate")
    if not HEX64_RE.fullmatch(expected_sha256):
        raise ValueError("expected fixture digest must be a lowercase SHA-256")
    admission = _load_fixture_admission()
    try:
        obj, actual_sha256 = admission.load_manifest(resolved)
    except Exception as exc:
        raise ValueError("fixture manifest failed admission") from exc
    if actual_sha256 != expected_sha256:
        raise ValueError("fixture manifest digest does not match the preregistration")
    prompt = obj.get("prompt")
    negative = obj.get("negative_control")
    if not isinstance(prompt, dict) or not isinstance(prompt.get("text"), str):
        raise ValueError("fixture manifest has no admitted prompt")
    if not isinstance(negative, dict) or not isinstance(negative.get("text"), str):
        raise ValueError("fixture manifest has no admitted negative control")
    return {
        "fixture_id": str(obj["fixture_id"]),
        "kind": str(obj["kind"]),
        "fixture_sha256": actual_sha256,
        "fixture_role": "negative_control" if negative_control else "primary",
        "prompt": negative["text"] if negative_control else prompt["text"],
    }


def arm_spec(arm: str) -> dict[str, object]:
    """Return a defensive copy of a preregistered planner-screen arm."""
    if arm not in ARM_SPECS:
        raise ValueError("arm must be candidate or control")
    spec = ARM_SPECS[arm]
    path = spec["config_path"]
    expected = spec["config_sha256"]
    if not isinstance(path, pathlib.Path) or not isinstance(expected, str) or not HEX64_RE.fullmatch(expected):
        raise ValueError("planner arm has an invalid config binding")
    if not path.is_file() or path.is_symlink():
        raise ValueError(f"planner arm config is unavailable: {path}")
    actual = _sha256_file(path)
    if actual != expected:
        raise ValueError(f"planner arm config hash mismatch for {arm}")
    flags = spec["flags"]
    if not isinstance(flags, dict) or any(key not in {"RESEARCH_LEDGER", "PLAN_GRAPH", "DEEP_RESEARCH_PLANNING"} or value not in {"on", "off"} for key, value in flags.items()):
        raise ValueError("planner arm has invalid flags")
    return {"config_path": path, "config_sha256": expected, "flags": dict(flags), "headless_plan": bool(spec["headless_plan"])}


def build_planner_env(
    *, arm: str, agent_dir: pathlib.Path, expected_surface: str,
    telemetry_path: pathlib.Path, base_env: dict[str, str] | None = None,
) -> dict[str, str]:
    """Build an arm-pinned environment and clear inherited planner controls."""
    spec = arm_spec(arm)
    env = dict(os.environ if base_env is None else base_env)
    for key in ("RESEARCH_LEDGER", "PLAN_GRAPH", "DEEP_RESEARCH_PLANNING", "PI_MUNCHKIN_HEADLESS_PLAN"):
        env.pop(key, None)
    flags = spec["flags"]
    assert isinstance(flags, dict)
    env.update({
        "PI_CODING_AGENT_DIR": str(agent_dir),
        "HARNESS_SURFACE_SHA256": expected_surface,
        "RESEARCH_LEDGER": str(flags["RESEARCH_LEDGER"]),
        "PLAN_GRAPH": str(flags["PLAN_GRAPH"]),
        "DEEP_RESEARCH_PLANNING": str(flags["DEEP_RESEARCH_PLANNING"]),
        "PLAN_STORAGE": "project", "FORCE_PLAN_WRITE": "on",
        "MUNCHKIN_TOOL_PROFILE": "ambient", "MUNCHKIN_TOOL_ACTIVATION": "ambient",
        "TELEMETRY": "on", "TELEMETRY_SOURCE": "interactive", "TELEMETRY_WRITER": "sync",
        "TELEMETRY_FILE": str(telemetry_path), "LOOP_EPISODE_MODE": "shadow",
    })
    if bool(spec["headless_plan"]):
        env["PI_MUNCHKIN_HEADLESS_PLAN"] = "on"
    return env


def classify_result(*, exit_code: int | None, reason: str | None) -> str:
    if reason in BOUND_REASONS:
        return reason
    return "completed" if exit_code == 0 else "failed"


def build_pi_command(*, pi_bin: str, model: str, prompt: str, thinking: str | None = None) -> list[str]:
    """Build the non-interactive Pi command with an optional explicit thinking level."""
    command = [pi_bin, "-p", "--approve", "--no-session", "--mode", "json", "--model", model]
    if thinking is not None:
        command.extend(["--thinking", thinking])
    command.append(prompt)
    return command


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
    root = REPO_ROOT
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


def _validate_run_inputs(
    args: argparse.Namespace,
) -> tuple[pathlib.Path, pathlib.Path, str, dict[str, object], dict[str, str] | None]:
    agent_dir = pathlib.Path(args.agent_dir).expanduser().resolve()
    project_dir = pathlib.Path(args.project_dir).expanduser().resolve()
    if not agent_dir.is_dir() or agent_dir.is_symlink():
        raise ValueError("--agent-dir must resolve to a real directory")
    if not project_dir.is_dir() or project_dir.is_symlink():
        raise ValueError("--project-dir must resolve to a real directory")
    prompt_file: pathlib.Path | None = None
    if args.prompt_file:
        raw_prompt_file = pathlib.Path(args.prompt_file).expanduser()
        if raw_prompt_file.is_symlink():
            raise ValueError("--prompt-file must not be a symlink")
        prompt_file = raw_prompt_file.resolve()
        if not prompt_file.is_file():
            raise ValueError("--prompt-file must resolve to a regular file")
    fixture: dict[str, str] | None = None
    fixture_manifest = getattr(args, "fixture_manifest", None)
    expected_fixture_sha256 = getattr(args, "expected_fixture_sha256", None)
    negative_control = bool(getattr(args, "negative_control", False))
    if fixture_manifest:
        if not expected_fixture_sha256:
            raise ValueError("--fixture-manifest requires --expected-fixture-sha256")
        fixture = fixture_spec(
            pathlib.Path(fixture_manifest), expected_sha256=expected_fixture_sha256,
            negative_control=negative_control,
        )
    elif expected_fixture_sha256:
        raise ValueError("--expected-fixture-sha256 requires --fixture-manifest")
    elif negative_control:
        raise ValueError("--negative-control requires --fixture-manifest")
    if prompt_file is None and fixture is None:
        raise ValueError("one of --prompt-file or --fixture-manifest is required")
    prompt = fixture["prompt"] if fixture is not None else prompt_file.read_text(encoding="utf-8")
    if prompt_file is not None:
        prompt_file_text = prompt_file.read_text(encoding="utf-8")
        if fixture is not None and prompt_file_text != prompt:
            raise ValueError("--prompt-file does not match the admitted fixture prompt")
        prompt = prompt_file_text
    expected = args.expected_surface
    if len(expected) != 64 or any(char not in "0123456789abcdef" for char in expected):
        raise ValueError("--expected-surface must be a lowercase SHA-256 digest")
    if not args.model or any(char in args.model for char in "\r\n"):
        raise ValueError("--model must be a non-empty single-line identifier")
    if args.thinking is not None and (not isinstance(args.thinking, str) or not THINKING_RE.fullmatch(args.thinking)):
        raise ValueError("--thinking must be a short single-line level")
    spec = arm_spec(args.arm)
    if not prompt.strip():
        raise ValueError("planner prompt must not be empty")
    return agent_dir, project_dir, prompt, spec, fixture


def run_planner(args: argparse.Namespace) -> dict[str, object]:
    agent_dir, project_dir, prompt, spec, fixture = _validate_run_inputs(args)
    actual = resolve_surface_hash(agent_dir, node_bin=args.node_bin)
    if actual != args.expected_surface:
        raise ValueError("loaded surface hash does not match --expected-surface")

    output_path = pathlib.Path(args.output).expanduser().resolve()
    stderr_path = pathlib.Path(args.stderr).expanduser().resolve()
    telemetry_path = pathlib.Path(args.telemetry).expanduser().resolve()
    env = build_planner_env(
        arm=args.arm, agent_dir=agent_dir, expected_surface=args.expected_surface,
        telemetry_path=telemetry_path,
    )
    command = build_pi_command(pi_bin=args.pi_bin, model=args.model, prompt=prompt, thinking=args.thinking)
    result = run_bounded_command(
        command, cwd=project_dir, wall_seconds=args.wall_seconds,
        max_output_bytes=args.max_output_bytes, env=env,
        stdout_path=output_path, stderr_path=stderr_path,
    )
    summary = result.to_summary()
    summary.update({"surface_sha256": actual, "model": args.model, "arm": args.arm, "config_sha256": spec["config_sha256"]})
    if fixture is not None:
        summary.update({
            "fixture_id": fixture["fixture_id"],
            "fixture_sha256": fixture["fixture_sha256"],
            "fixture_role": fixture["fixture_role"],
        })
    if args.thinking is not None:
        summary["thinking"] = args.thinking
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
    parser.add_argument("--fixture-manifest")
    parser.add_argument("--expected-fixture-sha256")
    parser.add_argument("--negative-control", action="store_true")
    parser.add_argument("--expected-surface")
    parser.add_argument("--model")
    parser.add_argument("--arm", choices=tuple(ARM_SPECS))
    parser.add_argument("--thinking")
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
        required = ("agent_dir", "project_dir", "expected_surface", "model", "arm")
        if any(not getattr(args, field) for field in required):
            raise ValueError("--dry/--run require --agent-dir, --project-dir, --expected-surface, --model, and --arm")
        if args.dry:
            agent_dir, project_dir, prompt, spec, fixture = _validate_run_inputs(args)
            actual = resolve_surface_hash(agent_dir, node_bin=args.node_bin)
            if actual != args.expected_surface:
                raise ValueError("loaded surface hash does not match --expected-surface")
            summary: dict[str, object] = {
                "schema": "pi.planner-smoke/v1", "execution": False,
                "surface_sha256": actual, "model": args.model,
                "arm": args.arm, "config_sha256": spec["config_sha256"], "flags": spec["flags"],
                "project_dir_present": project_dir.is_dir(), "prompt_bytes": len(prompt.encode("utf-8")),
                "wall_seconds": args.wall_seconds, "max_output_bytes": args.max_output_bytes,
            }
            if fixture is not None:
                summary.update({
                    "fixture_id": fixture["fixture_id"],
                    "fixture_sha256": fixture["fixture_sha256"],
                    "fixture_role": fixture["fixture_role"],
                })
            if args.thinking is not None:
                summary["thinking"] = args.thinking
            print(json.dumps(summary, sort_keys=True))
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
