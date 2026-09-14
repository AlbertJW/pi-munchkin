#!/usr/bin/env python3
"""Bounded JSON-lines SAM 2.1 Tiny runner, speaking harness/lib/sam2-tiny.ts's
pi.sam2.1-tiny/v1 protocol: one JSON request per stdin line, one JSON response
per stdout line, never more.

This module never downloads weights or starts a model implicitly (matching
sam2-tiny.ts's own contract) — the checkpoint is supplied by the installation.
Run harness/scripts/install-sam2-runner.sh once to set one up; it writes a
wrapper that sets PI_SAM2_CHECKPOINT and execs this file.
"""
import base64
import hashlib
import io
import json
import os
import sys

import numpy as np
import torch
from PIL import Image
from sam2.build_sam import build_sam2
from sam2.sam2_image_predictor import SAM2ImagePredictor

CHECKPOINT = os.environ.get("PI_SAM2_CHECKPOINT")
if not CHECKPOINT:
    sys.exit("PI_SAM2_CHECKPOINT is not set — point it at an installed SAM 2.1 "
             "checkpoint (see install-sam2-runner.sh); this runner never fetches one itself.")
if not os.path.isfile(CHECKPOINT):
    sys.exit(f"PI_SAM2_CHECKPOINT does not exist: {CHECKPOINT}")
# A Hydra package-resource path, not a filesystem path — sam2 resolves it from
# its own installed config directory regardless of cwd. Only the Hiera-Tiny
# variant is qualified by this harness; override to try another size.
CONFIG = os.environ.get("PI_SAM2_CONFIG", "configs/sam2.1/sam2.1_hiera_t.yaml")
DEVICE = "mps" if getattr(torch.backends, "mps", None) and torch.backends.mps.is_available() else "cpu"

predictor = SAM2ImagePredictor(build_sam2(CONFIG, CHECKPOINT, device=DEVICE, mode="eval"))

def fail(message):
    print(json.dumps({"error": message}, separators=(",", ":")), flush=True)

def run(req):
    if req.get("protocol") != "pi.sam2.1-tiny/v1":
        return {"error": "protocol"}
    raw = base64.b64decode(req["image_base64"], validate=True)
    if hashlib.sha256(raw).hexdigest() != req.get("exact_sha256"):
        return {"error": "digest"}
    image = Image.open(io.BytesIO(raw)).convert("RGB")
    pixels = np.asarray(image)
    predictor.set_image(pixels)
    hint = req.get("hint") or {}
    if hint.get("kind") == "point":
        coords = np.array([[float(hint["x"]), float(hint["y"])]], dtype=np.float32)
        labels = np.array([1], dtype=np.int32)
        masks, scores, _ = predictor.predict(point_coords=coords, point_labels=labels, multimask_output=False)
    elif hint.get("kind") == "box":
        box = np.array([float(hint["x"]), float(hint["y"]), float(hint["x"] + hint["width"]), float(hint["y"] + hint["height"])], dtype=np.float32)
        masks, scores, _ = predictor.predict(box=box, multimask_output=False)
    else:
        return {"error": "hint"}
    mask = np.asarray(masks[0], dtype=np.bool_)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return {"error": "empty-mask"}
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    # A deterministic point inside the returned mask; this is geometry evidence,
    # never permission to click.
    # Pick the mask pixel furthest from the returned box edges. The harness
    # intentionally rejects boundary points, so a raw first/median pixel is
    # not sufficient for narrow masks.
    distances = np.minimum.reduce([xs - x0, x1 - 1 - xs, ys - y0, y1 - 1 - ys])
    best = int(np.argmax(distances))
    safe_x, safe_y = int(xs[best]), int(ys[best])
    return {
        "segmenter": "sam2.1-tiny",
        "segmenter_version": "1.1.0-hiera-tiny",
        "mask_digest": hashlib.sha256(mask.tobytes()).hexdigest(),
        "box": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0},
        "safe_point": {"x": safe_x, "y": safe_y},
        "model_score": float(np.asarray(scores).reshape(-1)[0]),
        "device": DEVICE,
    }

for line in sys.stdin:
    try:
        result = run(json.loads(line))
        print(json.dumps(result, separators=(",", ":")), flush=True)
    except Exception:
        fail("sam-inference-failed")
