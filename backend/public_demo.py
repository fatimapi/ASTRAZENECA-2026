"""Public demo mode: visitors can run the X-ray and CT AI on the built-in demo scans
(demo-data/, public LIDC-IDRI research data) without the backend token.

- Only the demo files: an upload still needs the backend token, so nobody can send
  their own (possibly real patient) images through the public site.
- Rate-limited per visitor and for the whole server, so the Gemini quota cannot be drained.
- The X-ray summary accepts only the classifier's own label names.
- Turn it off with CANDEX_PUBLIC_DEMO=0; with it off, everything needs the token as before.
"""
from __future__ import annotations

import os
import secrets
import time
from collections import deque

from fastapi import HTTPException

# Requests without the token carry only a demo name and two check boxes, never a file.
SMALL_BODY = 64 * 1024

# (requests, seconds): per visitor, and for the whole server.
PER_VISITOR = {"xray": (10, 3600), "ct": (3, 3600), "cxr-summary": (10, 3600)}
WHOLE_SERVER = {"xray": (200, 86400), "ct": (25, 86400), "cxr-summary": (200, 86400)}
MAX_VISITORS = 5000

_hits: dict[tuple[str, str], deque] = {}


def enabled() -> bool:
    return os.getenv("CANDEX_PUBLIC_DEMO", "1").strip().lower() not in ("0", "false", "no", "off")


def has_token(authorization) -> bool:
    """True when the request carries the configured backend token."""
    expected = os.getenv("CANDEX_API_KEY", "")
    if len(expected) < 24:
        return False
    given = authorization if isinstance(authorization, bytes) else (authorization or "").encode()
    return secrets.compare_digest(given, f"Bearer {expected}".encode())


def visitor(scope) -> str:
    """The visitor's address: the last X-Forwarded-For entry (added by the host's proxy), else the socket peer."""
    headers = dict(scope.get("headers", []))
    forwarded = headers.get(b"x-forwarded-for", b"").decode("latin-1")
    if forwarded:
        return forwarded.split(",")[-1].strip()[:64]
    client = scope.get("client")
    return str(client[0]) if client else "unknown"


def _take(key: tuple[str, str], limit: int, window: int, now: float) -> bool:
    q = _hits.setdefault(key, deque())
    while q and now - q[0] > window:
        q.popleft()
    if len(q) >= limit:
        return False
    q.append(now)
    return True


def allow(scope, kind: str) -> None:
    """Count one public demo run; raise 429 when the visitor or the whole server is over its limit."""
    now = time.time()
    if len(_hits) > MAX_VISITORS:
        _hits.clear()
    who = visitor(scope)
    v_limit, v_window = PER_VISITOR[kind]
    s_limit, s_window = WHOLE_SERVER[kind]
    if not _take(("server", kind), s_limit, s_window, now):
        raise HTTPException(429, "The public demo has reached today's limit. Try again tomorrow, or use the backend token.")
    if not _take((who, kind), v_limit, v_window, now):
        _hits[("server", kind)].pop()  # this run did not happen
        raise HTTPException(429, "You have used the public demo several times this hour. Try again later, or use the backend token.")


def is_public(request) -> bool:
    return bool(getattr(request.state, "public_demo", False))


UPLOAD_NEEDS_TOKEN = "Uploading your own scan needs the backend token. Without it, choose one of the demo files."
