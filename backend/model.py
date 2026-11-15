"""Real TorchXRayVision inference; never substitute demonstration findings."""
from __future__ import annotations

import importlib.metadata
import os
import threading
from pathlib import Path

import numpy as np

WEIGHTS = "densenet121-res224-all"
MODEL_NAME = "TorchXRayVision DenseNet121"
TASK = "chest-xray-classification"
LIMITATIONS = [
    "Research prototype only; not clinically validated for Candex or for making patient-care decisions.",
    "Frontal AP/PA CR/DX chest X-rays only. CT, MR, mammography, lateral images and multi-frame studies are unsupported.",
    "Scores are uncalibrated model outputs, not disease probabilities or a diagnosis. No decision threshold is applied.",
    "No lesion localisation, cancer confirmation, segmentation or comparison with earlier scans is performed.",
    "DICOM presentation processing, full-range scaling, centre cropping and 224 × 224 resizing can change or exclude image detail.",
    "Images may contain burned-in identifiers that metadata checks cannot detect. Use permitted, de-identified research/test images only.",
    "All outputs require qualified clinician review. Model performance can vary across acquisition settings and patient groups.",
]


class ModelUnavailable(RuntimeError):
    pass


class ChestXrayEngine:
    def __init__(self):
        self._model = None
        self._xrv = None
        self._torch = None
        self._lock = threading.Lock()

    @property
    def loaded(self):
        return self._model is not None

    def metadata(self):
        try:
            version = importlib.metadata.version("torchxrayvision")
        except importlib.metadata.PackageNotFoundError:
            version = "not-installed"
        return {"name": MODEL_NAME, "version": version, "weights": WEIGHTS, "task": TASK}

    def _load(self):
        if self._model is not None:
            return
        try:
            import torch
            import torchxrayvision as xrv

            cache = Path(os.getenv("CANDEX_MODEL_CACHE", str(Path(__file__).resolve().parent / ".model-cache"))).expanduser()
            cache.mkdir(parents=True, exist_ok=True)
            torch.set_num_threads(max(1, min(int(os.getenv("CANDEX_CPU_THREADS", "2")), 8)))
            model = xrv.models.DenseNet(weights=WEIGHTS, cache_dir=str(cache))
            model = model.to("cpu").eval()
            # Return sigmoid outputs without TorchXRayVision operating-point remapping.
            # These remain uncalibrated and are not a cancer-risk score.
            model.op_threshs = None
            model.apply_sigmoid = True
            self._torch, self._xrv, self._model = torch, xrv, model
        except Exception:
            raise ModelUnavailable("The imaging model could not load. Check backend dependencies, internet access for the first weights download, available memory and the model cache.") from None

    def predict(self, pixels_255: np.ndarray):
        with self._lock:
            self._load()
            try:
                image = self._xrv.datasets.normalize(pixels_255, 255)[None, ...]
                image = self._xrv.datasets.XRayCenterCrop()(image)
                image = self._xrv.datasets.XRayResizer(224)(image)
                tensor = self._torch.from_numpy(np.ascontiguousarray(image, dtype=np.float32))[None, ...]
                with self._torch.inference_mode():
                    outputs = self._model(tensor).detach().cpu().numpy()[0]
                labels = list(self._model.pathologies)
                if len(labels) != len(outputs) or not np.isfinite(outputs).all():
                    raise ValueError("Invalid model outputs")
                if np.any(outputs < 0) or np.any(outputs > 1):
                    raise ValueError("Out-of-range model outputs")
                return sorted([{"label": str(label), "score": float(score)} for label, score in zip(labels, outputs) if label], key=lambda item: item["score"], reverse=True)
            except Exception:
                raise ModelUnavailable("Model inference failed. No findings have been generated; check the backend installation and input compatibility.") from None


class SubprocessXrayEngine:
    """Runs each X-ray analysis in a short-lived worker process (python -m backend.xray_worker) that exits
    afterwards, so the model's memory is returned at once. The worker gets the raw DICOM and does the image
    preparation itself, so the server process never holds the full-size image. Used on small hosted
    instances (Render free: 512 MB)."""

    TIMEOUT_S = 240
    loaded = False

    def __init__(self):
        self._lock = threading.Lock()

    def metadata(self):
        return _inner_engine_class()().metadata()

    def _run(self, payload: bytes, args):
        import json
        import subprocess
        import sys
        with self._lock:
            try:
                done = subprocess.run([sys.executable, "-m", "backend.xray_worker", *args], input=payload, capture_output=True,
                                      timeout=self.TIMEOUT_S, cwd=str(Path(__file__).resolve().parents[1]), env=os.environ.copy())
            except subprocess.TimeoutExpired:
                raise ModelUnavailable("The imaging model took too long. Try again.") from None
        try:
            out = json.loads(done.stdout.decode() or "{}")
        except ValueError:
            out = {}
        if out.get("rejected"):
            from .imaging import ImageRejected
            raise ImageRejected(out["rejected"])
        if done.returncode != 0 or "findings" not in out:
            # The worker reports a fixed, safe message; a crash (e.g. out of memory) has none.
            raise ModelUnavailable(out.get("error") or "The imaging model could not run (the worker process stopped). Check the backend's available memory.")
        return out

    def analyze_dicom(self, content: bytes, confirmed_chest: bool):
        """Prepare and score one DICOM in the worker. Returns (image_info, findings)."""
        out = self._run(content, ["--dicom"] + (["--confirmed"] if confirmed_chest else []))
        return out["image"], out["findings"]

    def predict(self, pixels_255: np.ndarray):
        import io
        buf = io.BytesIO()
        np.save(buf, np.ascontiguousarray(pixels_255, dtype=np.float32), allow_pickle=False)
        return self._run(buf.getvalue(), [])["findings"]


def _inner_engine_class():
    """ONNX Runtime when the exported model is present (and not switched off), else PyTorch."""
    choice = os.getenv("CANDEX_XRAY_ENGINE", "auto").lower()
    if choice != "torch":
        from . import xray_onnx
        if choice == "onnx" or xray_onnx.available():
            return xray_onnx.OnnxXrayEngine
    return ChestXrayEngine


def make_engine():
    """In-process engine on a laptop (fast after the first load); worker process on hosted/small instances."""
    flag = os.getenv("CANDEX_XRAY_SUBPROCESS")
    use_worker = flag == "1" if flag is not None else bool(os.getenv("RENDER"))
    return SubprocessXrayEngine() if use_worker else _inner_engine_class()()
