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
`image_url` request. Cache-hit cases made no provider request. The canonical
rerun used `temperature=0`, `reasoning_format=none`, and `max_tokens=512` so a
complete final answer could be scored. `answer_supported` means the final
answer described the frozen near-black pixel oracle (`black`, `dark`, `blank`,
or `empty`); this is deliberately a narrow transport oracle, not a UI-quality
claim.

| arm | image deliveries | cache hits | missed required changes | stale-target refusals | model calls | answer present | answer supported | required-claim coverage | grounding | prompt tokens | completion tokens | total tokens | model latency (ms) | wall (ms) | client peak RSS | server memory |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| uncached | 5 | 0 | 0 | 0 | 5 | 5/5 | 5/5 | 5/5 | not run | 228 | 1,565 | 1,793 | 122,311.21 | 122,315.59 | 58,032,128 | unavailable (router metrics disabled) |
| exact-cache | 4 | 1 | 0 | 0 | 4 | 4/4 | 4/4 | 4/4 | not run | 183 | 1,269 | 1,452 | 99,431.67 | 99,433.08 | 56,950,784 | unavailable (router metrics disabled) |
| near-cache | 2 | 3 | 2 | 1 | 2 | 2/2 | 2/2 | 2/2 | not run | 90 | 479 | 569 | 37,737.52 | 37,738.46 | 56,279,040 | unavailable (router metrics disabled) |
| SAM-assisted | 3 | 2 | 1 | 0 | 3 | 3/3 | 3/3 | 3/3 | 0 valid / 2 failed (not scored) | 137 | 991 | 1,128 | 67,181.04 | 98,117.38 | 52,559,872 | unavailable (router metrics disabled) |

The exact-cache arm behaved safely for the frozen repeated frame. The
near-cache arm demonstrates why perceptual reuse remains hint-only: it reused
two changed required cases and therefore recorded two missed changes; the
action case still forced a fresh delivery and produced one stale-target
refusal. No click or other UI action was issued.

## Live cancellation and recovery probe

One additional request on the same Qwen route and serving epoch was aborted
by the client after 250 ms. The abort completed at 257 ms with `AbortError`;
no response body was retained. A bounded recovery request was then admitted
and returned HTTP 200 with a non-empty choice after 27,071 ms. The probe
therefore demonstrates client-side cancellation followed by a successful fresh
request, but it cannot establish whether the router stopped the already-
dispatched server computation. The probe image is identified only by SHA-256
`01ead08826c19e5e6e14f0ff6f93111fcb42dc12b2a3a94f35a1626c1c41faee` and is not
pooled with the frozen-arm metrics.

## Exploratory real-image semantic and grounding probe

To verify that the adapters work beyond the one-pixel transport fixture, the
bundled `assets/pi-munchkin.png` was sent once to Qwen with the fixed question
“What object is held in the raised hand?”. The route returned HTTP 200 and a
non-empty answer containing `sword` in 18,738 ms (1,566 prompt tokens and 128
completion tokens). With a manually supplied sword-region hint, the isolated
SAM2.1 Tiny runner returned a valid mask in 23,918 ms with score `0.9686`,
bounding box `{x:791,y:53,width:268,height:712}`, and an interior candidate
point `{x:925,y:315}`. No action was issued. This is an exploratory transport
and adapter check, not grounding accuracy: the image has no preregistered
pixel mask or geometry oracle, so neither result is pooled with the frozen-arm
score.

## Interpretation and limits

Qwen accepted the multimodal transport and returned supported final
descriptions for every fresh call under the canonical rerun. The tiny frozen
frames are still transport/cache fixtures rather than a meaningful UI
benchmark. The 5/5, 4/4, 2/2, and 3/3 required-claim coverage values therefore
mean only that narrow pixel claim was present; they do not measure coverage of
general UI or research obligations, and the near-black oracle does not qualify
general answer quality or grounding accuracy. Client RSS is measured; the
router exposes no memory metrics endpoint. SAM grounding accuracy is not
measured because fabricating a segmenter result would invalidate the receipt.

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

The canonical four-arm run used the live local router with temperature `0`,
`reasoning_format=none`, bounded `max_tokens=512`, and one request per fresh
case. The SAM arm used the isolated runner and official checkpoint above. The
earlier 256-token pass is retained as diagnostic history but is superseded by
the complete-answer measurements in the table. No
mirror, deployment, source-default change, or adoption decision occurred.
