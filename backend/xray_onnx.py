"""Chest X-ray classifier on ONNX Runtime: the same TorchXRayVision DenseNet121 ("densenet121-res224-all")
weights, exported to ONNX at build time (backend/export_xray_onnx.py), run without PyTorch.

Why: PyTorch alone takes ~190 MB and the whole PyTorch worker ~440 MB, which does not fit next to the server
on Render's free plan (512 MB). This path peaks at ~200 MB with scores equal to PyTorch's to within float32
rounding (checked on the 8 demo X-rays and again at every build).

The model file is generated, never committed: the weights were trained on datasets with research-use terms.
"""
from __future__ import annotations

import os
import threading
from pathlib import Path

import numpy as np

# Output order of densenet121-res224-all (model.pathologies); checked against PyTorch at export.
LABELS = ["Atelectasis", "Consolidation", "Infiltration", "Pneumothorax", "Edema", "Emphysema", "Fibrosis",
          "Effusion", "Pneumonia", "Pleural_Thickening", "Cardiomegaly", "Nodule", "Mass", "Hernia", "Lung Lesion",
          "Fracture", "Lung Opacity", "Enlarged Cardiomediastinum"]
XRV_VERSION = "1.5.7"  # TorchXRayVision release the weights come from (requirements.txt)


def model_path() -> Path:
    default = Path(__file__).resolve().parent / ".model-cache" / "xrv_densenet121_all.onnx"
    return Path(os.getenv("CANDEX_XRAY_ONNX", str(default))).expanduser()


def available() -> bool:
    if not model_path().is_file():
        return False
    try:
        import onnxruntime  # noqa: F401
    except Exception:
        return False
    return True


def preprocess(pixels_255: np.ndarray) -> np.ndarray:
    """Equal to TorchXRayVision normalize(., 255) → XRayCenterCrop → XRayResizer(224) (skimage resize),
    computed with fewer full-size copies: crop first, then normalise in place, then SciPy's filter + zoom
    (what skimage.transform.resize does). Returns a (1, 1, 224, 224) float32 array."""
    from scipy import ndimage as ndi
    if pixels_255.max() > 255:
        raise ValueError("pixel range")
    y, x = pixels_255.shape
    c = min(y, x)
    sx, sy = x // 2 - c // 2, y // 2 - c // 2
    img = np.array(pixels_255[sy:sy + c, sx:sx + c], dtype=np.float32)
    img /= np.float32(255); img *= 2; img -= 1.0; img *= 1024
    img = img[None]
    factors = np.divide(img.shape, (1, 224, 224))
    filt = ndi.gaussian_filter(img, np.maximum(0, (factors - 1) / 2), cval=0.0, mode="grid-constant")
    lo, hi = img.min(), img.max()
    del img
    out = ndi.zoom(filt, [1 / f for f in factors], order=1, mode="grid-constant", cval=0.0, grid_mode=True)
    del filt
    if not lo <= 0 <= hi and out.min() <= 0 <= out.max():
        lo, hi = min(lo, 0.0), max(hi, 0.0)
    np.clip(out, np.asarray(lo), np.asarray(hi), out=out)
    return np.ascontiguousarray(out[None], dtype=np.float32)


class OnnxXrayEngine:
    """Same interface as model.ChestXrayEngine (metadata, loaded, predict)."""

    def __init__(self):
        self._session = None
        self._lock = threading.Lock()

    @property
    def loaded(self):
        return self._session is not None

    def metadata(self):
        from .model import MODEL_NAME, TASK, WEIGHTS
        return {"name": MODEL_NAME, "version": XRV_VERSION, "weights": WEIGHTS, "task": TASK, "runtime": "onnxruntime"}

    def _load(self):
        if self._session is not None:
            return
        from .model import ModelUnavailable
        try:
            import onnxruntime as ort
            so = ort.SessionOptions()
            so.intra_op_num_threads = 1
            so.inter_op_num_threads = 1
            so.enable_mem_pattern = False  # measured: lowest peak memory with identical scores
            self._session = ort.InferenceSession(str(model_path()), so, providers=["CPUExecutionProvider"])
        except Exception:
            raise ModelUnavailable("The imaging model could not load. The ONNX model is created during the build; check the build log.") from None

    def predict(self, pixels_255: np.ndarray):
        from .model import ModelUnavailable
        with self._lock:
            self._load()
            try:
                x = preprocess(pixels_255)
                inp = self._session.get_inputs()[0].name
                outputs = self._session.run(None, {inp: x})[0][0]  # sigmoid is part of the exported graph
                if len(outputs) != len(LABELS) or not np.isfinite(outputs).all():
                    raise ValueError("Invalid model outputs")
                if np.any(outputs < 0) or np.any(outputs > 1):
                    raise ValueError("Out-of-range model outputs")
                return sorted([{"label": label, "score": float(score)} for label, score in zip(LABELS, outputs)],
                              key=lambda item: item["score"], reverse=True)
            except Exception:
                raise ModelUnavailable("Model inference failed. No findings have been generated; check the backend installation and input compatibility.") from None
