"""Uploaded chest CT -> closest public LIDC-IDRI reference study (research prototype).

Pipeline (each step's raw output is returned, so the clinician sees the data the
AI summary was written from, as with the chest X-ray summary):
  1. Validate the uploaded DICOM series (CT, one series, axial). Identifiers are
     never read into the result; files are processed in memory and discarded.
  2. Find: 24 slab maximum-intensity views (lung window) in one labelled montage;
     Gemini (vision) picks the slab with the most suspicious nodule.
  3. Read: 11 full-resolution lung-window slices around it + 1 soft-tissue slice;
     Gemini reads the nodule (same schema as the clinical agent's CT read).
  4. Match (deterministic): every public study is scored on nodule size, approx.
     Lung-RADS band, side and composition; the weights are shown with the scores.
  5. Compare: Gemini describes similarities/differences between the uploaded key
     slice and the closest study's key slice (EN + FI).
  6. Summarise the raw data (EN + FI); an independent reviewer checks the summary
     against the raw data, numbers are checked automatically (one redraft).
The clinician then reviews and approves it in the browser before it is used.
"""
from __future__ import annotations

import asyncio
import base64
import io
import json
import math
import time
from typing import List, Literal, Optional

import importlib
import os

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile
from pydantic import BaseModel, Field

from .agent import (CHAT_MODEL, LANG, LIDC_DIR, ROOT, VISION_MODEL, CtRead, generate, require_token,
                    unverified_numbers)

router = APIRouter(prefix="/api/ct")
MAX_SLICES, MIN_SLICES = 800, 20
MAX_SLICE_BYTES = 4 * 1024 * 1024
BANDS = ["2", "3", "4A", "4B", "4X-like"]
WEIGHTS = {"size": 0.5, "band": 0.25, "side": 0.15, "composition": 0.10}
_slot = asyncio.Semaphore(1)  # one CT comparison at a time (memory on a laptop)
# Size is measured from the pixels (backend/ct_measure.py); the module is swappable for validation.
MEASURE = importlib.import_module(os.getenv("CANDEX_CT_MEASURE", "backend.ct_measure"))


