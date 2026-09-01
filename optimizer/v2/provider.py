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
    _FIELDS = {"endpoint_scheme", "endpoint_host", "endpoint_port", "model", "api_key_env", "allow_remote", "timeout_seconds", "max_output_tokens"}

    def __init__(self, config: dict):
        if not isinstance(config, dict) or set(config) != self._FIELDS:
            raise ValueError(f"openai-compatible provider config must contain exactly: {', '.join(sorted(self._FIELDS))}")
        host = "127.0.0.1" if config["endpoint_host"] == "loopback" else config["endpoint_host"]
        if config["endpoint_scheme"] not in ("http", "https") or not isinstance(host, str) or not host:
            raise ValueError("optimizer provider endpoint scheme or host is invalid")
        if not isinstance(config["endpoint_port"], int) or isinstance(config["endpoint_port"], bool) or not 1 <= config["endpoint_port"] <= 65535:
            raise ValueError("optimizer provider endpoint port is invalid")
        endpoint = f"{config['endpoint_scheme']}://{host}:{config['endpoint_port']}"
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
        if not isinstance(config["max_output_tokens"], int) or isinstance(config["max_output_tokens"], bool) or not 128 <= config["max_output_tokens"] <= 16384:
            raise ValueError("optimizer provider max_output_tokens must be within 128..16384")
        self.config = config
        self.endpoint = endpoint

    def session(self, kind: str, payload: dict, *, operation_id: str) -> dict:
        result_contracts = {
            "evolve": {
                "schema": "pi.optimizer-session/v2", "kind": "evolve",
                "strategy": "brief rationale", "action": "mutate|compose",
                "selected_parent_ids": ["one or two IDs from accepted_candidate_ids"],
            },
            "diagnose_patch": {
                "schema": "pi.optimizer-session/v2", "kind": "diagnose_patch",
                "root_cause_hypothesis": "specific causal diagnosis",
                "alternatives_considered": ["bounded alternative"], "target_surface": "one permitted family",
                "expected_exposure": "observable mechanism", "primary_metric": "declared metric name",
                "falsifier": "matched evidence that would refute the diagnosis",
                "rollback_condition": "hard stop condition",
                "mutation": {"family": "target_surface", "diff": "family-specific mutation text", "changed_units": ["exact changed units"]},
            },
            "reflect": {
                "schema": "pi.optimizer-session/v2", "kind": "reflect",
                "lesson": "bounded lesson", "stochasticity_check": "matched-cell assessment",
                "classification": payload.get("classification"),
            },
        }
        instruction = "Return exactly one JSON object matching output_contract; add no fields and use no markdown."
        if kind == "diagnose_patch" and "configuration" in payload.get("permitted_surface_families", []):
            instruction += " For configuration, mutation.diff is a JSON-encoded merge-patch object using only payload.surface_constraints.configuration_allowed_keys, changes at least one configuration_behavior_keys value, and changed_units are exactly config.<top-level-key> for every patched key."
        prompt = {
            "contract": "pi.optimizer-session/v2", "operation_id": operation_id,
            "operation": kind, "instruction": instruction,
            "output_contract": result_contracts.get(kind), "payload": payload,
        }
        body = json.dumps({
            "model": self.config["model"], "temperature": 0,
            "max_tokens": self.config["max_output_tokens"],
            "response_format": {"type": "json_object"},
            "messages": [{"role": "user", "content": json.dumps(prompt, sort_keys=True)}],
        }).encode()
        endpoint = self.endpoint.rstrip("/") + "/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if os.environ.get(self.config["api_key_env"]):
            headers["Authorization"] = "Bearer " + os.environ[self.config["api_key_env"]]
        request = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with urllib.request.urlopen(request, timeout=self.config["timeout_seconds"]) as response:
                encoded = response.read(1_048_577)
                if len(encoded) > 1_048_576:
                    raise ValueError("optimizer provider response exceeded 1 MiB")
                envelope = json.loads(encoded)
            content = envelope["choices"][0]["message"]["content"]
            value = json.loads(content)
        except Exception as exc:
            raise ValueError(f"optimizer provider session failed for {kind}") from exc
        if not isinstance(value, dict):
            raise ValueError("optimizer provider response is not an object")
        return value
