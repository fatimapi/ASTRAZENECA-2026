import asyncio
import base64
import io
import os
import warnings

import numpy as np
import pydicom
import pytest
from fastapi.testclient import TestClient

from backend import app as service
from backend.create_sample import synthetic_dicom_bytes
from backend.imaging import MAX_FILE_BYTES, ImageRejected, prepare_dicom
from backend.model import ChestXrayEngine, ModelUnavailable

TOKEN = "candex-test-only-not-a-real-secret-123456"
AUTH = {"Authorization": "Bearer " + TOKEN}


class StubEngine:
    loaded = True

    def metadata(self):
        return {"name": "TEST STUB ONLY", "version": "test", "weights": "no-weights", "task": "chest-xray-classification"}

    def predict(self, image):
        assert image.shape == (256, 256)
        assert np.isfinite(image).all() and 0 <= image.min() < image.max() <= 255
        return [{"label": "TEST STUB", "score": 0.123}]


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CANDEX_API_KEY", TOKEN)
    monkeypatch.setattr(service, "engine", StubEngine())
    with TestClient(service.app) as client:
        yield client


def post(client, payload=None, **kwargs):
    return client.post("/api/analyze", files={"file": ("not-logged.dcm", synthetic_dicom_bytes() if payload is None else payload, "application/dicom")}, data={"confirmed_chest": "true", "permitted_data": "true"}, headers=AUTH, **kwargs)


def mutate(**fields):
    ds = pydicom.dcmread(io.BytesIO(synthetic_dicom_bytes()))
    for name, value in fields.items():
        if value is None:
            delattr(ds, name)
        else:
            setattr(ds, name, value)
    output = io.BytesIO()
    ds.save_as(output, enforce_file_format=True)
    return output.getvalue()


def test_health_no_key_or_model_download(client, monkeypatch):
    monkeypatch.delenv("CANDEX_API_KEY")
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["model"]["supported_modalities"] == ["CR", "DX"]
    assert TOKEN not in response.text
    assert response.headers["cache-control"] == "no-store"


def test_authentication_before_parsing(client, monkeypatch):
    assert client.post("/api/analyze", content=b"not multipart").status_code == 401
    assert client.post("/api/analyze", headers=[(b"authorization", b"Bearer \xffmalformed")]).status_code == 401
    monkeypatch.delenv("CANDEX_API_KEY")
    assert client.post("/api/analyze", headers=AUTH).status_code == 503


def test_invalid_configured_key_is_controlled_error(client, monkeypatch):
    monkeypatch.setenv("CANDEX_API_KEY", "\u00e9" * 32)
    assert client.post("/api/analyze", headers=AUTH).status_code == 503


def test_success_contract_and_identity_not_returned(client):
    payload = mutate(PatientName="PRIVATE_DO_NOT_RETURN", PatientID="PRIVATE_IDENTIFIER")
    response = post(client, payload)
    assert response.status_code == 200
    result = response.json()
    assert result["status"] == "completed" and result["requires_clinician_review"] is True
    assert result["findings"] == [{"label": "TEST STUB", "score": 0.123}]
    assert base64.b64decode(result["image"]["preview_png_base64"]).startswith(b"\x89PNG")
    assert "PRIVATE" not in response.text and "not-logged" not in response.text
    assert "uncalibrated" in result["report_draft"]
    assert response.headers["cache-control"] == "no-store"


def test_missing_confirmation(client):
    response = client.post("/api/analyze", files={"file": ("test.dcm", synthetic_dicom_bytes())}, headers=AUTH)
    assert response.status_code == 422


@pytest.mark.parametrize("fields", [
    {"Modality": "CT", "SOPClassUID": "1.2.840.10008.5.1.4.1.1.2"},
    {"NumberOfFrames": 2}, {"PhotometricInterpretation": "RGB"},
    {"Rows": 40000, "Columns": 40000}, {"ViewPosition": "LL"},
    {"ViewPosition": None}, {"BodyPartExamined": "HAND"},
    {"BurnedInAnnotation": "YES"}, {"PresentationIntentType": "FOR PROCESSING"},
    {"BitsAllocated": 32}, {"PixelData": None},
])
def test_incompatible_studies_rejected(client, fields):
    response = post(client, mutate(**fields))
    assert response.status_code == 415
    assert "Traceback" not in response.text


def test_invalid_and_uniform_data_rejected(client):
    assert post(client, b"not dicom").status_code == 415
    assert post(client, mutate(PixelData=np.zeros((256, 256), dtype="<u2").tobytes())).status_code == 415


def test_raw_dicom_warning_values_are_not_logged(client, caplog):
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        payload = mutate(SOPClassUID="PRIVATE_SOURCE_MARKER")
    caplog.clear()
    response = post(client, payload)
    assert response.status_code == 415
    assert "PRIVATE_SOURCE_MARKER" not in response.text
    assert "PRIVATE_SOURCE_MARKER" not in caplog.text


