# Preregistration: LFM 2.5 VL 3B real-UI vision qualification (2026-09-10)

## Scope

This is a separate, one-request protocol qualification for the newly registered
`local-llamacpp/lfm25-vl-3b` model. It does not repeat, rescue, or pool with
the prior Qwen Vision negative. It tests only whether this model can receive a
browser-rendered image and return the fixed semantic answer under the existing
safe, local real-UI probe.

## Frozen protocol

The source fixture is
`harness/tests/fixtures/vision-real-ui-lfm25-vl-3b-v1.json`. It reuses the
fixed 640-by-360 Chrome confirmation-dialog HTML and renderer geometry oracle:
the `Confirm` button occupies `{x:360,y:214,width:120,height:40}` and its
required semantic answer is `GREEN`. The fixture, renderer identity, temporary
screenshot digest, model identity, and manifest are bound by the probe's
approval SHA before inference.

Exactly one request may be sent to the served `lfm25-vl-3b` route with
temperature zero and a 128-token completion cap. The acceptance criterion is
HTTP 200 plus a non-empty final answer matching `GREEN`; any other outcome is
a valid negative. No computer action, SAM grounding, cache claim, model
comparison, quality adoption, or default change is in scope. The temporary
screenshot and raw response remain private; the public audit records only safe
classifications and digests.

## Interpretation

A pass establishes only transport and this one semantic response for the 3B
model. It is not evidence that `VISION=on`, perceptual cache reuse, or SAM
grounding should be enabled. A failure is recorded once and is not retried
under this preregistration.
