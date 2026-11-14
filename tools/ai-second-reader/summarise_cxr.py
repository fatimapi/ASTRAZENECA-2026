"""AI summaries of the chest X-ray classifier results, for the Candex report.

For each LIDC-IDRI patient with a frontal chest X-ray test result
(LIDC-CXR/results/<patient>.json from the Candex X-ray backend, TorchXRayVision
DenseNet121), Gemini writes a short, cautious summary of the RAW scores in
English and Finnish. A second, independent Gemini call reviews each summary
against the raw data (the drafter/reviewer pattern used by the clinical agent).

Output: <repo>/data/lidc/cxr-reads.js (window.candexCxrReads) and a 320-px
preview per patient at <repo>/data/lidc/<patient>/cxr.jpg.
Research only: scores are uncalibrated, no threshold, not a diagnosis.

Usage: .venv/bin/python summarise_cxr.py [--model gemini-3.5-flash]
"""
import argparse
import base64
import csv
import io
import json
import os
from datetime import date
from pathlib import Path
from typing import List, Literal

from PIL import Image
from pydantic import BaseModel, Field

HERE = Path(__file__).parent
SITE = Path(os.getenv('CANDEX_SITE', str(Path.home() / 'ASTRAZENECA-2026')))
CXR = HERE / 'LIDC-CXR'
KEY_FILE = HERE / '.gemini-key'


class Summary(BaseModel):
    summary_en: str = Field(description='3-4 sentences in English for a clinician, plain wording')
    summary_fi: str = Field(description='The same summary in natural Finnish')
    key_points_en: List[str] = Field(description='2-4 short bullet points in English')
    key_points_fi: List[str] = Field(description='The same bullet points in Finnish')


class Review(BaseModel):
    verdict: Literal['consistent with the raw data', 'needs changes']
    issues: List[str] = Field(description='Any number, label or claim not supported by the raw data, any diagnosis, or any missing caveat')


RULES = """Rules:
- Use ONLY the data given. Quote scores to two decimals exactly as given; never invent findings or numbers.
- The scores are uncalibrated model outputs from 0 to 1: NOT probabilities, NOT a diagnosis, no decision threshold. Say this once.
- Do not diagnose or recommend treatment. You may say what the scores do and do not show.
- Compare the "Nodule" and "Mass" scores with the CT reference honestly: this classifier is not a nodule detector,
  and the X-ray and CT dates are unknown (both de-identified), so a nodule seen on CT may not have been visible on the X-ray.
- Mention the view note if one is given. Patients are anonymised research cases; this is a research prototype."""


