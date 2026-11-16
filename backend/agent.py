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

from fastapi import APIRouter, Header, HTTPException, Request
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


# Temporary provider errors (rate limit, overload, gateway) are retried with a short backoff:
# a CT comparison makes ~10 calls in a row, so one transient error should not fail the whole run.
RETRY_CODES = {429, 500, 502, 503, 504}
RETRY_DELAYS_S = (3, 8, 20)


async def generate(model: str, contents, config) -> object:
    def call():
        return client().models.generate_content(model=model, contents=contents, config=config)
    for attempt in range(len(RETRY_DELAYS_S) + 1):
        try:
            return await asyncio.wait_for(asyncio.to_thread(call), TIMEOUT_S)
        except HTTPException:
            raise
        except asyncio.TimeoutError:
            if attempt < len(RETRY_DELAYS_S):
                print(f"AI call to {model} timed out; retrying ({attempt + 1}/{len(RETRY_DELAYS_S)}).", flush=True)
                continue
            raise HTTPException(504, "The AI service took too long to answer. Try again in a minute.")
        except Exception as exc:
            # Log only the provider's code and status, never the request or response body.
            code = getattr(exc, "code", None)
            status = getattr(exc, "status", None) or type(exc).__name__
            print(f"AI call to {model} failed: {code or ''} {status} (attempt {attempt + 1}).", flush=True)
            if code in RETRY_CODES and attempt < len(RETRY_DELAYS_S):
                await asyncio.sleep(RETRY_DELAYS_S[attempt])
                continue
            if code == 429:
                raise HTTPException(503, "The AI service is rate-limited (too many requests or the daily quota is used up). Wait a minute and try again.")
            if code in (500, 502, 503, 504):
                raise HTTPException(502, f"The AI service is temporarily unavailable ({code} {status}). Try again in a minute.")
            if code in (401, 403):
                raise HTTPException(502, "The Gemini API key was rejected by the AI service. Check the key in ~/candex-data/.gemini-key.")
            if code == 404:
                raise HTTPException(502, f"The AI model {model} is not available to this Gemini API key.")
            raise HTTPException(502, f"The AI service returned an error ({code or ''} {status}).".replace("( ", "("))


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
async def cxr_summary(body: CxrIn, request: Request, authorization: str = Header(default="")):
    from . import public_demo
    if not (public_demo.enabled() and not public_demo.has_token(authorization)):
        require_token(authorization)
    else:
        # Public demo: only the X-ray classifier's own labels, and counted against the demo limits.
        from .xray_onnx import LABELS
        if any(f.label not in LABELS for f in body.findings):
            raise HTTPException(422, "The public demo summarises only the X-ray model's own labels.")
        public_demo.allow(request.scope, "cxr-summary")
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


# ---------- Quality & Equity agent (quality administrator) ----------
# Grounded in a "data pack" the browser builds from the same functions that draw
# the Quality & Equity page (KPI cards, CandexKpis.evaluate(), regional fixtures,
# the simulated cohort's kpis(), the LIDC/X-ray research results). Every value
# has an id and a provenance tag. Safeguards (agreed by three design reviews):
# - chat: every number in the answer must exist in the pack (one redraft, then
#   unverified numbers are flagged to the user);
# - reports: the model writes {{value.id}} placeholders, never digits; the
#   browser fills them from the pack; one independent safety review.
QUALITY_MODEL = os.getenv("CANDEX_QUALITY_MODEL", "gemini-3.5-flash")  # pinned, so the PDF can name it
MAX_PACK_CHARS = 80_000

QUALITY_RULES = """Rules (research prototype for a Finnish quality administrator):
- Use ONLY the DATA PACK. If a number or fact is not in it, say it is not in Candex data. Never invent numbers; only quote values from the pack, and use precomputed gaps/min/max instead of doing arithmetic.
- Tag every number with its provenance from the pack: SYNTHETIC (all KPI values, regional figures, the n=50 cohort), SOURCED REFERENCE (Finnish references, European comparators), PUBLIC RESEARCH DATA (LIDC-IDRI). Never present a synthetic value as measured Finnish performance.
- Keep each reference's meaning: the 3-week (21-day) STM limit is a NON-URGENT limit for starting assessment after referral receipt, not a cancer-treatment target; 2035 strategy goals are strategic goals; European comparators (EU screening target, European screening guidelines, EUSOMA breast-centre indicator) are external comparators, not Finnish standards; local demo bands are local conventions. A grey 'Not assessed' status stays grey; never convert 3 or 6 months into 90/180-day targets.
- Values marked 'static illustrative' are fixed example numbers that are not computed from the datasets; say so if asked about them.
- Small numbers: always give n with a rate; flag low-n groups (n < 5) and do not compare them. LIDC AI second reader: 4/5 found (95% CI 28-99%), one model, one run. Chest X-ray classifier: n=8, uncalibrated, not a nodule detector.
- The cohort's gaps were built into the simulation (oversampling and participation penalties), so they illustrate the method and are not findings about real groups.
- Describe equity gaps as access barriers (travel time, language group: national languages vs other languages, care route, urban vs other counties). Never stigmatising wording such as 'foreigners', 'non-compliant' or 'hard-to-reach'.
- Map regions are maakunta (19 regions); the cohort uses wellbeing services counties (hyvinvointialueet). Never merge or equate them.
- No patient-level or clinical conclusions, no diagnosis, no triage, no re-identification. No 'best/worst real county' rankings: the data are synthetic. Using the AI reader for triage is not supported (unvalidated, not CE-marked).
- If a question cannot be answered, say why briefly and suggest a question that can be answered from the pack.
- Be concise (under about 180 words), plain Markdown, and end with a line 'Based on: ...' naming the pack sections and the KPI reference profile.
- In Finnish, write the tags as SYNTEETTINEN / LÄHDEVIITE / JULKINEN TUTKIMUSAINEISTO, the statuses as Hallinnassa / Vaatii tarkistusta / Kiireellisiä toimia / Ei arvioitu, and the last line as 'Perusta: ...'. Tag only numbers, not statuses."""

