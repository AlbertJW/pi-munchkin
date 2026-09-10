# Preregistration: LFM 2.5 VL 3B real-UI vision qualification V2 (2026-09-10)

## Why V2 exists

V1 produced a positive one-request diagnostic, but the former real-UI runner
did not include its own source digest in the approval input. That means V1 is
not authoritative under the harness provenance rule and is retained only as an
invalid diagnostic. V2 is a fresh one-request screen after a targeted
red-then-green repair that binds the probe source SHA-256 into preparation and
approval. It is not a retry of a failed semantic test.

## Frozen protocol

The fixture is `vision-real-ui-lfm25-vl-3b-v2.json`, bound to requested model
`local-llamacpp/lfm25-vl-3b` and served model `lfm25-vl-3b`. It renders the
fixed local 640-by-360 confirmation dialog and checks the renderer-reported
`Confirm` box `{x:360,y:214,width:120,height:40}` before model dispatch. The
single question requires final answer `GREEN`. The approval binds manifest,
fixture HTML, probe source, renderer identity, temporary screenshot digest,
geometry, and model identity.

There is exactly one temperature-zero request with a 128-token completion cap.
The sole acceptance rule is HTTP 200 plus a non-empty final answer matching
`GREEN`. No click, SAM, caching, comparison, default, mirror, or adoption
claim is permitted. The private result retains no raw image or model response.

## Interpretation

Success is a portable protocol/semantic receipt for this one 3B model and this
one fixture only. It cannot establish the usefulness or safe deployment of
vision, cache reuse, or grounding. Any outcome is recorded once; V2 may not be
extended or rerun to seek a preferred result.
