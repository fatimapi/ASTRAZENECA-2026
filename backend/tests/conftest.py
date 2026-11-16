import pytest


@pytest.fixture(autouse=True)
def _public_demo_off_by_default(monkeypatch):
    """Most tests check the token-protected behaviour; test_public_demo.py turns the public demo on."""
    monkeypatch.setenv("CANDEX_PUBLIC_DEMO", "0")
