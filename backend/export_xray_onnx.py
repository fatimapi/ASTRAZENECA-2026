"""Build step: export the TorchXRayVision DenseNet121 weights to ONNX for backend/xray_onnx.py.

    python -m backend.export_xray_onnx

Downloads the official weights (as the PyTorch engine does), exports them with the sigmoid and without
operating-point remapping, then checks the ONNX model against PyTorch on demo X-rays: the labels must match
and every score must agree to 1e-4, or the build fails. PyTorch is needed here only, not at runtime.
Skips the export when the model file is already there and passes the same check.
"""
from __future__ import annotations

import glob
import hashlib
import os
import sys
from pathlib import Path

import numpy as np

from .imaging import prepare_dicom
from .model import ChestXrayEngine
from .xray_onnx import LABELS, OnnxXrayEngine, model_path, preprocess

ROOT = Path(__file__).resolve().parents[1]
TOLERANCE = 1e-4


def demo_images(limit=2):
    files = sorted(glob.glob(str(ROOT / "demo-data" / "chest-xrays" / "*.dcm")))[:limit]
    if files:
        return [prepare_dicom(open(f, "rb").read(), True).pixels_255 for f in files]
    rng = np.random.default_rng(0)  # no demo data: a synthetic image still checks the export
    return [rng.uniform(0, 255, (600, 520)).astype(np.float32)]


def check(torch_engine, images):
    onnx_engine = OnnxXrayEngine()
    worst = 0.0
    for px in images:
        ref = {f["label"]: f["score"] for f in torch_engine.predict(px)}
        got = {f["label"]: f["score"] for f in onnx_engine.predict(px)}
        if set(ref) != set(got):
            raise SystemExit("ONNX export check failed: labels differ from PyTorch.")
        worst = max(worst, max(abs(ref[k] - got[k]) for k in ref))
    if worst > TOLERANCE:
        raise SystemExit(f"ONNX export check failed: scores differ from PyTorch by {worst:.2e} (limit {TOLERANCE}).")
    return worst


def main():
    import torch
    out = model_path()
    out.parent.mkdir(parents=True, exist_ok=True)
    engine = ChestXrayEngine()
    engine._load()
    model = engine._model
    if [p for p in model.pathologies] != LABELS:
        raise SystemExit("The model's label order is not the one backend/xray_onnx.py expects.")
    images = demo_images()
    if out.is_file():
        try:
            worst = check(engine, images)
            print(f"ONNX model already present and matches PyTorch (max diff {worst:.1e}); export skipped.", flush=True)
            return
        except SystemExit:
            print("Existing ONNX model failed the check; exporting again.", flush=True)
    x = torch.from_numpy(preprocess(images[0]))
    tmp = out.with_suffix(".tmp")
    torch.onnx.export(model, x, str(tmp), input_names=["image"], output_names=["scores"],
                      dynamic_axes={"image": {0: "batch"}, "scores": {0: "batch"}}, opset_version=17, dynamo=False)
    os.replace(tmp, out)
    worst = check(engine, images)
    digest = hashlib.sha256(out.read_bytes()).hexdigest()
    print(f"Exported {out.name} ({out.stat().st_size / 1e6:.1f} MB, sha256 {digest[:16]}…); "
          f"matches PyTorch on {len(images)} image(s), max diff {worst:.1e}.", flush=True)


if __name__ == "__main__":
    sys.exit(main())
