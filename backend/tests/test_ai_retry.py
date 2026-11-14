"""AI calls: temporary provider errors are retried; lasting ones give a clear message."""
import asyncio

import pytest
from fastapi import HTTPException
from google.genai import errors

from backend import agent


def api_error(code, status):
    return errors.APIError(code, {"error": {"code": code, "status": status, "message": "test"}})


class FakeModels:
    def __init__(self, failures):
        self.failures, self.calls = list(failures), 0

    def generate_content(self, **_):
        self.calls += 1
        if self.failures:
            raise self.failures.pop(0)
        return "ok"


@pytest.fixture
def fake(monkeypatch):
    def make(*failures):
        models = FakeModels(failures)
        monkeypatch.setattr(agent, "client", lambda: type("C", (), {"models": models})())
        monkeypatch.setattr(agent, "RETRY_DELAYS_S", (0, 0, 0))
        return models
    return make


def run():
    return asyncio.run(agent.generate("gemini-test", "hi", None))


def test_transient_errors_are_retried(fake):
    models = fake(api_error(503, "UNAVAILABLE"), api_error(429, "RESOURCE_EXHAUSTED"))
    assert run() == "ok" and models.calls == 3


def test_lasting_rate_limit_gives_a_clear_message(fake):
    fake(*[api_error(429, "RESOURCE_EXHAUSTED")] * 4)
    with pytest.raises(HTTPException) as e:
        run()
    assert e.value.status_code == 503 and "rate-limited" in e.value.detail


def test_permanent_errors_are_not_retried(fake):
    models = fake(api_error(404, "NOT_FOUND"))
    with pytest.raises(HTTPException) as e:
        run()
    assert models.calls == 1 and e.value.status_code == 502 and "not available" in e.value.detail
