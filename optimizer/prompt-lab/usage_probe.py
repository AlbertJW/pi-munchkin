#!/usr/bin/env python3
"""Probe OpenAI-compatible streaming usage without exposing credentials."""
from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request


def parse_sse(payload: bytes) -> dict:
    usage = None
    for raw in payload.splitlines():
        line = raw.decode("utf-8", "replace")
        if not line.startswith("data:"):
            continue
        body = line[5:].strip()
        if body == "[DONE]":
            continue
        try:
            item = json.loads(body)
        except json.JSONDecodeError:
            continue
        candidate = item.get("usage")
        if isinstance(candidate, dict):
            usage = candidate
    if not usage:
        return {"supported": False, "reason": "no_usage_chunk"}
    input_tokens = usage.get("prompt_tokens", usage.get("input_tokens"))
    output_tokens = usage.get("completion_tokens", usage.get("output_tokens"))
    if not isinstance(input_tokens, int) or not isinstance(output_tokens, int):
        return {"supported": False, "reason": "malformed_usage_chunk"}
    return {"supported": True, "input_tokens": input_tokens, "output_tokens": output_tokens}


def probe(url: str, model: str, timeout: float = 30.0) -> dict:
    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": "Reply OK."}],
        "max_tokens": 1,
        "temperature": 0,
        "stream": True,
        "stream_options": {"include_usage": True},
    }).encode("utf-8")
    request = urllib.request.Request(url.rstrip("/") + "/v1/chat/completions", data=body,
                                     headers={"Content-Type": "application/json"})
    key = os.environ.get("LLAMA_API_KEY")
    if key:
        request.add_header("Authorization", f"Bearer {key}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return parse_sse(response.read())
    except urllib.error.HTTPError as exc:
        return {"supported": False, "reason": f"http_{exc.code}"}
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        return {"supported": False, "reason": type(exc).__name__.lower()}


def selftest() -> None:
    good = b'data: {"choices":[]}\n\ndata: {"usage":{"prompt_tokens":4,"completion_tokens":1}}\n\ndata: [DONE]\n'
    assert parse_sse(good) == {"supported": True, "input_tokens": 4, "output_tokens": 1}
    assert parse_sse(b'data: {"choices":[]}\n\ndata: [DONE]\n')["supported"] is False
    assert parse_sse(b'data: {"usage":{"prompt_tokens":"4"}}\n')["reason"] == "malformed_usage_chunk"
    print("usage_probe selftest: OK")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--url")
    parser.add_argument("--model")
    parser.add_argument("--timeout", type=float, default=30.0)
    parser.add_argument("--selftest", action="store_true")
    args = parser.parse_args()
    if args.selftest:
        selftest()
    elif not args.url or not args.model:
        parser.error("--url and --model are required")
    else:
        result = probe(args.url, args.model, args.timeout)
        print(json.dumps(result, sort_keys=True, separators=(",", ":")))
        raise SystemExit(0 if result.get("supported") else 1)
