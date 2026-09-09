# Qwen 35B vision qualification receipt — 2026-09-09

## Scope and provenance

This is the first explicit live screen for the router's
`local-llamacpp/qwen36-35b-iq3s-vision` quality role. It uses the frozen
`pi.vision-contract/v1` manifest revision `2026-09-09-qwen-vision-1` with
fixture SHA-256
`f6f93cf6cce89b81a2ce128b8cc69469f3dc6ad9d16c35424a81ab1e6b5f954a`.

The serving probe reported `n_ctx=49152`, modalities `vision=true,
video=true,
audio=false`, and model alias `qwen36-35b-iq3s-vision`. The normalized local
endpoint is represented only by SHA-256
`75a5be964d6e0f344c4bd3cf366443183784a28430c4a2e7ee101ef94fdad83e`.
The resulting serving epoch SHA-256 is
`a28ad1394c70f87fb708ddbc014ae389901590ba96395f047a18e9d030e4c601`.
No raw endpoint, image bytes, or model response text is retained here.

## Live arm results

Each fresh delivery was sent to the loaded Qwen route as a multimodal
`image_url` request. Cache-hit cases made no provider request. `answer_present`
means the provider returned non-empty final answer text; it is not a semantic
correctness score because this frozen transport fixture has no answer oracle.

| arm | image deliveries | cache hits | missed required changes | stale-target refusals | model calls | answer present | grounding | prompt tokens | completion tokens | total tokens | model latency (ms) | wall (ms) | client peak RSS | server memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| uncached | 5 | 0 | 0 | 0 | 5 | 2/5 | not run | 278 | 1,155 | 1,433 | 78,961.62 | 78,964.31 | 88,768,512 | unavailable (router metrics disabled) |
| exact-cache | 4 | 1 | 0 | 0 | 4 | 1/4 | not run | 223 | 943 | 1,166 | 64,369.75 | 64,371.78 | 64,028,672 | unavailable (router metrics disabled) |
| near-cache | 2 | 3 | 2 | 1 | 2 | 0/2 | not run | 110 | 512 | 622 | 34,856.53 | 34,858.86 | 57,573,376 | unavailable (router metrics disabled) |
| SAM-assisted | 3 | 2 | 1 | 0 | 3 | 2/3 | 0 valid / 2 failed (not scored) | 125 | 664 | 789 | 57,091.11 | 57,093 (approx.) | 42,909,696 | unavailable (router metrics disabled) |

The exact-cache arm behaved safely for the frozen repeated frame. The
near-cache arm demonstrates why perceptual reuse remains hint-only: it reused
two changed required cases and therefore recorded two missed changes; the
action case still forced a fresh delivery and produced one stale-target
refusal. No click or other UI action was issued.

## Interpretation and limits

Qwen accepted the multimodal transport and returned image-grounded reasoning;
the earlier Pi `AgentSession` smoke on the repository image also produced a
specific visual description. The tiny frozen frames are transport/cache
fixtures rather than a meaningful UI benchmark, and their manifest contains
no semantic answer oracle, so this receipt does not qualify answer quality or
grounding accuracy. Client RSS is measured; the router exposes no memory
metrics endpoint. SAM grounding accuracy is not measured because fabricating
a segmenter result would invalidate the receipt.

As a separate, non-arm semantic smoke, `pi -p` sent
`assets/pi-munchkin.png` through the same Qwen vision route and received a
non-empty final description identifying the cartoon fantasy warrior, sword,
and potion. That confirms usable image understanding at the transport level,
but it is not pooled with the frozen-arm measurements because it has no
preregistered answer or geometry oracle.

The screen is therefore **protocol-valid but not promotion-ready**. Keep
`VISION=off` and `VISION_GROUNDING=sam` dark. A real SAM2.1 Tiny Hiera-Tiny
runner (`sam2==1.1.0`, checkpoint SHA-256
`7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`) was
used from an isolated temporary environment. Both target cases produced no
valid mask, so the receipt records two grounding failures and deliberately
does not claim a grounding accuracy score. A follow-up quality pack still
needs real screenshot cases with answer and geometry oracles. Ling remains a
protocol-only cohort and must not be pooled with this result.

## Reproduction boundary

The three executable arms were run once against the live local router with
temperature `0`, bounded `max_tokens=256`, and one request per fresh case.
The SAM arm used the isolated runner and official checkpoint above. No
mirror, deployment, source-default change, or adoption decision occurred.
