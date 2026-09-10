# Qwen Vision real-UI qualification — 2026-09-10

## Frozen screen

The one-case screen was prepared before model execution from
`harness/tests/fixtures/vision-real-ui-chrome-v1.json` on source surface
`c7e56947c9e8242095e9a8e5e0274f0076f69c2ef9f7e3f46ef4f92b41742b0c`.
It uses a local, browser-rendered confirmation dialog rather than the older
painted-rectangle transport fixture. Google Chrome rendered a `640×360` PNG
with digest `58e7c26177d1edefcbaa92e71609bd68f7b237506fdf5b5ca51c0828a20ea61e`.
The renderer independently reported the `Confirm` button box as
`{x:360,y:214,width:120,height:40}`, matching the manifest oracle. The
fixture HTML, renderer version, screenshot, geometry, model role, and manifest
were bound into approval SHA-256
`095e46aed6239fcbf77562c7d67c1eac0df2f8b13a71843b05c22d299d9d70c8`.

Hypothesis: the registered vision model can return a final `GREEN` answer to
the fixed question about the Confirm button. The acceptance rule was one HTTP
200 response with a non-empty final answer matching `GREEN`; the maximum was
one request. No click, UI action, cache reuse claim, or SAM score was in scope.

## Execution and result

The host router listed every model unloaded before the request. The explicit
request bound `local-llamacpp/qwen36-35b-iq3s-vision` to served alias
`qwen36-35b-iq3s-vision`; its normal lazy load left that model as the sole
loaded route afterwards. The endpoint is represented only by fingerprint
`75a5be964d6e0f344c4bd3cf366443183784a28430c4a2e7ee101ef94fdad83e`.

| metric | result |
| --- | --- |
| HTTP status | 200 |
| final answer present | false |
| supported answer | false |
| required coverage | 0/1 |
| latency | 18,668 ms |
| prompt / completion / total tokens | 249 / 128 / 377 |

The redacted private result receipt is mode `0600`; its content digest is
`b137b28bd16656846ffbcbedd6d23f1be080fd56c0a57de60cdcce44a61738a2`.
No raw image, endpoint, or model response is retained in this public record.

## Decision

**Valid negative result; vision remains unresolved and dark.** The transport
and geometry bindings held, but the screen failed its declared semantic rule.
The one-request ceiling was honored: this screen will not be extended or rerun
to seek a favorable result. Any follow-up requires a new diagnosis and a new
frozen manifest; it must separately cover cache/uncertainty/action/model-switch
behavior and a harness-checked SAM result before vision can be considered for
adoption.
