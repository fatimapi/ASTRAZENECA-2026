"""Local authenticated inference API and safe same-origin static frontend."""
from __future__ import annotations

import asyncio
import logging
import os
import secrets
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from starlette.concurrency import run_in_threadpool

from .imaging import MAX_FILE_BYTES, ImageRejected, prepare_dicom
from .model import ChestXrayEngine, LIMITATIONS, ModelUnavailable

# pydicom may include raw tag values in both warnings and logging records.
# Configure once at service startup, rather than toggling logging per request.
dicom_logger = logging.getLogger("pydicom")
dicom_logger.handlers.clear()
dicom_logger.addHandler(logging.NullHandler())
dicom_logger.propagate = False

ROOT = Path(__file__).resolve().parents[1]
MAX_BODY_BYTES = MAX_FILE_BYTES + 128 * 1024
engine = ChestXrayEngine()
analysis_slot = asyncio.Semaphore(1)


def configured_key():
    value = os.getenv("CANDEX_API_KEY", "")
    return value if len(value) >= 24 and value.isascii() and not any(c.isspace() for c in value) else ""


class InferenceRequestGuard:
    """Authenticate and bound the ASGI body BEFORE multipart parsing/spooling."""
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))

        async def private_send(message):
            if message["type"] == "http.response.start" and scope.get("path", "").startswith("/api/"):
                message.setdefault("headers", []).extend([(b"cache-control", b"no-store"), (b"pragma", b"no-cache"), (b"x-content-type-options", b"nosniff")])
            await send(message)

        if scope.get("path") == "/api/analyze" and scope.get("method") == "POST":
            key = configured_key()
            if not key:
                return await JSONResponse({"detail": "The backend API key is not configured. Start with python -m backend or set CANDEX_API_KEY to at least 24 characters."}, status_code=503)(scope, receive, private_send)
            auth = headers.get(b"authorization", b"")
            if not secrets.compare_digest(auth, ("Bearer " + key).encode("ascii")):
                return await JSONResponse({"detail": "A valid backend access token is required."}, status_code=401)(scope, receive, private_send)
            try:
                length = int(headers.get(b"content-length", b"0"))
            except ValueError:
                length = MAX_BODY_BYTES + 1
            if length > MAX_BODY_BYTES:
                return await JSONResponse({"detail": "Upload is too large. The DICOM file limit is 20 MiB."}, status_code=413)(scope, receive, private_send)
            chunks, total = [], 0
            while True:
                message = await receive()
                if message["type"] == "http.disconnect":
                    return
                chunk = message.get("body", b"")
                total += len(chunk)
                if total > MAX_BODY_BYTES:
                    return await JSONResponse({"detail": "Upload is too large. The DICOM file limit is 20 MiB."}, status_code=413)(scope, receive, private_send)
                chunks.append(chunk)
                if not message.get("more_body", False):
                    break
            body = b"".join(chunks)
            delivered = False

            async def replay():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            return await self.app(scope, replay, private_send)
        return await self.app(scope, receive, private_send)


app = FastAPI(title="Candex DICOM research", docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(InferenceRequestGuard)
origins = []
for origin in os.getenv("CANDEX_ALLOWED_ORIGINS", "").split(","):
    origin = origin.strip().rstrip("/")
    if not origin:
        continue
    parsed = urlsplit(origin)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc or parsed.path or "*" in origin or parsed.username:
        raise RuntimeError("CANDEX_ALLOWED_ORIGINS must contain explicit http(s) origins, without paths, credentials or wildcards.")
    origins.append(origin)
app.add_middleware(CORSMiddleware, allow_origins=origins, allow_credentials=False, allow_methods=["GET", "POST"], allow_headers=["Authorization", "Content-Type"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Candex DICOM research", "model": {**engine.metadata(), "loaded": engine.loaded, "supported_modalities": ["CR", "DX"]}, "limitations": LIMITATIONS}


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...), confirmed_chest: bool = Form(False), permitted_data: bool = Form(False)):
    if not confirmed_chest or not permitted_data:
        await file.close()
        raise HTTPException(422, "Confirm a frontal chest X-ray and permission to process the research/test image.")
    if analysis_slot.locked():
        await file.close()
        raise HTTPException(429, "The local model is processing another request. Try again after it finishes.")
    async with analysis_slot:
        try:
            content = await file.read(MAX_FILE_BYTES + 1)
            if len(content) > MAX_FILE_BYTES:
                raise HTTPException(413, "The DICOM file limit is 20 MiB.")
            prepared = await run_in_threadpool(prepare_dicom, content, confirmed_chest)
            findings = await run_in_threadpool(engine.predict, prepared.pixels_255)
            metadata = engine.metadata()
            # No identity, original filename, study UID or source metadata is returned.
            report = "CANDEX — UNAPPROVED RESEARCH MODEL OUTPUT\n\n" + metadata["name"] + " / " + metadata["weights"] + "\nFrontal chest X-ray classification\n\n" + "\n".join(f"{item['label']}: {item['score']:.4f} (uncalibrated model score)" for item in findings) + "\n\nNo clinical threshold, localisation or cancer diagnosis is provided. A qualified clinician must review the original study and all model limitations."
            return {"analysis_id": str(uuid.uuid4()), "status": "completed", "model": metadata, "image": {"width": prepared.width, "height": prepared.height, "modality": prepared.modality, "preview_png_base64": prepared.preview_png_base64}, "findings": findings, "limitations": LIMITATIONS, "report_draft": report, "requires_clinician_review": True}
        except ImageRejected as exc:
            raise HTTPException(415, str(exc)) from None
        except ModelUnavailable as exc:
            raise HTTPException(503, str(exc)) from None
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(500, "Analysis failed. No findings were generated; check the backend setup.") from None
        finally:
            await file.close()


@app.get("/")
async def index():
    return FileResponse(ROOT / "index.html", headers={"Cache-Control": "no-store"})


@app.get("/{asset}")
async def frontend_asset(asset: str):
    candidate = (ROOT / asset).resolve()
    if asset.startswith(".") or candidate.parent != ROOT or candidate.suffix.lower() not in {".html", ".js", ".css", ".svg"} or not candidate.is_file():
        raise HTTPException(404, "Not found")
    return FileResponse(candidate, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})
