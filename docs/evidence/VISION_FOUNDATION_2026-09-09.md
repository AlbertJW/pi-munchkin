# Vision foundation checkpoint — 2026-09-09

This is a dark, source-only vertical slice. It adds a provider-neutral visual observation cache and a replaceable SAM grounding boundary without changing live defaults. `VISION` remains off unless explicitly enabled; `VISION_GROUNDING=sam` is also required for segmentation.

The existing hashline image path continues to return typed image content. The new `visual_observe` tool can consume an image path or an injected local screen/browser capture adapter. It checks the active model's advertised image capability, bounds image size, records geometry and device scale, and returns a typed image block on a fresh observation. Unsupported models receive a clear refusal. Exact pixel identity uses SHA-256. PNG captures also receive a decoder-free 64-bit DCT perceptual hash; other formats remain exact-only until a capture decoder is supplied.

Cache entries are partitioned by session, source, window or browser identity, and capture geometry. Exact frames can reuse the current interpretation. Near perceptual matches can reuse an interpretation as a hint, subject to question/model/version and freshness checks. A forced observation, a stale entry, a model switch, compaction, or any action uncertainty must request fresh evidence. Cached decisions never authorize a click.

`visual_refine_target` accepts a fresh observation identity plus a point or box and calls a replaceable local SAM adapter. Results bind to the exact image digest, target prompt digest, observation geometry, and segmenter version. It returns a mask digest, region box, and interior candidate point. `click_safe` is deliberately null: the action layer must independently validate the target and require a fresh snapshot.

The capability family `vision` is available through the existing activation boundary. Child environments preserve `VISION` and `VISION_GROUNDING`, so a deliberate parent configuration cannot silently change in a delegated process. Raw screenshots, OCR, base64 payloads, and source paths do not enter telemetry; only bounded digests and cache/grounding metadata are recorded.

The follow-up lifecycle boundary adds a bounded watcher: an explicit screen/browser observation arms a checkpoint every third context assembly, successful UI-changing tools force the next checkpoint, and agent settlement or shutdown tears the watcher down. The watcher reuses the same epoch-scoped cache and geometry reservation path as the explicit tool, and stale in-flight captures cannot repopulate state after compaction, model selection, or settlement.

Offline evidence now includes sixteen visual-observation tests (25 focused visual/capture/SAM/benchmark tests in total), and the complete harness suite passes 842/842 tests. Typecheck and the 195-file package smoke pass. No model inference, desktop capture, SAM process, mirroring, or rollout was performed.

Known limits: the repository now ships a cancellable macOS window adapter, but no browser accessibility backend or installed SAM 2.1 Tiny runner. JPEG/GIF/WebP decoding, model-specific visual-token counting, and collection of the model's generated interpretation into the cache remain open. The qualification packet and frozen benchmark define the next explicit real-model screen.

Rollback: revert the commit containing this checkpoint and remove the new `visual-observe.ts`, `visual-observation.ts`, `visual-grounding.ts`, visual tests, package entries, capability-family additions, and this evidence file. No live installation was changed by this checkpoint.
