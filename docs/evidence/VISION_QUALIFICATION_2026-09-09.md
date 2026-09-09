# Vision qualification packet — 2026-09-09

## Scope

This packet records the offline qualification of the vision boundary added in
`e06b173`, plus the local capture and SAM runner contracts added afterward. It
does not claim model-quality results. `VISION=off` remains the default,
`VISION_GROUNDING=sam` is opt-in, and no desktop capture, model inference,
weights download, mirror, deployment, or automatic click was performed.

## Frozen benchmark

The immutable fixture is
`harness/tests/fixtures/vision-contract-v1.json` (revision
`2026-09-09-frozen-1`). Its prepared manifest digest is
`35ec5d9e3ccc6dad72d687d7eae10f1cd992c90af0f61035b8b86fc525a4f05a`.
Run `npm run vision:benchmark -- --selftest` to validate it, `--dry` to print
the digest without executing anything, or use `--run --approve-sha <digest>
--model <registered-model>` for the explicit deterministic fixture run. The
fixture names Ling as the protocol role and Qwen 35B as the separate quality
role; it never turns a fixture result into efficacy evidence.

The Ling-role deterministic run produced the following orchestration result:

| arm | image deliveries | cache hits | missed changes | model calls | context tokens | grounding | unsafe actions blocked |
| --- | ---: | ---: | ---: | ---: | ---: | --- | ---: |
| uncached | 5 | 0 | 0 | 5 | 1,280 | not measured | 0 |
| exact cache | 4 | 1 | 0 | 4 | 1,024 | not measured | 0 |
| near cache | 2 | 3 | 2 | 2 | 512 | not measured | 1 |
| SAM-assisted | 3 | 2 | 1 | 3 | 768 | 2/2 fixture geometry | 0 |

These are fake-scenario transport/cache measurements, not Ling inference.
Latency and heap readings are diagnostic only. The important safety result is
that exact reuse is safe for unchanged frames, perceptual reuse is explicitly
hint-only and exposes changed content, and stale target use is blocked.

## Implemented boundaries

`visual_observe` now accepts image paths and screen/browser adapters, records
capture time, dimensions, device scale, viewport, exact digest, and serving
epoch, and reserves context by a geometry-based estimate. The default local
adapter is macOS-only and invokes `/usr/sbin/screencapture` with a numeric
window ID, a timeout, a byte/pixel cap, cancellation, and no shell expansion.
Browser capture remains an attested adapter seam rather than an implicit URL
fetch.

The cache keeps only bounded, latest-frame references and ephemeral in-process
bytes needed by an optional segmenter. It is cleared at session start,
compaction, and model selection; it never writes screenshots, OCR, base64, or
paths to telemetry. Exact SHA-256 is identity; PNG pHash is only a near-match
hint. A fresh image is required after uncertainty or action-relevant changes.

`createSam2TinyAdapter` defines a local JSON protocol for a separately
installed SAM 2.1 Tiny runner. It sends one bounded image to the explicitly
configured executable, validates the returned segmenter/version, mask digest,
box, and interior point, and propagates cancellation. The adapter cannot
authorize a click: `click_safe` is always null and action code must perform a
fresh observation and independent target validation.

## Offline evidence

- 22 focused visual/capture/SAM/benchmark tests pass, including a real scripted Pi
  `AgentSession` image block, cancellation, local-target validation, ephemeral
  frame cleanup, digest binding, geometry and adapter validation, and no-click
  authority.
- The complete harness suite passes 839/839; TypeScript typecheck and the
  195-file package smoke pass after this package.
- The benchmark passes `--selftest`, `--dry`, and explicit approval-hash
  validation. No network or inference is used by the benchmark.
- Package entries include the capture, SAM, benchmark, and fixture files.

## Remaining qualification work

The real quality screen is intentionally pending. A human must first install
or point to a local SAM 2.1 Tiny runner and a vision-capable model, then run
the identical frozen fixture separately for Ling (protocol qualification) and
Qwen 35B (quality). The screen should compare uncached, exact-cache,
near-cache, and SAM-assisted arms on answer support, missed UI changes,
grounding accuracy, stale-target refusals, context volume, latency, memory,
and model-call count. Results must be stored separately by model and serving
epoch, and only a human review may promote a dark surface.

Known limits are JPEG/GIF/WebP pHash decoding, provider-specific visual-token
counting, automatic post-action hooks, browser accessibility capture, and
persisted interpretation collection. These are deliberately deferred until
the first real screen shows they are needed.

## Rollback

Revert the vision commits and remove `visual-observe.ts`,
`visual-observation.ts`, `visual-grounding.ts`, `visual-capture.ts`,
`sam2-tiny.ts`, the benchmark/fixture/tests, package entries, and the
`vision` capability-family additions. Because the flags remain dark, this
rollback changes no live default or source-tree behavior.
