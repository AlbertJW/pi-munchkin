#!/usr/bin/env python3
"""macOS Seatbelt checks for real_gate open/endpoint profiles."""

import argparse
import http.server
import platform
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]


class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        body = b"mock-cloud-ok"
        self.send_response(200)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_):
        pass


def render(source, destination, work, harness, state, port, model_host="localhost", mirror=None):
    # state is the parent (stand-in for ~/.pi/agent): only its sessions/ and
    # telemetry/ children are write-allowed, mirroring real_gate.sh's render.
    text = source.read_text(encoding="utf-8")
    replacements = {
        "__WORKDIR__": str(work), "__HARNESS__": str(harness),
        "__PI_AGENT__": str(state),
        "__MIRROR__": str(mirror if mirror is not None else Path(state).parent / "mirror"),
        "__MODEL_HOST__": model_host, "__MODEL_PORT__": str(port),
    }
    for old, new in replacements.items():
        text = text.replace(old, new)
    destination.write_text(text, encoding="utf-8")


def run(profile, *command):
    return subprocess.run(["sandbox-exec", "-f", str(profile), *command], capture_output=True, text=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--remote-url", help="optional existing llama-compatible endpoint; probes /health only")
    args = parser.parse_args()
    if platform.system() != "Darwin" or not shutil.which("sandbox-exec"):
        print("seatbelt_network_selftest: SKIP (macOS sandbox-exec unavailable)")
        return
    open_source = ROOT / "real-gate-fixtures/gate-open.sb"
    endpoint_source = ROOT / "real-gate-fixtures/gate.sb"
    assert "(deny network*)" not in open_source.read_text()
    assert "(deny network*)" in endpoint_source.read_text()
    with tempfile.TemporaryDirectory(prefix=".pi-seatbelt-network-", dir=ROOT) as td:
        root = Path(td).resolve(); work = root / "work"; harness = root / "harness"; state = root / "state"
        mirror = root / "mirror"
        work.mkdir(); harness.mkdir(); state.mkdir(); mirror.mkdir()
        (state / "sessions").mkdir(); (state / "telemetry").mkdir()
        (harness / "secret").write_text("hidden")
        (mirror / "grader").write_text("hidden-grader-copy")
        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        port = server.server_address[1]
        open_profile = root / "open.sb"; endpoint_profile = root / "endpoint.sb"
        render(open_source, open_profile, work, harness, state, port)
        render(endpoint_source, endpoint_profile, work, harness, state, port)
        try:
            url = f"http://127.0.0.1:{port}/"
            assert run(open_profile, "/usr/bin/curl", "-fsS", url).stdout == "mock-cloud-ok"
            assert run(endpoint_profile, "/usr/bin/curl", "-fsS", url).stdout == "mock-cloud-ok"
            assert run(endpoint_profile, "/usr/bin/curl", "-fsS", "http://127.0.0.1:1/").returncode != 0
            assert run(open_profile, "/usr/bin/python3", "-c", "import socket; socket.getaddrinfo('localhost',80)").returncode == 0
            assert run(open_profile, "/bin/cat", str(harness / "secret")).returncode != 0
            assert run(open_profile, "/usr/bin/touch", str(root / "outside")).returncode != 0
            assert run(open_profile, "/usr/bin/touch", str(work / "inside")).returncode == 0
            # mirror read-deny: a public-mirror grader copy must be unreadable
            assert run(open_profile, "/bin/cat", str(mirror / "grader")).returncode != 0
            assert run(endpoint_profile, "/bin/cat", str(mirror / "grader")).returncode != 0
            # narrowed ~/.pi write-jail: sessions/ + telemetry/ + *.json.lock writable, parent NOT
            assert run(open_profile, "/usr/bin/touch", str(state / "sessions" / "s.jsonl")).returncode == 0
            assert run(open_profile, "/usr/bin/touch", str(state / "telemetry" / "events.jsonl")).returncode == 0
            assert run(open_profile, "/bin/mkdir", str(state / "settings.json.lock")).returncode == 0
            assert run(open_profile, "/usr/bin/touch", str(state / "settings.json")).returncode != 0
            assert run(endpoint_profile, "/usr/bin/touch", str(state / "debris.js")).returncode != 0
            if args.remote_url:
                parsed = urlsplit(args.remote_url)
                remote_port = parsed.port or (443 if parsed.scheme == "https" else 80)
                remote_profile = root / "remote-endpoint.sb"
                render(endpoint_source, remote_profile, work, harness, state, remote_port, "*")
                health_url = args.remote_url.rstrip("/") + "/health"
                assert run(open_profile, "/usr/bin/curl", "-fsS", "-m", "5", health_url).returncode == 0
                assert run(remote_profile, "/usr/bin/curl", "-fsS", "-m", "5", health_url).returncode == 0
        finally:
            server.shutdown(); server.server_close(); thread.join(timeout=2)
    suffix = " + remote endpoint" if args.remote_url else ""
    print(f"seatbelt_network_selftest: OK (open/mock-cloud/DNS + endpoint isolation + filesystem jail + mirror deny + narrowed pi-state{suffix})")


if __name__ == "__main__":
    main()