def key():
    k = os.getenv('GEMINI_API_KEY') or (KEY_FILE.read_text().strip() if KEY_FILE.exists() else '')
    if not k:
        raise SystemExit('No Gemini key (GEMINI_API_KEY or .gemini-key).')
    return k


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', default='gemini-3.5-flash')
    args = ap.parse_args()
    from google import genai
    from google.genai import types
    client = genai.Client(api_key=key())

    cases = {r['patient_id']: r for r in csv.DictReader(open(HERE / 'cases.csv'))}
    nodules = list(csv.DictReader(open(HERE / 'nodules.csv')))
    manifest = {r['patient']: r for r in csv.DictReader(open(CXR / 'cxr_manifest.csv'))}
    out = {}
    for f in sorted((CXR / 'results').glob('LIDC-IDRI-*.json')):
        pid = f.stem
        d = json.loads(f.read_text())
        if d.get('status') != 'completed':
            continue
        scores = [{'label': x['label'], 'score': round(x['score'], 4)} for x in d['findings']]
        by = {x['label']: x['score'] for x in scores}
        ct = cases.get(pid, {})
        n_count = sum(1 for n in nodules if n['patient_id'] == pid)
        view = manifest.get(pid, {})
        facts = {
            'patient': pid,
            'xray': {'classifier': f"{d['model']['name']} {d['model']['version']} ({d['model']['weights']})", 'view': f"{view.get('view', '?')} (from headers: {view.get('evidence', '')})",
                     'view_note': '' if view.get('check') in (None, '', 'consistent') else view.get('check'), 'scores_all_18_labels': scores,
                     'nodule_score': round(by.get('Nodule', 0), 2), 'mass_score': round(by.get('Mass', 0), 2)},
            'ct_reference': {'main_nodule_mm': ct.get('max_diameter_mm'), 'approx_lung_rads': ct.get('band'), 'nodules_marked_by_radiologists': n_count},
            'limitations': d.get('limitations', []),
        }
        system = f'You summarise one chest X-ray classifier result for a clinician reading an oncology referral.\n{RULES}\n\nDATA (JSON):\n{json.dumps(facts)}'
        feedback, attempts = '', 0
        while True:
            attempts += 1
            s = client.models.generate_content(model=args.model, contents='Write the summary.' + feedback, config=types.GenerateContentConfig(
                system_instruction=system, temperature=0, response_mime_type='application/json', response_schema=Summary))
            summ = s.parsed if isinstance(s.parsed, Summary) else Summary.model_validate_json(s.text)
            reviewer = ('You are a safety reviewer. Check the SUMMARY against the DATA only. List every number or label not in the data, '
                        'any diagnosis or treatment advice, any claim that the scores are probabilities, and any missing caveat about '
                        f'uncalibrated scores. Return an empty list if there are none.\n\nDATA:\n{json.dumps(facts)}\n\nSUMMARY:\n{summ.model_dump_json()}')
            r = client.models.generate_content(model=args.model, contents='Review.', config=types.GenerateContentConfig(
                system_instruction=reviewer, temperature=0, response_mime_type='application/json', response_schema=Review))
            rev = r.parsed if isinstance(r.parsed, Review) else Review.model_validate_json(r.text)
            # One redraft with the reviewer's issues; the final verdict is kept as is.
            if rev.verdict == 'consistent with the raw data' or attempts == 2:
                break
            feedback = '\nA safety reviewer raised these issues with your previous draft; fix them:\n- ' + '\n- '.join(rev.issues)
        # 320-px preview of the image the classifier received
        img = Image.open(io.BytesIO(base64.b64decode(d['image']['preview_png_base64']))).convert('L')
        img.thumbnail((320, 320))
        dest = SITE / 'data' / 'lidc' / pid
        dest.mkdir(parents=True, exist_ok=True)
        img.save(dest / 'cxr.jpg', quality=85, optimize=True)
        out[pid] = {'view': view.get('view'), 'viewEvidence': view.get('evidence'), 'viewNote': facts['xray']['view_note'],
                    'scores': scores, 'nodule': by.get('Nodule'), 'mass': by.get('Mass'), 'image': f'data/lidc/{pid}/cxr.jpg',
                    'summary': {'en': summ.summary_en, 'fi': summ.summary_fi}, 'keyPoints': {'en': summ.key_points_en, 'fi': summ.key_points_fi},
                    'review': {**rev.model_dump(), 'attempts': attempts}}
        print(f"{pid}: {rev.verdict} ({len(rev.issues)} issues, {attempts} draft{'s' if attempts > 1 else ''}) · {summ.summary_en[:90]}…")
    prov = {'classifier': 'TorchXRayVision DenseNet121 1.5.7 (densenet121-res224-all), Candex backend', 'summaryModel': args.model, 'generated': str(date.today()),
            'input': 'One frontal chest X-ray per patient (LIDC-IDRI research test copy; ViewPosition inferred from headers)',
            'method': 'Gemini summary of the raw scores, then an independent Gemini safety review against the raw data (one redraft if issues are found)',
            'disclaimer': 'Research only. Scores are uncalibrated (not probabilities), no threshold, not a diagnosis; this classifier is not a nodule detector.'}
    body = json.dumps({'schema': 1, 'provenance': prov, 'cases': out}, ensure_ascii=False, indent=1)
    (SITE / 'data' / 'lidc' / 'cxr-reads.js').write_text('// Chest X-ray classifier results with AI summaries (research only). Made by summarise_cxr.py.\n'
                                                       f'window.candexCxrReads = {body};\n')
    print(f'Wrote {len(out)} patients to data/lidc/cxr-reads.js')


if __name__ == '__main__':
    main()