def test_mono1_is_inverted_and_rescale_is_supported():
    normal = prepare_dicom(synthetic_dicom_bytes(), True)
    inverse = prepare_dicom(mutate(PhotometricInterpretation="MONOCHROME1", RescaleSlope=2, RescaleIntercept=-100), True)
    assert np.allclose(normal.pixels_255 + inverse.pixels_255, 255, atol=1e-4)


def test_window_that_clips_most_pixels_is_rejected():
    # A CT lung window stored on a radiograph (seen in LIDC-IDRI-0051) turns it white.
    ds = pydicom.dcmread(io.BytesIO(synthetic_dicom_bytes()))
    p5, p10 = (int(v) for v in np.percentile(ds.pixel_array, [5, 10]))
    with pytest.raises(ImageRejected, match="display window clips"):
        prepare_dicom(mutate(WindowCenter=(p5 + p10) // 2, WindowWidth=max(2, p10 - p5)), True)
    # Fully clipped: no usable range at all.
    with pytest.raises(ImageRejected):
        prepare_dicom(mutate(WindowCenter=-600, WindowWidth=1600), True)
    # A sensible window over the stored range still works.
    lo, hi = int(ds.pixel_array.min()), int(ds.pixel_array.max())
    assert prepare_dicom(mutate(WindowCenter=(lo + hi) // 2, WindowWidth=hi - lo + 1), True).pixels_255.std() > 0


def test_deflated_dataset_rejected_before_pydicom_inflates(client, monkeypatch):
    ds = pydicom.dcmread(io.BytesIO(synthetic_dicom_bytes()))
    ds.file_meta.TransferSyntaxUID = "1.2.840.10008.1.2.1.99"
    output = io.BytesIO()
    ds.save_as(output, enforce_file_format=True)
    # Prove preflight rejects without allowing full dcmread/decompression.
    monkeypatch.setattr(pydicom, "dcmread", lambda *a, **k: pytest.fail("Full dataset parser was reached"))
    response = post(client, output.getvalue())
    assert response.status_code == 415 and "uncompressed" in response.text


@pytest.mark.parametrize("malformation", ["lowercase-vr", "nonzero-reserved"])
def test_malformed_meta_rejected_before_full_parser(client, monkeypatch, malformation):
    payload = bytearray(synthetic_dicom_bytes())
    if malformation == "lowercase-vr":
        payload[136:138] = b"ul"
    else:
        offset = payload.index(b"\x02\x00\x01\x00OB")
        payload[offset + 6:offset + 8] = b"\x01\x00"
    monkeypatch.setattr(pydicom, "dcmread", lambda *a, **k: pytest.fail("Full dataset parser was reached"))
    response = post(client, bytes(payload))
    assert response.status_code == 415 and "file meta" in response.text


def test_failed_model_returns_error_without_findings(client, monkeypatch):
    def fail(_):
        raise ModelUnavailable("The model is unavailable.")
    monkeypatch.setattr(service.engine, "predict", fail)
    response = post(client)
    assert response.status_code == 503
    assert "findings" not in response.json()


def test_request_body_bound_before_parser(client):
    response = client.post("/api/analyze", content=b"x", headers={**AUTH, "Content-Length": str(MAX_FILE_BYTES + 1024 * 1024)})
    assert response.status_code == 413


def test_streaming_body_bound_without_content_length(monkeypatch):
    monkeypatch.setenv("CANDEX_API_KEY", TOKEN)
    sent, chunks = [], 0
    async def unused_app(*_):
        raise AssertionError("Body reached multipart parser")
    async def receive():
        nonlocal chunks
        chunks += 1
        return {"type": "http.request", "body": b"x" * (1024 * 1024), "more_body": chunks < 30}
    async def send(message):
        sent.append(message)
    scope = {"type": "http", "method": "POST", "path": "/api/analyze", "headers": [(b"authorization", ("Bearer " + TOKEN).encode())]}
    asyncio.run(service.InferenceRequestGuard(unused_app)(scope, receive, send))
    assert next(m for m in sent if m["type"] == "http.response.start")["status"] == 413
    assert chunks < 30


def test_private_server_files_not_served(client):
    assert client.get("/").status_code == 200
    assert client.get("/app.js").status_code == 200
    for path in ["/.env", "/.git/config", "/backend/app.py", "/requirements.txt", "/README.md", "/..%2Fbackend%2Fapp.py"]:
        assert client.get(path).status_code == 404


@pytest.mark.skipif(os.getenv("CANDEX_RUN_MODEL_TEST") != "1", reason="opt-in: downloads actual research model weights")
def test_actual_model_on_synthetic_dicom(monkeypatch, tmp_path):
    # Software integration only. Synthetic pixels cannot test medical accuracy.
    monkeypatch.setenv("CANDEX_MODEL_CACHE", os.getenv("CANDEX_MODEL_CACHE", str(tmp_path / "weights")))
    engine = ChestXrayEngine()
    image = prepare_dicom(synthetic_dicom_bytes(), True)
    findings = engine.predict(image.pixels_255)
    assert engine.loaded and len(findings) == 18
    assert {"Nodule", "Mass"}.issubset({f["label"] for f in findings})
    assert all(0 <= f["score"] <= 1 for f in findings)
    # Exercise the same multipart route the Doctor interface uses with real inference.
    monkeypatch.setenv("CANDEX_API_KEY", TOKEN)
    monkeypatch.setattr(service, "engine", engine)
    with TestClient(service.app) as client:
        response = post(client)
    assert response.status_code == 200
    result = response.json()
    assert len(result["findings"]) == 18
    assert result["model"]["weights"] == "densenet121-res224-all"
    assert result["requires_clinician_review"] is True


def test_official_map_asset_is_allowlisted(client):
    response = client.get("/data/finland-regions.geojson")
    assert response.status_code == 200
    assert len(response.json()["features"]) == 19
    assert client.get("/data/map-sources.md").status_code == 404


def test_lidc_demo_images_are_served_but_nothing_else_under_data(client):
    ok = client.get("/data/lidc/LIDC-IDRI-0799/s05.jpg")
    assert ok.status_code == 200 and ok.headers["content-type"] == "image/jpeg"
    assert client.get("/data/lidc/cases.js").status_code == 200
    for bad in ["/data/lidc/LIDC-IDRI-0799/../../backend/app.py", "/data/lidc/LIDC-IDRI-0799/s05.png",
                "/data/lidc/..%2F..%2Fbackend/app.py", "/data/lidc/LIDC-IDRI-9999/s05.jpg", "/data/lidc/notes/s05.jpg"]:
        assert client.get(bad).status_code == 404, bad


def test_agent_routes_need_token_validate_input_and_never_leak_the_key(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("CANDEX_GEMINI_KEY_FILE", raising=False)
    status = client.get("/api/agent/status").json()
    assert status["configured"] is False and "key" not in str(status).lower().replace("chatmodel", "")
    chat = {"record": {"Patient": {"x": "y"}}, "messages": [{"role": "user", "text": "hi"}]}
    assert client.post("/api/agent/chat", json=chat).status_code == 401
    assert client.post("/api/agent/chat", json=chat, headers={"Authorization": "Bearer wrong"}).status_code == 401
    assert client.post("/api/agent/chat", json=chat, headers=AUTH).status_code == 503  # no Gemini key: honest failure
    assert client.post("/api/agent/analyze-ct", json={"caseId": "../../backend/app.py"}, headers=AUTH).status_code == 422
    assert client.post("/api/agent/draft", json={"record": {}, "kind": "anything"}, headers=AUTH).status_code == 422
    big = {"record": {"x": "y" * 300_000}, "messages": [{"role": "user", "text": "hi"}]}
    assert client.post("/api/agent/chat", json=big, headers=AUTH).status_code == 413
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaTestKeyThatMustNeverLeak_123456")
    status = client.get("/api/agent/status").json()
    assert status["configured"] is True and "AIza" not in str(status)


def test_cxr_summary_needs_token_and_valid_scores(client, monkeypatch):
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("CANDEX_GEMINI_KEY_FILE", raising=False)
    ok = {"lang": "fi", "findings": [{"label": "Nodule", "score": 0.1}, {"label": "Mass", "score": 0.03}]}
    assert client.post("/api/agent/cxr-summary", json=ok).status_code == 401
    assert client.post("/api/agent/cxr-summary", json=ok, headers=AUTH).status_code == 503  # no Gemini key: page falls back
    for bad in ({"findings": []}, {"findings": [{"label": "Nodule", "score": 1.5}]}, {"lang": "sv", "findings": ok["findings"]},
                {"findings": [{"label": "x" * 500, "score": 0.1}]}, {"findings": [{"label": "a", "score": 0.1}] * 41}):
        assert client.post("/api/agent/cxr-summary", json=bad, headers=AUTH).status_code == 422


def test_quality_agent_routes_need_token_validate_and_check_numbers(client, monkeypatch):
    from backend.agent import unverified_numbers
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("CANDEX_GEMINI_KEY_FILE", raising=False)
    chat = {"pack": {"values": {"kpi.a": {"value": 12}}}, "messages": [{"role": "user", "text": "hi"}]}
    assert client.post("/api/agent/quality-chat", json=chat).status_code == 401
    assert client.post("/api/agent/quality-chat", json=chat, headers=AUTH).status_code == 503  # no Gemini key
    assert client.post("/api/agent/quality-report", json={"kind": "kpi", "pack": {}}, headers=AUTH).status_code == 503
    assert client.post("/api/agent/quality-report", json={"kind": "anything", "pack": {}}, headers=AUTH).status_code == 422
    big = {"pack": {"x": "y" * 90_000}, "messages": [{"role": "user", "text": "hi"}]}
    monkeypatch.setenv("GEMINI_API_KEY", "AIzaTestKeyThatMustNeverLeak_123456")
    assert client.post("/api/agent/quality-chat", json=big, headers=AUTH).status_code == 413
    pack = '{"a": 12, "b": 0.4962, "c": "28–99 %", "d": 76.5, "e": 2035}'
    assert unverified_numbers("12 d, 0,50, 49.6 %, 50 %, CI 28–99 %, 76,5 % by 2035", pack) == []
    assert unverified_numbers("The gap is 13 days and 0.7", pack) == [0.7, 13.0]


def test_ct_compare_needs_token_confirmations_and_ct_series(client, monkeypatch):
    from backend.ct_compare import match, reference_cases
    files = [("files", ("a.dcm", synthetic_dicom_bytes(), "application/dicom"))]
    assert client.post("/api/ct/compare", files=files, data={"confirmed_chest": "true", "permitted_data": "true"}).status_code == 401
    assert client.post("/api/ct/compare", files=files, data={"confirmed_chest": "true"}, headers=AUTH).status_code == 422
    # The synthetic file is an X-ray (not CT): the job is rejected before any AI call.
    r = client.post("/api/ct/compare", files=files, data={"confirmed_chest": "true", "permitted_data": "true"}, headers=AUTH)
    assert r.status_code == 202 and r.json()["job"]
    jid = r.json()["job"]
    assert client.get(f"/api/ct/jobs/{jid}").status_code == 401
    import time
    for _ in range(100):
        job = client.get(f"/api/ct/jobs/{jid}", headers=AUTH).json()
        if job["status"] != "running":
            break
        time.sleep(0.05)
    assert job["status"] == "error" and job["code"] == 415 and "CT" in job["detail"]
    assert client.get("/api/ct/jobs/unknown", headers=AUTH).status_code == 404
    # Matching: all 25 public studies scored; similar nodules rank first.
    refs = reference_cases()
    assert len(refs) == 25 and all(r["band"] and r["diameter"] for r in refs)
    ranked = match({"nodule_present": True, "long_axis_mm": 30.0, "lung_rads": "4X", "composition": "solid", "location": {"side": "left"}}, refs)
    assert len(ranked) == 25 and ranked[0]["band"] in ("4B", "4X-like") and ranked[0]["diameter"] >= 15
    small = match({"nodule_present": True, "long_axis_mm": 5.0, "lung_rads": "2", "composition": "solid", "location": {"side": "right"}}, refs)
    assert small[0]["band"] == "2" and small[0]["score"] <= small[-1]["score"]
    assert all(0 <= m["similarity"] <= 100 for m in ranked)


def test_nodule_measurement_on_a_synthetic_lung():
    """A 10 mm solid nodule touching a vessel and near the chest wall, in synthetic lung (HU)."""
    from backend.ct_measure import lung_rads_by_size, measure_nodule
    px, spacing = 0.7, 1.0
    z, y, x = np.mgrid[0:60, 0:160, 0:160].astype(np.float32)
    vol = np.full((60, 160, 160), 40.0, np.float32)                          # body
    lung = ((y[0] - 80) / 60) ** 2 + ((x[0] - 80) / 60) ** 2 <= 1            # one lung region (2-D)
    vol[:, lung] = -850.0
    vol[:, :, :2] = -1000.0                                                 # outside air at the image edge
    cz, cy, cx, r_mm = 30, 80, 70, 5.0
    d2 = ((z - cz) * spacing) ** 2 + ((y - cy) * px) ** 2 + ((x - cx) * px) ** 2
    vol[d2 <= r_mm ** 2] = 30.0                                             # nodule: 10 mm diameter
    vessel = (((y - cy) * px) ** 2 + ((z - cz) * spacing) ** 2 <= 1.0) & (x > cx) & (x < cx + 40)
    vol[vessel & lung[None]] = 20.0                                         # thin vessel attached
    m = measure_nodule(vol, px, spacing, cz, (cy + 2, cx - 2))              # seed a little off-centre
    assert m is not None
    assert 8.5 <= m["long_mm"] <= 12.0, m
    assert lung_rads_by_size(m["mean_mm"]) == "4A"
    assert measure_nodule(vol, px, spacing, cz, (80, 120)) is None or measure_nodule(vol, px, spacing, cz, (80, 120))["long_mm"] < 5  # empty lung: nothing large
