"""X-ray on ONNX Runtime (free-plan memory): same scores as PyTorch, worker prepares the image itself,
one heavy job at a time, and the float32 image preparation matches the previous float64 path."""
import asyncio
import glob
import sys
from pathlib import Path

import numpy as np
import pytest

from backend import imaging, xray_onnx
from backend.model import SubprocessXrayEngine

ROOT = Path(__file__).resolve().parents[2]
XRAYS = sorted(glob.glob(str(ROOT / "demo-data" / "chest-xrays" / "*.dcm")))
needs_onnx = pytest.mark.skipif(not xray_onnx.available(), reason="run python -m backend.export_xray_onnx first")
needs_demo = pytest.mark.skipif(not XRAYS, reason="demo X-rays not present")


@needs_onnx
@needs_demo
def test_onnx_scores_equal_pytorch_on_demo_xrays():
    pytest.importorskip("torchxrayvision")
    from backend.model import ChestXrayEngine
    torch_engine, onnx_engine = ChestXrayEngine(), xray_onnx.OnnxXrayEngine()
    for f in XRAYS[:3]:
        px = imaging.prepare_dicom(open(f, "rb").read(), True).pixels_255
        a, b = torch_engine.predict(px), onnx_engine.predict(px)
        assert [x["label"] for x in a] == [x["label"] for x in b]
        assert max(abs(x["score"] - y["score"]) for x, y in zip(a, b)) < 1e-5


@needs_onnx
@needs_demo
def test_onnx_runs_without_importing_torch():
    import subprocess
    code = ("import sys, numpy as np; from backend.xray_onnx import OnnxXrayEngine; "
            "OnnxXrayEngine().predict(np.random.default_rng(0).uniform(0,255,(400,380)).astype(np.float32)); "
            "print(any(m == 'torch' or m.startswith('torch.') for m in sys.modules))")
    out = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, cwd=ROOT)
    assert out.returncode == 0 and out.stdout.strip() == "False"


@needs_onnx
@needs_demo
def test_worker_prepares_and_scores_a_dicom():
    image, findings = SubprocessXrayEngine().analyze_dicom(open(XRAYS[0], "rb").read(), True)
    assert image["width"] > 0 and image["preview_png_base64"] and len(findings) == 18
    assert findings == sorted(findings, key=lambda x: -x["score"])


def test_worker_reports_rejected_images_as_rejections():
    ct = sorted(glob.glob(str(ROOT / "demo-data" / "ct-uploads" / "*" / "*.dcm")))
    if not ct:
        pytest.skip("demo CT not present")
    with pytest.raises(imaging.ImageRejected):
        SubprocessXrayEngine().analyze_dicom(open(ct[0], "rb").read(), True)


@needs_demo
def test_float32_preparation_matches_float64_path(monkeypatch):
    for f in XRAYS:
        raw = open(f, "rb").read()
        fast = imaging.prepare_dicom(raw, True)
        # Force the previous pydicom LUT path by hiding the fast-path condition.
        real = imaging.pydicom.dcmread

        def reading(*a, **k):
            ds = real(*a, **k)
            ds.VOILUTFunction = "LINEAR_EXACT"  # not "LINEAR": takes the pydicom path
            return ds
        monkeypatch.setattr(imaging.pydicom, "dcmread", reading)
        slow = imaging.prepare_dicom(raw, True)
        monkeypatch.setattr(imaging.pydicom, "dcmread", real)
        assert fast.pixels_255.shape == slow.pixels_255.shape
        assert float(np.abs(fast.pixels_255 - slow.pixels_255).max()) < 0.5  # LINEAR_EXACT differs by ≤ half a step


def test_xray_waits_for_a_running_ct_job_then_asks_to_retry(monkeypatch):
    from fastapi.testclient import TestClient
    import backend.app as service
    from backend import jobs
    key = "k" * 32
    monkeypatch.setenv("CANDEX_API_KEY", key)

    class BusyWithCT:  # a CT job holds the heavy-job lock for longer than the X-ray will wait
        async def acquire(self):
            await asyncio.sleep(10)

        def release(self):
            raise AssertionError("never acquired")
    monkeypatch.setattr(service, "HEAVY", BusyWithCT())
    monkeypatch.setattr(service, "XRAY_WAIT_S", 0.2)
    files = {"file": ("x.dcm", open(XRAYS[0], "rb").read() if XRAYS else b"x" * 200, "application/dicom")}
    r = TestClient(service.app).post("/api/analyze", headers={"Authorization": f"Bearer {key}"}, files=files,
                                     data={"confirmed_chest": "true", "permitted_data": "true"})
    assert r.status_code == 503 and "CT comparison is running" in r.json()["detail"]
    assert jobs.XRAY_WAIT_S == 45
