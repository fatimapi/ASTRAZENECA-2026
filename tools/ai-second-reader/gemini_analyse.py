"""Blind second read of the 5 downloaded LIDC-IDRI CT studies with Google Gemini,
compared against the LIDC radiologists' reference.

Gemini sees three CT slices around each main nodule (lung window, no outlines)
and the image scale. It does NOT see the radiologists' outlines or ratings.
Its structured answer is then compared with the radiologists' findings.

Research and demonstration only: Gemini is a general-purpose model, not a
validated medical device, and these are public, de-identified research scans.
Do not send real patient data to this script.

Key: set GEMINI_API_KEY, or put the key alone in ~/candex-data/.gemini-key
(chmod 600). The key is never printed or written anywhere else.

Usage:
  .venv/bin/python gemini_analyse.py --dry-run        # show what would be sent
  .venv/bin/python gemini_analyse.py --list-models    # models your key can use
  .venv/bin/python gemini_analyse.py [--model NAME] [--case LIDC-IDRI-0365]
Writes: gemini_results.json, gemini_comparison.csv
"""
import argparse
import csv
import json
import os
import sys
import time
from pathlib import Path
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

HERE = Path(__file__).parent
SITE = Path(os.getenv('CANDEX_SITE', str(Path.home() / 'ASTRAZENECA-2026')))  # the Candex repo
CASES_JS = SITE / 'data' / 'lidc' / 'cases.js'
KEY_FILE = HERE / '.gemini-key'
DEFAULT_MODEL = os.getenv('GEMINI_MODEL', 'gemini-3.8-flash')
OFFSETS = (-2, 0, 2)  # slices around the nodule centre that are sent


class Location(BaseModel):
    side: Literal['right', 'left', 'not seen']
    lobe: Literal['upper', 'middle', 'lower', 'lingula', 'uncertain']
    zone: Literal['central', 'peripheral', 'uncertain']


class Read(BaseModel):
    nodule_present: bool = Field(description='Is there a pulmonary nodule or mass in these slices?')
    location: Location
    long_axis_mm: Optional[float] = Field(description='Longest in-plane diameter in mm, using the stated pixel size; null if no nodule')
    short_axis_mm: Optional[float] = Field(description='Perpendicular short-axis diameter in mm; null if no nodule')
    composition: Literal['solid', 'part-solid', 'ground-glass', 'calcified', 'not applicable']
    margin: Literal['smooth', 'lobulated', 'spiculated', 'not applicable']
    lung_rads: Literal['1', '2', '3', '4A', '4B', '4X', 'uncertain'] = Field(description='Lung-RADS v2022 category for a baseline screening CT')
    other_findings: List[str] = Field(description='Other abnormalities visible in these slices, or empty')
    image_quality: Literal['good', 'adequate', 'limited']
    confidence: float = Field(ge=0, le=1, description='Confidence in the nodule assessment, 0 to 1')
    short_report: str = Field(description='Two or three sentences in plain clinical English')


PROMPT = """You are assisting a research study that compares AI reads of chest CT with radiologists.
These are axial slices from one de-identified public research chest CT (lung window), shown in order
from inferior (towards the feet) to superior (towards the head). Slice thickness: {slice_mm} mm. Each image is 384 x 384 pixels and one pixel
is {px_mm:.3f} mm, so 10 mm is about {ten_mm:.0f} pixels. The image's left side is the patient's right.

Assess the most significant pulmonary nodule, if any, as a radiologist would on a baseline lung-cancer
screening CT. Measure in millimetres using the pixel size. If you cannot see a nodule, say so; do not guess.
Use Lung-RADS v2022. This is research only and not used for patient care."""


def load_cases():
    text = CASES_JS.read_text()
    return json.loads(text[text.index('{'):text.rindex('}') + 1])


def api_key():
    key = os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY')
    if not key and KEY_FILE.exists():
        if KEY_FILE.stat().st_mode & 0o077:
            KEY_FILE.chmod(0o600)
        key = KEY_FILE.read_text().strip()
    if not key:
        sys.exit('No Gemini API key. Set GEMINI_API_KEY or save the key alone in ' + str(KEY_FILE))
    return key


def reference(case):
    """Radiologists' reference for the main nodule, from the exported outlines."""
    main = case['nodules'][0]
    frame = case['frames'][case['centre']]
    pts = [p for o in frame['outlines'] if o['n'] == 0 for p in o['pts']]
    cx = sum(p[0] for p in pts) / len(pts) if pts else 192
    return {
        'nodule_present': True,
        'side': 'right' if cx < 192 else 'left',
        'diameter_mm': main['diameter'],
        'composition': 'solid' if main['texture'] >= 4 else 'part-solid' if main['texture'] >= 2 else 'ground-glass',
        'margin': 'spiculated' if main['spiculation'] >= 3 else 'smooth/lobulated',
        'lung_rads': case['band'].replace('-like', ''),
        'malignancy': main['malignancy'],
        'readers': main['readers'],
    }


