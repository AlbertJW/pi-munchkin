# Audit: LFM 2.5 VL 3B real-UI vision qualification V2 (2026-09-10)

## Result

V2 is a clean, narrow protocol and semantic receipt. The private, mode-0600
result artifact has SHA-256
`6248f3a159c640825866255d4e863a5894d6321ed0a7a2519cce8ca6b947f311`.
The run was `dd04601c-08d2-448e-a9c5-a0eb624a04e4`, bound to approval
`b2928a9d3a7e925337533e1b896bfa00ac720d3b68b0d15e0fa5c5c0d7f5a9bc`.

The one permitted request to requested/served model
`local-llamacpp/lfm25-vl-3b` / `lfm25-vl-3b` returned HTTP 200 in 176 ms with
a non-empty final answer that met the fixed `GREEN` oracle, for required claim
coverage `1/1`. The prepared receipt bound the manifest, runner source digest,
fixture HTML, renderer digest, temporary screenshot digest, 640-by-360 image
geometry, and independent confirmation-button box.

## Limits and decision

This is not comparable with the Qwen Vision negative, because it is a different
model and no matched multi-case evaluation was run. It demonstrates only that
this 3B VLM can accept the local image transport and answer one simple semantic
question. It does not assess cache reuse, changed visual state, uncertainty,
actions, switching, SAM grounding, or computer-use value.

`VISION=on`, `VISION_GROUNDING=sam`, and visual cache behavior therefore remain
dark and unresolved. No default, mirror, deployment, or adoption decision
changed, and V2 will not be rerun under this manifest.
