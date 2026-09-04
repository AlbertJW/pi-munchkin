#!/usr/bin/env python3
"""Deterministic metadata-only oracle for research mechanism fixtures.

It checks parent-validated citations against the fixture's declared source
families. It never reads answer prose, retrieves the network, or emits source
contents. The legacy shape payload remains accepted for old offline fixtures.
"""

from __future__ import annotations

import json
import sys
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse


def canonical_url(raw: str) -> str:
    """Normalize harmless URL presentation differences, never Jina wrappers."""
    parsed = urlparse(raw)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return raw
    host = parsed.hostname.lower() if parsed.hostname else ""
    port = parsed.port
    netloc = host
    if port is not None and not ((parsed.scheme == "http" and port == 80) or (parsed.scheme == "https" and port == 443)):
        netloc = f"{host}:{port}"
    path = parsed.path or "/"
    if path.endswith("/index.html"):
        path = path[:-len("index.html")]
    if path != "/" and path.endswith("/"):
        path = path.rstrip("/")
    query = urlencode(sorted(parse_qsl(parsed.query, keep_blank_values=True)))
    return urlunparse((parsed.scheme.lower(), netloc, path, "", query, ""))


def claim_citation(payload: dict) -> int:
    claims = payload.get("required_claims")
    families = payload.get("evidence_families")
    citations = payload.get("citations")
    if not isinstance(claims, list) or not isinstance(families, list) or not isinstance(citations, list):
        return 2
    family_urls = {
        str(family["id"]): {canonical_url(str(ref["url"])) for ref in family["source_refs"]}
        for family in families if isinstance(family, dict) and isinstance(family.get("source_refs"), list)
    }
    covered: set[str] = set()
    for citation in citations:
        if not isinstance(citation, dict):
            return 2
        claim_id, url = citation.get("claim_id"), citation.get("url")
        if not isinstance(claim_id, str) or not isinstance(url, str) or citation.get("parent_validated") is not True:
            continue
        parsed = urlparse(url)
        if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() == "r.jina.ai":
            continue
        for claim in claims:
            if isinstance(claim, dict) and claim.get("id") == claim_id and canonical_url(url) in family_urls.get(str(claim.get("evidence_family")), set()):
                covered.add(claim_id)
    required = {str(claim["id"]) for claim in claims if isinstance(claim, dict) and claim.get("required") is not False}
    result = {"schema": "pi.research-oracle/v2", "required": len(required), "covered": len(required & covered), "missing": sorted(required - covered)}
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0 if required <= covered else 1


def main() -> int:
    payload = json.load(sys.stdin)
    if "required_claims" in payload or "citations" in payload:
        return claim_citation(payload)
    families = payload.get("evidence_families", [])
    claims = payload.get("claims", [])
    if not isinstance(families, list) or not isinstance(claims, list):
        return 2
    if len(set(families)) != len(families) or len(set(claims)) != len(claims):
        return 1
    return 0 if families and claims else 1


if __name__ == "__main__":
    raise SystemExit(main())