# Reports show provenance in their own table and sources section, so the chat-only
# rules (inline tags, the closing "Based on" line) are replaced for reports.
REPORT_RULES = "\n".join(l for l in QUALITY_RULES.splitlines()
                          if not l.startswith(("- Tag every number", "- Be concise", "- In Finnish, write the tags"))) + (
    "\n- Provenance is shown in the report's own table: say once that figures are synthetic examples where that applies; "
    "no inline provenance tags and no 'Based on' line.")

_NUM = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)?")


def _numbers(text: str, digits: int = 2) -> set:
    out = set()
    for tok in _NUM.findall(text or ""):
        try:
            out.add(round(float(tok.replace(",", ".")), digits))
        except ValueError:
            pass
    return out


def _allowed(pack_text: str) -> set:
    allowed = set(range(0, 11))
    for n in _numbers(pack_text, 6):  # also the same value with fewer decimals, or a 0-1 score as a percentage
        allowed |= {round(n, 2), float(round(n)), round(n, 1), round(n * 100, 2), float(round(n * 100)), round(n * 100, 1)}
    return allowed


def unverified_numbers(text: str, pack_text: str) -> list:
    allowed = _allowed(pack_text)
    return sorted(n for n in _numbers(text) if n not in allowed)


def pack_text(pack: dict) -> str:
    text = json.dumps(pack, ensure_ascii=False)
    if len(text) > MAX_PACK_CHARS:
        raise HTTPException(413, "The data pack is too large.")
    return text


class QualityChatIn(BaseModel):
    lang: Literal["en", "fi"] = "en"
    pack: dict
    packHash: str = Field(default="", max_length=80)
    messages: List[Message] = Field(min_length=1, max_length=24)


class QualityAnswer(BaseModel):
    answer: str = Field(description="The answer in Markdown, following the rules")
    sections: List[str] = Field(description="Data pack sections or value ids the answer is based on")


@router.post("/quality-chat")
async def quality_chat(body: QualityChatIn, authorization: str = Header(default="")):
    require_token(authorization)
    from google.genai import types
    data = pack_text(body.pack)
    system = (f"You are the Candex Quality & Equity assistant for a quality administrator. Answer in {LANG[body.lang]}"
              f"{' (use decimal commas)' if body.lang == 'fi' else ''}.\n{QUALITY_RULES}\n\nDATA PACK (JSON):\n{data}")
    contents = [types.Content(role=m.role, parts=[types.Part(text=m.text)]) for m in body.messages]
    cfg = types.GenerateContentConfig(system_instruction=system, temperature=0.2, response_mime_type="application/json", response_schema=QualityAnswer)
    attempts, bad = 0, []
    while True:
        attempts += 1
        r = await generate(QUALITY_MODEL, contents, cfg)
        out = r.parsed if isinstance(r.parsed, QualityAnswer) else QualityAnswer.model_validate_json(r.text)
        bad = unverified_numbers(out.answer, data)
        if not bad or attempts == 2:
            break
        contents = contents + [types.Content(role="model", parts=[types.Part(text=out.answer)]),
                               types.Content(role="user", parts=[types.Part(text=f"These numbers are not in the data pack: {', '.join(str(b) for b in bad)}. Rewrite the answer using only values from the pack.")])]
    return {"text": out.answer, "sections": out.sections[:20], "unverified": bad, "attempts": attempts, "model": QUALITY_MODEL, "packHash": body.packHash}