def images_for(case):
    n = len(case['frames'])
    picks = sorted({min(n - 1, max(0, case['centre'] + o)) for o in OFFSETS})
    return [(i, SITE / case['frames'][i]['src']) for i in picks]


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--model', default=DEFAULT_MODEL)
    ap.add_argument('--case', action='append', help='Limit to one or more case IDs')
    ap.add_argument('--dry-run', action='store_true', help='Show what would be sent; no API call')
    ap.add_argument('--list-models', action='store_true')
    args = ap.parse_args()

    cases = load_cases()
    ids = args.case or sorted(cases)

    if args.dry_run:
        for cid in ids:
            c = cases[cid]
            px = c['pixelMm'] * 512 / 384
            print(f'{cid}: {len(images_for(c))} images {[i + 1 for i, _ in images_for(c)]} of {len(c["frames"])}; '
                  f'pixel {px:.3f} mm; reference withheld from the model: {reference(c)}')
        print('\nPrompt sent with each case:\n' + PROMPT.format(slice_mm=1, px_mm=0.8, ten_mm=12.5))
        return

    from google import genai
    from google.genai import types
    client = genai.Client(api_key=api_key())

    if args.list_models:
        for m in client.models.list():
            if 'generateContent' in (getattr(m, 'supported_actions', None) or []):
                print(m.name)
        return

    results, rows = {}, []
    for cid in ids:
        c = cases[cid]
        px = c['pixelMm'] * 512 / 384
        parts = [types.Part.from_bytes(data=path.read_bytes(), mime_type='image/jpeg') for _, path in images_for(c)]
        parts.append(PROMPT.format(slice_mm=c['sliceMm'], px_mm=px, ten_mm=10 / px))
        started = time.time()
        for attempt in range(3):
            try:
                resp = client.models.generate_content(
                    model=args.model, contents=parts,
                    config=types.GenerateContentConfig(temperature=0, response_mime_type='application/json', response_schema=Read))
                read = resp.parsed if isinstance(resp.parsed, Read) else Read.model_validate_json(resp.text)
                break
            except Exception as e:  # rate limits or transient errors: retry, then record the failure
                if attempt == 2:
                    print(f'{cid}: failed ({type(e).__name__}: {str(e)[:160]})')
                    read = None
                else:
                    time.sleep(5 * (attempt + 1))
        ref = reference(c)
        results[cid] = {'model': args.model, 'seconds': round(time.time() - started, 1), 'gemini': read.model_dump() if read else None, 'reference': ref}
        if read:
            diff = None if read.long_axis_mm is None else round(read.long_axis_mm - ref['diameter_mm'], 1)
            rows.append({
                'case': cid, 'detected': read.nodule_present, 'side_match': read.location.side == ref['side'],
                'gemini_long_mm': read.long_axis_mm, 'reference_mean_mm': ref['diameter_mm'], 'diff_mm': diff,
                'gemini_composition': read.composition, 'reference_composition': ref['composition'],
                'gemini_lung_rads': read.lung_rads, 'reference_lung_rads': ref['lung_rads'],
                'category_match': read.lung_rads == ref['lung_rads'], 'confidence': read.confidence,
            })
            print(f'{cid}: detected={read.nodule_present} side={read.location.side}/{ref["side"]} '
                  f'size={read.long_axis_mm}/{ref["diameter_mm"]} mm  Lung-RADS={read.lung_rads}/{ref["lung_rads"]}  conf={read.confidence}')

    tag = args.model.replace('/', '_')
    for name in ('gemini_results.json', f'gemini_results_{tag}.json'):
        (HERE / name).write_text(json.dumps(results, indent=2))
    if rows:
        for name in ('gemini_comparison.csv', f'gemini_comparison_{tag}.csv'):
            with open(HERE / name, 'w', newline='') as f:
                w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
                w.writeheader(); w.writerows(rows)
        n = len(rows)
        print(f'\nSummary over {n} case(s): detected {sum(r["detected"] for r in rows)}/{n}, '
              f'side correct {sum(r["side_match"] for r in rows)}/{n}, Lung-RADS exact {sum(r["category_match"] for r in rows)}/{n}, '
              f'mean |size difference| {sum(abs(r["diff_mm"]) for r in rows if r["diff_mm"] is not None) / max(1, sum(r["diff_mm"] is not None for r in rows)):.1f} mm')
    print('Saved gemini_results.json and gemini_comparison.csv in', HERE)


if __name__ == '__main__':
    main()
