from __future__ import annotations

import json
import os
import pathlib
import urllib.parse
import urllib.request


class ArtifactProvider:
    """Provider-neutral handoff for externally produced, reviewed JSON sessions."""

    plugin_name = "artifact-json"

    def __init__(self, artifact_root: pathlib.Path):
        self.artifact_root = artifact_root.resolve()

    def session(self, kind: str, payload: dict, *, operation_id: str) -> dict:
        name = operation_id.replace(":", "__") + ".json"
        path = (self.artifact_root / name).resolve()
        if self.artifact_root not in path.parents:
            raise ValueError("provider artifact path escaped its root")
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"provider artifact is unavailable or invalid: {name}") from exc
        if not isinstance(value, dict):
            raise ValueError("provider artifact must be a JSON object")
        return value


class OpenAICompatibleProvider:
    """Small structured-session client for explicitly approved campaigns.

    Loopback endpoints are the default security boundary. Remote endpoints must
    be declared with ``allow_remote`` in the campaign manifest.
    """

    plugin_name = "openai-compatible"
    _FIELDS = {"endpoint", "model", "api_key_env", "allow_remote", "timeout_seconds"}

    def __init__(self, config: dict):
        if not isinstance(config, dict) or set(config) != self._FIELDS:
            raise ValueError(f"openai-compatible provider config must contain exactly: {', '.join(sorted(self._FIELDS))}")
        endpoint = config["endpoint"]
        parsed = urllib.parse.urlparse(endpoint)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("optimizer provider endpoint must be HTTP(S)")
        loopback = parsed.hostname in ("127.0.0.1", "::1", "localhost")
        if not loopback and config["allow_remote"] is not True:
            raise ValueError("remote optimizer provider requires allow_remote=true")
        if not isinstance(config["model"], str) or not config["model"]:
            raise ValueError("optimizer provider model is required")
        if not isinstance(config["api_key_env"], str) or not config["api_key_env"]:
            raise ValueError("optimizer provider api_key_env is required")
        if not isinstance(config["timeout_seconds"], int) or isinstance(config["timeout_seconds"], bool) or config["timeout_seconds"] < 1:
            raise ValueError("optimizer provider timeout_seconds must be positive")
        self.config = config

    def session(self, kind: str, payload: dict, *, operation_id: str) -> dict:
        prompt = {
            "contract": "pi.optimizer-session/v1", "operation_id": operation_id,
            "operation": kind, "instruction": "Return one JSON object only. Do not use markdown.",
            "payload": payload,
        }
        body = json.dumps({
            "model": self.config["model"], "temperature": 0,
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": json.dumps(prompt, sort_keys=True)}],
        }).encode()
        endpoint = self.config["endpoint"].rstrip("/") + "/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if os.environ.get(self.config["api_key_env"]):
            headers["Authorization"] = "Bearer " + os.environ[self.config["api_key_env"]]
        request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.config["timeout_seconds"]) as response:
                envelope = json.loads(response.read())
            content = envelope["choices"][0]["message"]["content"]
            value = json.loads(content)
        except Exception as exc:
            raise ValueError(f"optimizer provider session failed for {kind}") from exc
        if not isinstance(value, dict):
            raise ValueError("optimizer provider response is not an object")
        return value