REPORT_FOCUS = {
    "kpi": "KPI status against Finnish references: which indicators are under control, need review, need urgent action or are not assessed, what reference sets each threshold, and the European comparators.",
    "equity": "Screening equity in the simulated cohort (n=50): up-to-date rates by group with n, the travel-time, language, urban/other and care-route gaps, low-n groups, days to GP, data completeness.",
    "regional": "Regional access across the 19 maakunta regions (synthetic): spread (min, max, gap) of each measure, how many regions are in each status band, Åland without data. No rankings of real regions.",
    "lung": "Lung pathway research data: the 25 public LIDC-IDRI CT studies, the AI second-reader agreement with confidence interval, size error and wrong-side finding, and the 8 chest X-ray classifier results (not a nodule detector).",
    "standards": "Standards, definitions and data limitations: what each reference means, why measures are grey, which values are static illustrative, data completeness, and what real data would be needed.",
}


class Narrative(BaseModel):
    summary_en: List[str] = Field(description="3-5 short summary sentences in English, numbers only as {{value.id}} placeholders")
    summary_fi: List[str] = Field(description="The same summary in Finnish, same placeholders")
    findings_en: List[str] = Field(description="3-6 key findings in English, numbers only as {{value.id}} placeholders")
    findings_fi: List[str] = Field(description="The same findings in Finnish")
    questions_en: List[str] = Field(description="2-4 questions for service review in English")
    questions_fi: List[str] = Field(description="The same questions in Finnish")


class ReportReview(BaseModel):
    verdict: Literal["ready for clinician review", "needs changes"]
    issues_en: List[str] = Field(description="Each issue in English, quoting the problem")
    issues_fi: List[str] = Field(description="The same issues in Finnish")


class QualityReportIn(BaseModel):
    kind: Literal["kpi", "equity", "regional", "lung", "standards"]
    pack: dict
    packHash: str = Field(default="", max_length=80)


_TOKEN = re.compile(r"\{\{\s*([A-Za-z0-9_.\-]+)\s*\}\}")


@router.post("/quality-report")
async def quality_report(body: QualityReportIn, authorization: str = Header(default="")):
    require_token(authorization)
    from google.genai import types
    data = pack_text(body.pack)
    vals = body.pack.get("values") or {}
    ids = set(vals) | {f"{k}.{f}" for k, v in vals.items() if isinstance(v, dict) and v.get("region") for f in ("region", "regionFi")}
    system = ("You write the narrative of a Candex quality report for a Finnish quality administrator, in English and in natural Finnish. "
              "NEVER type a number: write every figure as a placeholder {{value.id}} using ids from DATA PACK 'values' (the page fills them in). "
              "Words like 'nineteen' are also numbers: use placeholders. Placeholders already include their unit: never write a unit (mm, %, days) after one. "
              "Do not repeat tables; interpret them. The report has its own provenance table and sources, so do NOT add provenance tags after numbers and do NOT add a 'Based on' line; "
              "instead say once in the summary that the figures are synthetic examples where that applies. Describe cohort gaps as what the simulation illustrates "
              "(e.g. 'in the simulation, people with longer travel are less often up to date'), never as real-world findings.\n"
              f"REPORT FOCUS: {REPORT_FOCUS[body.kind]}\n{REPORT_RULES}\n\nDATA PACK (JSON):\n{data}")
    r = await generate(QUALITY_MODEL, "Write the report narrative.", types.GenerateContentConfig(
        system_instruction=system, temperature=0.2, response_mime_type="application/json", response_schema=Narrative))
    nar = r.parsed if isinstance(r.parsed, Narrative) else Narrative.model_validate_json(r.text)
    text = "\n".join(nar.summary_en + nar.findings_en + nar.questions_en + nar.summary_fi + nar.findings_fi + nar.questions_fi)
    unknown = sorted({t for t in _TOKEN.findall(text) if t not in ids})
    typed = unverified_numbers(_TOKEN.sub(" ", text), data)
    reviewer = ("You are a safety reviewer. Check the REPORT NARRATIVE (placeholders {{id}} stand for pack values) against the DATA PACK and RULES. "
                "List: synthetic data presented as measured performance, local bands presented as national standards, European comparators presented as Finnish standards, "
                "the AI reader presented as validated, causal or stigmatising claims about groups, rankings of real regions, patient-level conclusions, "
                "and missing small-n caveats. Return an empty list if there are none.\n"
                f"RULES:\n{REPORT_RULES}\n\nDATA PACK:\n{data}\n\nREPORT NARRATIVE (English):\n" + "\n".join(nar.summary_en + nar.findings_en + nar.questions_en))
    rv = await generate(QUALITY_MODEL, "Review.", types.GenerateContentConfig(system_instruction=reviewer, temperature=0,
                        response_mime_type="application/json", response_schema=ReportReview))
    review = rv.parsed if isinstance(rv.parsed, ReportReview) else ReportReview.model_validate_json(rv.text)
    out_review = {"verdict": review.verdict, "issues": review.issues_en, "issues_en": review.issues_en, "issues_fi": review.issues_fi}
    return {"narrative": nar.model_dump(), "review": out_review, "unknownTokens": unknown, "typedNumbers": typed,
            "model": QUALITY_MODEL, "packHash": body.packHash}