# ---------- DICOM series ----------
def load_series(blobs: List[bytes]):
    import numpy as np
    import pydicom
    series = {}
    for b in blobs:
        try:
            ds = pydicom.dcmread(io.BytesIO(b))
        except Exception:
            continue
        if str(ds.get("Modality", "")) != "CT" or "PixelData" not in ds or not hasattr(ds, "ImagePositionPatient"):
            continue
        series.setdefault(str(ds.get("SeriesInstanceUID", "")), []).append(ds)
    if not series:
        raise HTTPException(415, "No CT DICOM images were found. Upload the files of one chest CT series (Modality CT).")
    slices = max(series.values(), key=len)
    if len(slices) < MIN_SLICES:
        raise HTTPException(422, f"The series has {len(slices)} images; at least {MIN_SLICES} axial slices are needed.")
    slices.sort(key=lambda s: float(s.ImagePositionPatient[2]))
    zs = [float(s.ImagePositionPatient[2]) for s in slices]
    gaps = sorted(abs(b - a) for a, b in zip(zs, zs[1:]))
    spacing = gaps[len(gaps) // 2] if gaps else float(slices[0].get("SliceThickness", 0) or 0)
    px = float(slices[0].PixelSpacing[0])
    vol = []
    for s in slices:
        arr = s.pixel_array.astype(np.float32) * float(s.get("RescaleSlope", 1) or 1) + float(s.get("RescaleIntercept", 0) or 0)
        if arr.shape != (int(slices[0].Rows), int(slices[0].Columns)):
            raise HTTPException(422, "The slices have different sizes; upload one axial CT series.")
        vol.append(arr)
    vol = np.stack(vol)
    meta = {"slices": len(slices), "sliceSpacingMm": round(spacing, 2), "sliceThicknessMm": float(slices[0].get("SliceThickness", 0) or 0),
            "pixelMm": round(px, 3), "matrix": f"{int(slices[0].Rows)} x {int(slices[0].Columns)}",
            "zRangeMm": round(zs[-1] - zs[0], 1), "seriesInFiles": len(series)}
    return vol, zs, meta


def window(arr, level=-600, width=1500):
    import numpy as np
    return np.clip((arr - (level - width / 2)) / width * 255, 0, 255).astype(np.uint8)


def png(img, size=None, fmt="PNG", quality=85):
    from PIL import Image
    im = Image.fromarray(img)
    if size:
        im = im.resize((size, size))
    buf = io.BytesIO(); im.save(buf, format=fmt, **({"quality": quality} if fmt == "JPEG" else {})); return buf.getvalue()


def body_box(vol):
    """Bounding box of the body (HU > -400) on the middle slices, so the lungs fill the views."""
    import numpy as np
    mid = vol[vol.shape[0] // 4: 3 * vol.shape[0] // 4].max(axis=0) > -400
    rows, cols = np.where(mid.any(axis=1))[0], np.where(mid.any(axis=0))[0]
    if len(rows) < 10 or len(cols) < 10:
        return 0, vol.shape[1], 0, vol.shape[2]
    pad = 8
    return max(0, rows[0] - pad), min(vol.shape[1], rows[-1] + pad), max(0, cols[0] - pad), min(vol.shape[2], cols[-1] + pad)


def montage(vol, tiles=24, tile=384, per_sheet=12):
    """Slab maximum-intensity views (lung window), cropped to the body, labelled 1..tiles, on two sheets."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont
    n = vol.shape[0]
    r0, r1, c0, c1 = body_box(vol)
    edges = np.linspace(0, n, tiles + 1).astype(int)
    cols = 4; rows = math.ceil(per_sheet / cols)
    try:
        font = ImageFont.load_default(size=30)
    except TypeError:
        font = ImageFont.load_default()
    sheets, slabs, small = [], [], []
    for start in range(0, tiles, per_sheet):
        sheet = Image.new("L", (cols * tile, rows * tile), 0)
        draw = ImageDraw.Draw(sheet)
        for k, i in enumerate(range(start, min(tiles, start + per_sheet))):
            a, b = edges[i], max(edges[i + 1], edges[i] + 1)
            mip = window(vol[a:b, r0:r1, c0:c1].max(axis=0))
            x, y = (k % cols) * tile, (k // cols) * tile
            sheet.paste(Image.fromarray(mip).resize((tile, tile)), (x, y))
            draw.text((x + 8, y + 6), str(i + 1), fill=255, font=font, stroke_width=3, stroke_fill=0)
            slabs.append((int(a), int(b)))
        buf = io.BytesIO(); sheet.save(buf, format="PNG"); sheets.append(buf.getvalue())
        sm = io.BytesIO(); sheet.resize((sheet.width // 3, sheet.height // 3)).save(sm, format="JPEG", quality=70); small.append(sm.getvalue())
    return sheets, slabs, small


# ---------- Public reference studies ----------
def reference_cases():
    text = (LIDC_DIR / "cases.js").read_text()
    cases = json.loads(text[text.index("{"):text.rindex("}") + 1])
    out = []
    for cid, c in cases.items():
        main = c["nodules"][0]
        centre = c["frames"][c["centre"]]
        pts = [p for o in centre.get("outlines", []) if o.get("n") == 0 for p in o["pts"]]
        side = None
        if pts:
            cx = sum(p[0] for p in pts) / len(pts)
            side = "right" if cx < 192 else "left"  # image left = patient right
        tex = main.get("texture", 5)
        comp = "solid" if tex >= 4 else "part-solid" if tex >= 2.5 else "ground-glass"
        out.append({"caseId": cid, "diameter": main["diameter"], "band": c["band"], "side": side, "composition": comp,
                    "readers": main.get("readers"), "keyImage": centre["src"]})
    return out


def band_of(read: dict) -> Optional[str]:
    lr = read.get("lung_rads")
    return {"2": "2", "3": "3", "4A": "4A", "4B": "4B", "4X": "4X-like", "1": "2"}.get(lr)


def match(read: dict, refs: list) -> list:
    """Lower total = closer. Components are on 0..1 scales and weighted by WEIGHTS.
    Uses the measured size (and its Lung-RADS band) when the measurement succeeded."""
    found = bool(read.get("nodule_present"))
    m = read.get("measured") if found else None
    d = (m["long_mm"] if m else read.get("long_axis_mm")) if found else None
    b = (MEASURE.lung_rads_by_size(m["mean_mm"]) if m else band_of(read)) if found else "2"
    side = read.get("location", {}).get("side") if found else None
    comp = read.get("composition") if found else None
    rows = []
    for r in refs:
        size = min(1.0, abs(d - r["diameter"]) / max(r["diameter"], 4.0)) if d else (min(1.0, r["diameter"] / 30) if not found else 0.5)
        band = (abs(BANDS.index(b) - BANDS.index(r["band"])) / 4) if b in BANDS and r["band"] in BANDS else 0.5
        side_c = 0.0 if not side or side == "not seen" or not r["side"] else (0.0 if side == r["side"] else 1.0)
        comp_c = 0.0 if not comp or comp == "not applicable" else (0.0 if comp == r["composition"] else 1.0)
        total = WEIGHTS["size"] * size + WEIGHTS["band"] * band + WEIGHTS["side"] * side_c + WEIGHTS["composition"] * comp_c
        rows.append({**r, "score": round(total, 3), "components": {"size": round(size, 3), "band": round(band, 3), "side": side_c, "composition": comp_c},
                     "similarity": round(100 * (1 - total))})
    return sorted(rows, key=lambda x: x["score"])


# ---------- AI steps ----------
class Find(BaseModel):
    candidates: List[int] = Field(description="Up to 3 tile numbers with possible pulmonary nodules, most suspicious first; empty if none")
    side: Literal["right", "left", "not seen"]
    note: str = Field(description="One short sentence on what you saw")


class Box(BaseModel):
    box_2d: List[int] = Field(description="[ymin, xmin, ymax, xmax] of the nodule, normalised 0-1000; empty if no nodule is visible")


SHORT = "2-4 short phrases, at most 10 words each; no caveats or disclaimers (the page shows them)"


class Comparison(BaseModel):
    similarities_en: List[str] = Field(description=SHORT)
    similarities_fi: List[str] = Field(description="The same in natural Finnish")
    differences_en: List[str] = Field(description=SHORT)
    differences_fi: List[str] = Field(description="The same in natural Finnish")


class Summary(BaseModel):
    summary_en: str = Field(description="3-4 sentences in English for a clinician")
    summary_fi: str = Field(description="The same in natural Finnish")
    key_points_en: List[str] = Field(description="3-5 concise bullet points in English, at most 15 words each")
    key_points_fi: List[str] = Field(description="The same in Finnish")


class Review(BaseModel):
    verdict: Literal["consistent with the raw data", "needs changes"]
    issues_en: List[str]
    issues_fi: List[str]


RULES = """Rules: research prototype; the uploaded scan is a de-identified research or test CT and the reference studies are public LIDC-IDRI scans.
Use ONLY the raw data given; quote numbers exactly as given; never invent findings or numbers. The AI read is unvalidated research output
(no diagnosis; it may miss or invent nodules and misstate size). The match score is a simple weighted similarity of nodule features
(size, approximate Lung-RADS band, side, composition), not image-level or clinical similarity, and the closest study is a reference
example, not the patient's scan. No treatment advice; the clinician decides. Name the closest study and its similarity percentage (not the raw score).
Size: when read.measured exists, use that pixel measurement (long x short axis, mm) as the nodule size and say it was measured from the
image; mention the AI's own estimate (long_axis_mm) only as a comparison."""


def jpeg_b64(img, size=384):
    return base64.b64encode(png(img, size, "JPEG")).decode()


@router.post("/compare")
async def compare(files: List[UploadFile] = File(...), confirmed_chest: bool = Form(False), permitted_data: bool = Form(False),
                  authorization: str = Header(default="")):
    require_token(authorization)
    if not confirmed_chest or not permitted_data:
        raise HTTPException(422, "Confirm a chest CT series and permission to process this de-identified research or test image.")
    if len(files) > MAX_SLICES:
        raise HTTPException(413, f"Upload at most {MAX_SLICES} DICOM files (one CT series).")
    if _slot.locked():
        raise HTTPException(429, "Another CT comparison is running. Try again when it finishes.")
    async with _slot:
        t0 = time.time()
        blobs = []
        for f in files:
            b = await f.read(MAX_SLICE_BYTES + 1)
            await f.close()
            if len(b) > MAX_SLICE_BYTES:
                raise HTTPException(413, "A file is larger than 4 MB; upload the DICOM slices of one CT series.")
            blobs.append(b)
        vol, zs, meta = await asyncio.to_thread(load_series, blobs)
        del blobs
        from google.genai import types
        sheets, slabs, sheets_small = await asyncio.to_thread(montage, vol)
        # 2. Find the slab with the most suspicious nodule.
        find_prompt = (f"These two montages show {len(slabs)} numbered slab maximum-intensity views (lung window, about "
                       f"{meta['zRangeMm'] / len(slabs):.0f} mm thick each) of one de-identified research chest CT, from inferior (1) to superior "
                       f"({len(slabs)}). The image's left side is the patient's right. Pulmonary vessels look like branching lines that continue between "
                       "slabs; a nodule is a round or oval focal opacity, often 4-30 mm. List up to 3 tile numbers that may contain a pulmonary nodule, "
                       "most suspicious first. Return an empty list only if you see none. Research only.")
        r = await generate(VISION_MODEL, [*[types.Part.from_bytes(data=sh, mime_type="image/png") for sh in sheets], find_prompt],
                           types.GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=Find))
        found = r.parsed if isinstance(r.parsed, Find) else Find.model_validate_json(r.text)
        candidates = [t for t in found.candidates if 1 <= t <= len(slabs)][:3]
        px = meta["pixelMm"] * vol.shape[2] / 512

        async def read_at(tile_no):
            a, b = slabs[tile_no - 1] if tile_no else (0, vol.shape[0])
            centre = (a + b) // 2
            idx = sorted({min(vol.shape[0] - 1, max(0, centre + k)) for k in range(-5, 6)})
            parts = [types.Part.from_bytes(data=png(window(vol[i]), 512), mime_type="image/png") for i in idx]
            parts.append(types.Part.from_bytes(data=png(window(vol[centre], 40, 400), 512), mime_type="image/png"))
            labels = "; ".join(f"Image {n + 1}: axial slice (z = {zs[i]:.1f} mm), lung window" for n, i in enumerate(idx))
            read_prompt = (f"These are axial slices from one de-identified research chest CT, inferior to superior: {labels}; Image {len(idx) + 1}: "
                           f"middle slice, soft-tissue window. Slice spacing {meta['sliceSpacingMm']} mm. Each image is 512 x 512 pixels and one pixel is "
                           f"{px:.3f} mm. The image's left side is the patient's right. Assess the most significant pulmonary nodule, if any, as a "
                           "radiologist would on a baseline lung-cancer screening CT. Measure in millimetres. If you cannot see a nodule, say so; do not "
                           "guess. Use Lung-RADS v2022. Research only, not used for patient care.")
            rr = await generate(VISION_MODEL, [*parts, read_prompt], types.GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=CtRead))
            return (rr.parsed if isinstance(rr.parsed, CtRead) else CtRead.model_validate_json(rr.text)).model_dump(), idx, centre

        # 3. Read the nodule on full-resolution slices: first candidate; the second if the first shows none.
        tile = candidates[0] if candidates else None
        read, idx, centre = await read_at(tile)
        tried = [tile]
        if not read["nodule_present"] and len(candidates) > 1:
            read2, idx2, centre2 = await read_at(candidates[1])
            tried.append(candidates[1])
            if read2["nodule_present"]:
                read, idx, centre, tile = read2, idx2, centre2, candidates[1]
        n = (read.pop("image_number") or 0) - 1
        read.pop("answer", None)
        key = idx[n] if 0 <= n < len(idx) else centre
        read["keySliceZ"] = round(zs[key], 1)
        # 3b. Measure from the pixels: Gemini boxes the nodule on the key slice; the size is measured deterministically.
        read["measured"], read["box"], why = None, None, []
        if read["nodule_present"]:
            bp = (f"This is one axial chest CT slice (lung window, 512 x 512; the image's left is the patient's right). Return the bounding box of the "
                  f"pulmonary nodule described as: {read['location']['side']} lung, about {read.get('long_axis_mm') or 'unknown'} mm, {read['composition']}. "
                  "Use box_2d = [ymin, xmin, ymax, xmax] normalised to 0-1000. Return an empty list if you cannot see it.")
            rb = await generate(VISION_MODEL, [types.Part.from_bytes(data=png(window(vol[key]), 512), mime_type="image/png"), bp],
                                types.GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=Box))
            box = (rb.parsed if isinstance(rb.parsed, Box) else Box.model_validate_json(rb.text)).box_2d
            if len(box) == 4 and all(0 <= v <= 1000 for v in box) and box[2] > box[0] and box[3] > box[1]:
                rows_px, cols_px = vol.shape[1], vol.shape[2]
                centre_rc = ((box[0] + box[2]) / 2000 * rows_px, (box[1] + box[3]) / 2000 * cols_px)
                read["box"] = box
                read["measured"] = await asyncio.to_thread(MEASURE.measure_nodule, vol, meta["pixelMm"], meta["sliceSpacingMm"], key, centre_rc, why=why)
                if read["measured"]:  # plain JSON numbers (the measurement may return numpy scalars)
                    read["measured"] = {k: (round(float(v), 1) if isinstance(v, float) or (hasattr(v, "item") and isinstance(v.item(), float)) else (v.item() if hasattr(v, "item") else v)) for k, v in read["measured"].items()}
        if read["nodule_present"] and not read["measured"]:
            read["measureNote"] = why[-1] if why else "no box from the AI"
        # 4. Deterministic match against the public studies.
        matches = match(read, reference_cases())
        best = matches[0]
        # 5. AI comparison of the key slices.
        ref_img = (ROOT / best["keyImage"]).read_bytes()
        size_txt = (f"measured {read['measured']['long_mm']} x {read['measured']['short_mm']} mm from the pixels" if read.get("measured") else f"AI estimate {read.get('long_axis_mm')} mm")
        cmp_prompt = (f"Size of the uploaded nodule: {size_txt}. "
                      "Image 1 is a key axial slice (lung window) from an uploaded de-identified research chest CT. Image 2 is the key slice of the "
                      f"closest public reference study {best['caseId']} (LIDC-IDRI), where the radiologists' main nodule is {best['diameter']} mm, "
                      f"{best['composition']}, approx. Lung-RADS {best['band']}, {best['side'] or 'side unknown'} lung. "
                      f"The AI read of the uploaded scan: {json.dumps({k: read[k] for k in ('nodule_present', 'location', 'long_axis_mm', 'composition', 'margin', 'lung_rads')})}. "
                      "List the visible similarities and differences between the two (nodule appearance, size, location, surrounding lung), each as a short phrase of at most 10 words. "
                      "In English and natural Finnish. No diagnosis. " + RULES)
        r = await generate(VISION_MODEL, [types.Part.from_bytes(data=png(window(vol[key]), 512), mime_type="image/png"),
                                          types.Part.from_bytes(data=ref_img, mime_type="image/jpeg"), cmp_prompt],
                           types.GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=Comparison))
        comparison = (r.parsed if isinstance(r.parsed, Comparison) else Comparison.model_validate_json(r.text)).model_dump()
        # 6. Summary of the raw data + independent review (numbers checked).
        raw = {"series": meta, "find": {"candidates": candidates, "readTiles": tried, "tile": tile, "tiles": len(slabs), "side": found.side, "note": found.note},
               "read": read, "matching": {"weights": WEIGHTS, "top": [{k: m[k] for k in ("caseId", "score", "similarity", "components", "diameter", "band", "side", "composition")} for m in matches[:3]]},
               "comparison": {"similarities": comparison["similarities_en"], "differences": comparison["differences_en"]}}
        data = json.dumps(raw)
        feedback, attempts = "", 0
        while True:
            attempts += 1
            s = await generate(CHAT_MODEL, "Summarise the raw data." + feedback, types.GenerateContentConfig(
                system_instruction=f"You summarise a CT comparison for a clinician, in English and in natural Finnish (decimal commas in Finnish).\n{RULES}\n\nRAW DATA (JSON):\n{data}",
                temperature=0, response_mime_type="application/json", response_schema=Summary))
            summ = s.parsed if isinstance(s.parsed, Summary) else Summary.model_validate_json(s.text)
            bad = unverified_numbers(summ.summary_en + " " + " ".join(summ.key_points_en), data)
            rv = await generate(CHAT_MODEL, "Review.", types.GenerateContentConfig(
                system_instruction=("You are a safety reviewer. Check the SUMMARY against the RAW DATA and RULES only. List every number or claim not in the data, "
                                    "any diagnosis or treatment advice, any suggestion that the reference study is the patient's own scan or that the AI read is validated, "
                                    "and any missing caveat. Return empty lists if there are none.\n"
                                    f"RULES:\n{RULES}\n\nRAW DATA:\n{data}\n\nSUMMARY:\n{summ.model_dump_json()}"),
                temperature=0, response_mime_type="application/json", response_schema=Review))
            review = rv.parsed if isinstance(rv.parsed, Review) else Review.model_validate_json(rv.text)
            if (review.verdict == "consistent with the raw data" and not bad) or attempts == 2:
                break
            feedback = "\nFix these issues from the previous draft:\n- " + "\n- ".join(review.issues_en + [f"number not in the data: {x}" for x in bad])
        result = {
            "raw": raw, "matches": [{k: m[k] for k in ("caseId", "score", "similarity", "components", "diameter", "band", "side", "composition", "readers")} for m in matches],
            "closest": best["caseId"], "comparison": comparison,
            "summary": {"en": summ.summary_en, "fi": summ.summary_fi, "keyPointsEn": summ.key_points_en, "keyPointsFi": summ.key_points_fi},
            "review": {**review.model_dump(), "unverifiedNumbers": bad, "attempts": attempts},
            "images": {"key": jpeg_b64(window(vol[key])), "montage": [base64.b64encode(x).decode() for x in sheets_small], "montageTile": tile},
            "models": {"vision": VISION_MODEL, "text": CHAT_MODEL}, "seconds": round(time.time() - t0, 1),
        }
        del vol
        return result
