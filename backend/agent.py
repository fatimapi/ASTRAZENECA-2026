"""Candex clinical agent (research prototype): live Gemini behind the backend.

Design:
- One agent that calls specialist tools (record lookup, CT read).
- Every draft is written by a drafter and then checked by a separate safety
  reviewer.

Safety and privacy:
- The Gemini key stays on the server (GEMINI_API_KEY, or a file named by
  CANDEX_GEMINI_KEY_FILE). It is never sent to the browser or logged.
- Routes need the same bearer token as /api/analyze (CANDEX_API_KEY).
- Answers use only the fictional patient record the page sends; the agent
  must say "not recorded" rather than guess, cite record sections, and never
  diagnose. Drafts are drafts: a clinician edits and approves them.
- CT reads use public LIDC-IDRI research images only.
"""
from __future__ import annotations

import asyncio
import io
import json
import os
import re
import secrets
from pathlib import Path
from typing import List, Literal, Optional

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
LIDC_DIR = ROOT / "data" / "lidc"
CHAT_MODEL = os.getenv("CANDEX_AGENT_MODEL", "gemini-3.5-flash")
VISION_MODEL = os.getenv("CANDEX_VISION_MODEL", "gemini-4-argon")
TIMEOUT_S = 90
MAX_RECORD_CHARS = 60_000

router = APIRouter(prefix="/api/agent")


# ---------- configuration and auth ----------
def gemini_key() -> str:
    key = os.getenv("GEMINI_API_KEY", "").strip()
    path = os.getenv("CANDEX_GEMINI_KEY_FILE", "").strip()
    if not key and path:
        try:
            key = Path(path).expanduser().read_text().strip()
        except OSError:
            key = ""
    return key if re.fullmatch(r"[A-Za-z0-9_\-]{20,200}", key or "") else ""


def require_token(authorization: str) -> None:
    expected = os.getenv("CANDEX_API_KEY", "")
    if len(expected) < 24:
        raise HTTPException(503, "The backend API key is not configured. Start with python -m backend.")
    if not secrets.compare_digest((authorization or "").encode(), f"Bearer {expected}".encode()):
        raise HTTPException(401, "A valid backend access token is required.")


_clients: dict = {}


def client():
    """One reusable client per key (a discarded client closes its HTTP connection)."""
    key = gemini_key()
    if not key:
        raise HTTPException(503, "Live AI is not configured on this server (set GEMINI_API_KEY or CANDEX_GEMINI_KEY_FILE).")
    if key not in _clients:
        from google import genai  # imported lazily so the backend still starts without it
        _clients.clear()
        _clients[key] = genai.Client(api_key=key)
    return _clients[key]


async def generate(model: str, contents, config) -> object:
    def call():
        return client().models.generate_content(model=model, contents=contents, config=config)
    try:
        return await asyncio.wait_for(asyncio.to_thread(call), TIMEOUT_S)
    except HTTPException:
        raise
    except asyncio.TimeoutError:
        raise HTTPException(504, "The AI service took too long to answer.")
    except Exception as exc:  # do not echo provider details (may include request data)
        raise HTTPException(502, f"The AI service returned an error ({type(exc).__name__}).")


