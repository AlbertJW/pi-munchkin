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

## Preregistered semantic/geometry quality case

The dedicated quality manifest
`harness/tests/fixtures/vision-quality-qwen36-35b-vision-v1.json` was prepared
and committed before this run. Its approval SHA-256 is
`b43f60c6981708bbda67bca7f038beedf8883774c3941c0e68c9d82b3c2cfefe`; the
deterministic UI frame SHA-256 is
`5217a3bbe56bd9143b08001fb7f5c4354d5e605077f43595bd4c6e96dfc20c15`.
Against the same Qwen route, the right-button case returned HTTP 200, a
supported `BLUE` answer, and required-claim coverage `1/1` in 26,607 ms
(249 prompt, 350 completion, 599 total tokens). The real SAM2.1 Tiny runner,
using the preregistered point hint, returned a valid mask with model score
`0.9478` and box `{x:439,y:277,width:122,height:22}`. Its IoU against the
actionable-interior oracle `{x:440,y:278,width:120,height:20}` was `0.8942`,
with safe point `{x:449,y:287}`; no action was issued. This is one frozen
synthetic UI case and does not establish broad semantic or grounding
generalization.

The screen is therefore **protocol-valid but not promotion-ready**. Keep
`VISION=off` and `VISION_GROUNDING=sam` dark. A real SAM2.1 Tiny Hiera-Tiny
runner (`sam2==1.1.0`, checkpoint SHA-256
`7402e0d864fa82708a20fbd15bc84245c2f26dff0eb43a4b5b93452deb34be69`) was
used from an isolated temporary environment. Both target cases produced no
valid mask, so the receipt records two grounding failures and deliberately
does not claim a grounding accuracy score. A follow-up quality pack still
needs real screenshot cases with answer and geometry oracles. Ling remains a
protocol-only cohort and must not be pooled with this result. Separately, the
full harness suite verifies that delegated research evidence cannot settle a
parent branch until the parent rereads each source and records a validated
research note; that evidence-integrity check is independent of this vision
screen.

## Preregistered three-frame quality pack

To strengthen the single-case result without changing the runtime surface, a
second manifest was prepared before execution:
`harness/tests/fixtures/vision-quality-qwen36-35b-vision-v2.json`. Its
approval SHA-256 is
`c5213eac6179c8e53ae1e038715f4f3049f2da2341dc014c0964e06e9ac23b9d`, and it
contains three distinct deterministic frames with independent hashes and
actionable-interior oracles. The same Qwen route and isolated SAM runner were
used for every case.

| case | semantic result | required coverage | SAM IoU | SAM score | model latency (ms) | total tokens | client RSS |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| right-blue-button | supported `BLUE` | 1/1 | 0.8942 | 0.9478 | 43,144 | 599 | 47,857,664 |
| toolbar-green-action | supported `GREEN` | 1/1 | 0.8869 | 0.9125 | 20,267 | 468 | 49,201,152 |
| dialog-confirm | supported `GREEN` | 1/1 | 0.8869 | 0.8909 | 31,478 | 664 | 33,538,048 |

All three calls returned HTTP 200 with supported answers and valid SAM
geometry/interior points; no UI action was attempted. Frame hashes were
`buttons=5217a3bb…20c15`, `toolbar=f955dccd…20829`, and
`dialog=816682fb…92fc`. This is stronger than the one-case transport check,
but it is still a synthetic corpus and cannot establish general screenshot
understanding, robustness to layout variation, or real-world grounding.

## Exploratory desktop screenshot attachment

Using the local Computer Use capture, a page-only screenshot of the visible
Chrome window was copied to a private temporary file (PNG, 646×360) and sent
through Pi's normal `@image` attachment path with
`local-llamacpp/qwen36-35b-iq3s-vision`. The image digest is
`98d496a76295b7d26e04878c7155b68cc8e5374fa18bba53920ba64a36c8241a`; the
no-session Pi run returned the expected `YES` for “Is a Reddit-style feed
visible?”. No transcript, image bytes, page URL, or response text was saved.

The same screenshot was passed to the configured SAM2.1 Tiny runner with a
point inside a visible post title. It returned valid geometry (box
`{x:17,y:25,width:764,height:46}`, safe point `{x:120,y:47}`) and score
`0.4447`, with mask digest
`816cdda0bf932965a2f5f1c9ff54319381fda63c371f23758abd5902e1244369`. The
large, low-confidence row mask is diagnostic only; no click or other action
was attempted. Chrome's browser chrome is not present in the captured image,
so an earlier “identify Chrome” question was an invalid oracle. This desktop
probe validates the attachment and segmentation paths, but is not pooled with
the preregistered semantic/geometry scores.

## Reproduction boundary

The canonical four-arm run used the live local router with temperature `0`,
`reasoning_format=none`, bounded `max_tokens=512`, and one request per fresh
case. The SAM arm used the isolated runner and official checkpoint above. The
earlier 256-token pass is retained as diagnostic history but is superseded by
the complete-answer measurements in the table. No
mirror, deployment, source-default change, or adoption decision occurred.
