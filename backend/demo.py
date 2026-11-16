"""Demo scans the doctor can pick instead of uploading: the public LIDC-IDRI files in demo-data/
(the team's FINAL DEMO CT and FINAL DEMO XRAY). The server reads them itself, so nothing is downloaded
to the browser and sent back. Only names like LIDC-IDRI-0002 inside demo-data/ can be read."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import APIRouter, HTTPException

ROOT = Path(__file__).resolve().parents[1]
CT_DIR = ROOT / "demo-data" / "ct-uploads"
XRAY_DIR = ROOT / "demo-data" / "chest-xrays"
# Saved CT analyses of the demo CTs (an earlier live run), shown without re-running Gemini.
RESULTS_DIR = ROOT / "demo-data" / "ct-results"
NAME = re.compile(r"LIDC-IDRI-\d{4}")
router = APIRouter(prefix="/api/demo")


def _ct_dirs():
    return sorted(p for p in CT_DIR.glob("LIDC-IDRI-*") if p.is_dir() and NAME.fullmatch(p.name)) if CT_DIR.is_dir() else []


def _xray_files():
    return sorted(p for p in XRAY_DIR.glob("LIDC-IDRI-*.dcm") if p.is_file() and NAME.fullmatch(p.stem)) if XRAY_DIR.is_dir() else []


@router.get("/files")
async def files():
    """The demo scans available on this server (public research data, no patient information)."""
    from .agent import gemini_key
    ct = [{"id": d.name, "slices": len(list(d.glob("*.dcm"))), "mb": round(sum(f.stat().st_size for f in d.glob("*.dcm")) / 1e6, 1),
           "saved": (RESULTS_DIR / f"{d.name}.json").is_file()} for d in _ct_dirs()]
    xray = [{"id": f.stem, "mb": round(f.stat().st_size / 1e6, 1)} for f in _xray_files()]
    return {"ct": [c for c in ct if c["slices"]], "xray": xray, "liveAi": bool(gemini_key()),
            "source": "LIDC-IDRI, The Cancer Imaging Archive (CC BY 3.0), doi:10.7937/K9/TCIA.2015.LO9QL9SX"}


def ct_paths(case: str) -> list[str]:
    if not NAME.fullmatch(case or ""):
        raise HTTPException(422, "Unknown demo CT.")
    d = CT_DIR / case
    paths = sorted(str(p) for p in d.glob("*.dcm")) if d.is_dir() else []
    if not paths:
        raise HTTPException(404, "This demo CT is not available on this server.")
    return paths


def xray_bytes(name: str) -> bytes:
    if not NAME.fullmatch(name or ""):
        raise HTTPException(422, "Unknown demo X-ray.")
    f = XRAY_DIR / f"{name}.dcm"
    if not f.is_file():
        raise HTTPException(404, "This demo X-ray is not available on this server.")
    return f.read_bytes()


def saved_ct_result(case: str):
    """The saved analysis of a demo CT, or None. It carries "saved": {"at", "case"} so the page can label it."""
    if not NAME.fullmatch(case or ""):
        return None
    f = RESULTS_DIR / f"{case}.json"
    if not f.is_file():
        return None
    import json
    return json.loads(f.read_text())
