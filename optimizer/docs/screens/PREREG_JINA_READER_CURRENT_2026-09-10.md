# Preregistration: current Jina Reader extraction screen (2026-09-10)

## Scope

This is a retrieval-only comparison for dark `JINA_READER=on`, not a model
quality, search, or adoption screen. It uses the same fixed two public sources
in direct-Ketch and static-Reader-wrapped arms, in that order for each reader.
The pages are the public Jina Reader repository README and RFC 2606. Ketch
performs all extraction using the same 4,000-character cap and 30-second
per-read deadline used by both arms.

## Identity and safe metrics

The manifest lists source URLs publicly; the durable artifact contains only
their SHA-256 identities, page-content digests, sizes, required-term coverage,
process outcome, and elapsed time. It never stores page text, request bodies,
headers, credentials, or model output. A Reader result counts only if its
returned wrapper URL unwraps exactly to the requested original URL; the
original remains the citation identity.

For each source, the screen measures successful non-empty extraction, source
identity match, capped-content length, and coverage of frozen terms. The
comparison records aggregate coverage and elapsed time. A clean mechanism/
utility observation requires all four reads to succeed with source identity
preserved and Jina's total required-term coverage to be at least direct
Ketch's. It does not preregister an adoption threshold: extraction markers and
latency alone cannot prove end-to-end research-answer quality.

The maximum is exactly four network reads. Any failure is recorded once and
this manifest is not retried. The screen runs no task model, does not modify
the live harness, and cannot change defaults, mirror state, or deployment.

The frozen manifest SHA-256 is
`34052d38c1c7cba4ec1ae7a4d945ea6d04c47ea8b5d699f53f690074e6661eeb`; the
run must use approval SHA-256
`05403a73dc797b7d5447813c06d56fd04e4b0b20bd184bdc0303982fc4580ed7`, which
also binds the probe, Ketch runtime, and Ketch extension source digests.
