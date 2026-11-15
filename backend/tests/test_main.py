"""Backend start-up: the access token stays the same across restarts, and a second start
on a busy port stops instead of printing a token that no server uses."""
import os
import stat

import pytest

from backend import __main__ as start


@pytest.fixture
def env(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    for key in ("CANDEX_API_KEY", "CANDEX_API_KEY_FILE", "CANDEX_EPHEMERAL_TOKEN", "RENDER"):
        monkeypatch.delenv(key, raising=False)
    monkeypatch.setattr(start, "port_in_use", lambda *a, **k: False)
    runs = []
    monkeypatch.setattr(start.uvicorn, "run", lambda *a, **k: runs.append(k))
    return tmp_path, runs


def test_default_token_file_is_created_once_and_reused(env, monkeypatch):
    home, runs = env
    start.main()
    path = home / "candex-data" / ".candex-token"
    first = path.read_text().strip()
    assert len(first) >= 24 and os.environ["CANDEX_API_KEY"] == first
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    monkeypatch.delenv("CANDEX_API_KEY")
    monkeypatch.delenv("CANDEX_API_KEY_FILE")
    start.main()
    assert os.environ["CANDEX_API_KEY"] == first, "the token must not change on restart"
    assert len(runs) == 2 and runs[0]["host"] == "127.0.0.1"


def test_ephemeral_token_only_when_asked(env, monkeypatch):
    home, _ = env
    monkeypatch.setenv("CANDEX_EPHEMERAL_TOKEN", "1")
    start.main()
    assert not (home / "candex-data" / ".candex-token").exists()
    assert len(os.environ["CANDEX_API_KEY"]) >= 24


def test_second_start_on_busy_port_stops_without_a_token(env, monkeypatch, capsys):
    _, runs = env
    monkeypatch.setattr(start, "port_in_use", lambda *a, **k: True)
    with pytest.raises(SystemExit) as stop:
        start.main()
    assert "already running" in str(stop.value) and ".candex-token" in str(stop.value)
    assert runs == [] and "CANDEX_API_KEY" not in os.environ
    assert "token" not in capsys.readouterr().out.lower()


def test_on_render_without_a_key_it_warns_and_prints_a_temporary_token(env, monkeypatch, capsys):
    home, _ = env
    monkeypatch.setenv("RENDER", "true")
    start.main()
    out = capsys.readouterr().out
    assert "Set CANDEX_API_KEY" in out and os.environ["CANDEX_API_KEY"] in out
    assert not (home / "candex-data" / ".candex-token").exists()


def test_on_render_with_a_key_it_uses_it(env, monkeypatch):
    monkeypatch.setenv("RENDER", "true")
    monkeypatch.setenv("CANDEX_API_KEY", "k" * 32)
    start.main()
    assert os.environ["CANDEX_API_KEY"] == "k" * 32
