"""Demo scans (demo-data = the team's FINAL DEMO CT / FINAL DEMO XRAY): listed, picked by name,
read on the server; nothing outside demo-data can be requested."""

import pytest
from fastapi.testclient import TestClient

import backend.app as service
from backend import demo

KEY = "k" * 32
H = {"Authorization": f"Bearer {KEY}"}
OK = {"confirmed_chest": "true", "permitted_data": "true"}


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("CANDEX_API_KEY", KEY)
    return TestClient(service.app)


def test_lists_the_demo_scans(client):
    d = client.get("/api/demo/files").json()
    if not d["ct"] and not d["xray"]:
        pytest.skip("demo-data not present")
    assert all(c["id"].startswith("LIDC-IDRI-") and c["slices"] >= 20 for c in d["ct"])
    assert all(x["id"].startswith("LIDC-IDRI-") for x in d["xray"]) and "CC BY 3.0" in d["source"]


@pytest.mark.parametrize("name", ["../../backend/app", "LIDC-IDRI-0002/../x", "lidc-idri-0002", "LIDC-IDRI-02", ""])
def test_only_demo_names_are_accepted(name):
    with pytest.raises(Exception):
        demo.xray_bytes(name)
    with pytest.raises(Exception):
        demo.ct_paths(name)


def test_xray_needs_a_demo_or_a_file(client):
    assert client.post("/api/analyze", headers=H, data=OK).status_code == 422
    assert client.post("/api/analyze", headers=H, data={**OK, "demo_file": "../../etc/passwd"}).status_code == 422
    assert client.post("/api/analyze", headers=H, data={**OK, "demo_file": "LIDC-IDRI-9999"}).status_code == 404
    assert client.post("/api/analyze", data={**OK, "demo_file": "LIDC-IDRI-0002"}).status_code == 401


def test_ct_demo_name_is_checked_and_needs_the_token(client):
    assert client.post("/api/ct/compare", headers=H, data=OK).status_code == 422
    assert client.post("/api/ct/compare", headers=H, data={**OK, "demo_case": ".."}).status_code == 422
    assert client.post("/api/ct/compare", data={**OK, "demo_case": "LIDC-IDRI-0110"}).status_code == 401