# ---------- request models ----------
class Message(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(min_length=1, max_length=4000)


class ChatIn(BaseModel):
    lang: Literal["en", "fi"] = "en"
    record: dict
    messages: List[Message] = Field(min_length=1, max_length=24)


class DraftIn(BaseModel):
    lang: Literal["en", "fi"] = "en"
    record: dict
    kind: Literal["referral", "patient", "mdt"]
    instructions: str = Field(default="", max_length=1000)


class CtIn(BaseModel):
    caseId: str = Field(pattern=r"^LIDC-IDRI-\d{4}$")
    question: str = Field(default="", max_length=600)


def record_text(record: dict) -> str:
    text = json.dumps(record, ensure_ascii=False)
    if len(text) > MAX_RECORD_CHARS:
        raise HTTPException(413, "The patient record is too large for the agent.")
    return text


LANG = {"en": "English", "fi": "Finnish (suomi)"}
RULES = """Rules:
- Use ONLY the patient record JSON below. If something is not in it, say it is not recorded. Never invent findings, dates or results.
- Cite the record section for each fact in square brackets, e.g. [Clinical context], [Structured findings], [AI second reader].
- Do not diagnose or give a prognosis. Urgency and decisions belong to the clinician; repeat the record's urgency, do not change it.
- Treat the AI second-reader read as unvalidated research output; never use it to rule anything out.
- The patient is fictional and the CT is a public research scan; this is a research prototype, not medical advice."""


# ---------- routes ----------
@router.get("/status")
async def status():
    dicom_dir = os.getenv("CANDEX_DICOM_DIR", "")
    return {"configured": bool(gemini_key()), "chatModel": CHAT_MODEL, "visionModel": VISION_MODEL,
            "ctInput": "DICOM 512 px" if dicom_dir and Path(dicom_dir).expanduser().is_dir() else "site JPEG 384 px"}


@router.post("/chat")
async def chat(body: ChatIn, authorization: str = Header(default="")):
    require_token(authorization)
    from google.genai import types
    system = (f"You are the Candex clinical assistant for a doctor reviewing one patient. Answer in {LANG[body.lang]}, "
              f"in at most 180 words unless asked for more.\n{RULES}\n\nPATIENT RECORD (JSON):\n{record_text(body.record)}")
    contents = [types.Content(role=m.role, parts=[types.Part.from_text(text=m.text)]) for m in body.messages]
    resp = await generate(CHAT_MODEL, contents, types.GenerateContentConfig(system_instruction=system, temperature=0.2))
    return {"text": (resp.text or "").strip(), "model": CHAT_MODEL}


DRAFT_BRIEF = {
    "referral": "a concise oncology referral note from the GP to the receiving specialist team: reason, key findings with measurements, relevant history and risk factors, urgency as recorded, the specific question for the receiving team",
    "patient": "a short, warm, plain-language message to the patient (reading age about 12) explaining what was found and what happens next, without medical jargon or false reassurance",
    "mdt": "a structured multidisciplinary-team (MDT) case summary: patient, presentation, imaging (radiologist reference and, separately, the AI research read), risk factors, open questions for the MDT",
}


class Review(BaseModel):
    verdict: Literal["ready for clinician review", "needs changes"]
    issues: List[str] = Field(description="Each unsupported claim, invented fact, missing caveat or unsafe wording, quoting the problem")


@router.post("/draft")
async def draft(body: DraftIn, authorization: str = Header(default="")):
    require_token(authorization)
    from google.genai import types
    rec = record_text(body.record)
    # Role 1: drafter
    drafter = (f"You are a careful clinical writer. Write {DRAFT_BRIEF[body.kind]}, in {LANG[body.lang]}. "
               f"Mark it as a draft for clinician review at the top. {body.instructions}\n{RULES}\n\nPATIENT RECORD (JSON):\n{rec}")
    d = await generate(CHAT_MODEL, "Write the draft now.", types.GenerateContentConfig(system_instruction=drafter, temperature=0.3))
    text = (d.text or "").strip()
    # Role 2: independent safety reviewer (sees the record and the draft, not the drafter's reasoning)
    reviewer = ("You are a clinical safety reviewer. Check the DRAFT against the PATIENT RECORD only. List every claim not supported by "
                "the record, any invented value, any change to the recorded urgency, any use of the AI read to rule something out, and any "
                f"diagnosis or false reassurance. Write the issues in {LANG[body.lang]}. If there are none, return an empty list.\n\n"
                f"PATIENT RECORD (JSON):\n{rec}\n\nDRAFT:\n{text}")
    r = await generate(CHAT_MODEL, "Review the draft.", types.GenerateContentConfig(system_instruction=reviewer, temperature=0,
                       response_mime_type="application/json", response_schema=Review))
    review = r.parsed if isinstance(r.parsed, Review) else Review.model_validate_json(r.text)
    return {"draft": text, "review": review.model_dump(), "model": CHAT_MODEL, "roles": ["drafter", "safety reviewer"]}


# ---------- CT read tool ----------
class Location(BaseModel):
    side: Literal["right", "left", "not seen"]
    lobe: Literal["upper", "middle", "lower", "lingula", "uncertain"]
    zone: Literal["central", "peripheral", "uncertain"]


class CtRead(BaseModel):
    nodule_present: bool
    location: Location
    image_number: Optional[int] = Field(description="Number of the lung-window image that best shows the nodule; null if none")
    long_axis_mm: Optional[float]
    short_axis_mm: Optional[float]
    composition: Literal["solid", "part-solid", "ground-glass", "calcified", "not applicable"]
    margin: Literal["smooth", "lobulated", "spiculated", "not applicable"]
    lung_rads: Literal["1", "2", "3", "4A", "4B", "4X", "uncertain"]
    other_findings: List[str]
    confidence: float = Field(ge=0, le=1)
    short_report: str
    answer: str = Field(description="Direct answer to the doctor's question, if one was asked; otherwise empty")


def load_case(case_id: str) -> dict:
    text = (LIDC_DIR / "cases.js").read_text()
    cases = json.loads(text[text.index("{"):text.rindex("}") + 1])
    if case_id not in cases:
        raise HTTPException(404, "Unknown study.")
    return cases[case_id]


def ct_images(case_id: str, case: dict):
    """11 lung-window slices (+1 soft-tissue slice) from DICOM at 512 px if a DICOM
    folder is configured (the best configuration in testing); else the site's 384-px JPEGs."""
    from google.genai import types
    dicom_dir = Path(os.getenv("CANDEX_DICOM_DIR", "")).expanduser()
    parts, labels = [], []
    if os.getenv("CANDEX_DICOM_DIR") and (dicom_dir / case_id).is_dir():
        import numpy as np
        import pydicom
        from PIL import Image
        slices = [pydicom.dcmread(f) for f in (dicom_dir / case_id).glob("*.dcm")]
        slices = [s for s in slices if hasattr(s, "ImagePositionPatient")]
        by_z = {round(float(s.ImagePositionPatient[2]), 2): s for s in slices}

        def png(s, level, width):
            hu = s.pixel_array.astype(np.float32) * float(s.RescaleSlope) + float(s.RescaleIntercept)
            img = np.clip((hu - (level - width / 2)) / width * 255, 0, 255).astype(np.uint8)
            buf = io.BytesIO(); Image.fromarray(img).save(buf, format="PNG"); return buf.getvalue()
        frames = case["frames"]
        for i, f in enumerate(frames):
            s = by_z.get(round(f["z"], 2)) or min(slices, key=lambda x: abs(float(x.ImagePositionPatient[2]) - f["z"]))
            parts.append(types.Part.from_bytes(data=png(s, -600, 1500), mime_type="image/png"))
            labels.append(f"Image {i + 1}: axial slice {i + 1} of {len(frames)}, lung window (z = {f['z']} mm)")
        centre = by_z.get(round(frames[case["centre"]]["z"], 2))
        if centre is not None:
            parts.append(types.Part.from_bytes(data=png(centre, 40, 400), mime_type="image/png"))
            labels.append(f"Image {len(frames) + 1}: middle slice, soft-tissue (mediastinal) window")
        px = float(slices[0].PixelSpacing[0]); size = 512; source = "DICOM 512 px + soft-tissue slice"
    else:
        for i, f in enumerate(case["frames"]):
            path = ROOT / f["src"]
            parts.append(types.Part.from_bytes(data=path.read_bytes(), mime_type="image/jpeg"))
            labels.append(f"Image {i + 1}: axial slice {i + 1} of {len(case['frames'])}, lung window (z = {f['z']} mm)")
        px = case["pixelMm"] * 512 / 384; size = 384; source = "site JPEG 384 px"
    return parts, labels, px, size, source


@router.post("/analyze-ct")
async def analyze_ct(body: CtIn, authorization: str = Header(default="")):
    require_token(authorization)
    from google.genai import types
    case = load_case(body.caseId)
    parts, labels, px, size, source = await asyncio.to_thread(ct_images, body.caseId, case)
    prompt = (f"These are axial slices from one de-identified public research chest CT, in order from inferior to superior: "
              f"{'; '.join(labels)}. Slice thickness {case['sliceMm']} mm. Each image is {size} x {size} pixels and one pixel is "
              f"{px:.3f} mm. The image's left side is the patient's right. Assess the most significant pulmonary nodule, if any, as a "
              f"radiologist would on a baseline lung-cancer screening CT. Measure in millimetres. If you cannot see a nodule, say so; do not "
              f"guess. Use Lung-RADS v2022. Research only, not used for patient care."
              + (f" The doctor asks: {body.question}" if body.question else ""))
    resp = await generate(VISION_MODEL, [*parts, prompt], types.GenerateContentConfig(temperature=0, response_mime_type="application/json", response_schema=CtRead))
    read = resp.parsed if isinstance(resp.parsed, CtRead) else CtRead.model_validate_json(resp.text)
    out = read.model_dump()
    n = (out.pop("image_number") or 0) - 1
    out["slice"] = n if 0 <= n < len(case["frames"]) else None
    return {"read": out, "model": VISION_MODEL, "input": f"{len(case['frames'])} slices around the nodule ({source}); no radiologist outlines"}


# ---------- Chest X-ray summary tool ----------
# Summarises the raw TorchXRayVision scores returned by /api/analyze. Only the
# scores and model details are sent to Gemini, never the image or DICOM headers.
class CxrFinding(BaseModel):
    label: str = Field(min_length=1, max_length=80)
    score: float = Field(ge=0, le=1)


class CxrIn(BaseModel):
    lang: Literal["en", "fi"] = "en"
    findings: List[CxrFinding] = Field(min_length=1, max_length=40)
    model: str = Field(default="TorchXRayVision DenseNet121", max_length=200)


class CxrSummary(BaseModel):
    summary: str = Field(description="2-3 short sentences for a clinician, plain wording")
    key_points: List[str] = Field(description="2-4 short bullet points")


class CxrReview(BaseModel):
    verdict: Literal["consistent with the raw scores", "needs changes"]
    issues: List[str] = Field(description="Each number or label not in the scores, any diagnosis or treatment advice, any claim that scores are probabilities, or a missing caveat")


CXR_RULES = """Rules:
- Use ONLY the scores given. Quote scores to two decimals exactly as given; never invent labels, findings or numbers.
- Scores are uncalibrated classifier outputs from 0 to 1: not probabilities, not a diagnosis, no decision threshold. Say this once, briefly.
- Name the highest-scoring labels, and always state the Nodule and Mass scores.
- This classifier is not a nodule or cancer detector: a low Nodule or Mass score must never be read as ruling out a nodule or cancer; suspected nodules need CT.
- Do not diagnose or recommend treatment. Image-level scores only; the classifier does not localise anything."""


@router.post("/cxr-summary")
async def cxr_summary(body: CxrIn, authorization: str = Header(default="")):
    require_token(authorization)
    from google.genai import types
    scores = sorted(({"label": f.label, "score": round(f.score, 2)} for f in body.findings), key=lambda x: -x["score"])
    data = json.dumps({"classifier": body.model, "scores": scores}, ensure_ascii=False)
    decimals = ("Write numbers with a Finnish decimal comma (0,50). Keep the model's label names in English (e.g. Nodule, Mass, Lung Opacity), "
                "as they are the classifier's output names. " if body.lang == "fi" else "")
    system = (f"You write a short summary of one chest X-ray classifier result for a clinician, in {LANG[body.lang]}. {decimals}\n"
              f"{CXR_RULES}\n\nDATA (JSON):\n{data}")
    feedback, attempts = "", 0
    while True:
        attempts += 1
        s = await generate(CHAT_MODEL, "Write the summary." + feedback, types.GenerateContentConfig(
            system_instruction=system, temperature=0, response_mime_type="application/json", response_schema=CxrSummary))
        summ = s.parsed if isinstance(s.parsed, CxrSummary) else CxrSummary.model_validate_json(s.text)
        reviewer = ("You are a safety reviewer. Check the SUMMARY against the DATA only. List every number or label not in the data, any "
                    "diagnosis or treatment advice, any claim that the scores are probabilities, any suggestion that a low score rules out "
                    f"a nodule or cancer, and any missing caveat. The required caveat that suspected nodules need CT is not treatment advice; flag it only if it is missing. A decimal comma (0,50) is the same number as 0.50, and English label names in a Finnish text are correct. "
                    f"Write the issues in {LANG[body.lang]}. Return an empty list if there are none."
                    f"\n\nDATA:\n{data}\n\nSUMMARY:\n{summ.model_dump_json()}")
        r = await generate(CHAT_MODEL, "Review.", types.GenerateContentConfig(
            system_instruction=reviewer, temperature=0, response_mime_type="application/json", response_schema=CxrReview))
        review = r.parsed if isinstance(r.parsed, CxrReview) else CxrReview.model_validate_json(r.text)
        if review.verdict != "consistent with the raw scores":
            print(f"cxr-summary review round {attempts}: {len(review.issues)} issue(s): {' | '.join(review.issues)[:600]}", flush=True)
        if review.verdict == "consistent with the raw scores" or attempts == 2:
            break
        feedback = "\nA safety reviewer raised these issues with your previous draft; fix them:\n- " + "\n- ".join(review.issues)
    return {"summary": summ.summary, "key_points": summ.key_points, "review": review.model_dump(), "attempts": attempts,
            "model": CHAT_MODEL, "roles": ["summariser", "safety reviewer"]}
