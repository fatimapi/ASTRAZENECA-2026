"""Controlled input/prompt experiments for Gemini blind reads of the 5 LIDC-IDRI cases.

Research and demonstration only (public, de-identified data; not a medical device).
The model never sees the radiologists' outlines or ratings; those are only used
for scoring (score_experiments.py).

Inputs (--input):
  all11     all 11 JPEG slices of the excerpt (384 px, lung window), numbered
  dicom512  the same 11 slices rendered from DICOM at 512 px (lung -600/1500, PNG)
            + the middle slice in a mediastinal window (40/400)
  tiles     overview of the middle slice (512 px) + left/right halves of
            5 slices (centre -4..+4, step 2) upscaled x2 (each tile pixel = pixelMm/2)
  base3     the baseline 3 JPEG slices (centre-2, centre, centre+2), numbered
Prompts (--prompt):
  plain     baseline prompt + ask for image number and centre x/y of the nodule
  search    first list candidate opacities (image, x, y, size), then the final read;
            Lung-RADS solid-nodule size thresholds stated explicitly
Runs: --runs N --temperature T (self-consistency), default 1 run at T=0.

Usage: .venv/bin/python gemini_experiments.py --input all11 --prompt plain --model gemini-3.5-flash
Writes experiments/<input>-<prompt>[-tT-xN]__<model>.json
"""
import argparse
import io
import json
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import List, Literal, Optional

import numpy as np
import pydicom
from PIL import Image
from pydantic import BaseModel, Field

from gemini_analyse import SITE, HERE, Location, api_key, load_cases, reference

OUT = HERE / 'experiments'
LUNG, MEDIA = (-600, 1500), (40, 400)


class Read(BaseModel):
    nodule_present: bool = Field(description='Is there a pulmonary nodule or mass in these slices?')
    location: Location
    image_number: Optional[int] = Field(description='Number of the image where the nodule is largest; null if no nodule')
    centre_x: Optional[float] = Field(description='Nodule centre x in that image, in its own pixels (0 = image left edge); null if no nodule')
    centre_y: Optional[float] = Field(description='Nodule centre y in that image, in its own pixels (0 = top); null if no nodule')
    long_axis_mm: Optional[float] = Field(description='Longest in-plane diameter in mm, using the stated pixel size; null if no nodule')
    short_axis_mm: Optional[float] = Field(description='Perpendicular short-axis diameter in mm; null if no nodule')
    composition: Literal['solid', 'part-solid', 'ground-glass', 'calcified', 'not applicable']
    margin: Literal['smooth', 'lobulated', 'spiculated', 'not applicable']
    lung_rads: Literal['1', '2', '3', '4A', '4B', '4X', 'uncertain'] = Field(description='Lung-RADS v2022 category for a baseline screening CT')
    other_findings: List[str] = Field(description='Other abnormalities visible in these slices, or empty')
    image_quality: Literal['good', 'adequate', 'limited']
    confidence: float = Field(ge=0, le=1, description='Confidence in the nodule assessment, 0 to 1')
    short_report: str = Field(description='Two or three sentences in plain clinical English')


class Candidate(BaseModel):
    image_number: int
    x: float = Field(description='Centre x in that image, its own pixels')
    y: float = Field(description='Centre y in that image, its own pixels')
    side: Literal['right', 'left']
    approx_size_mm: float
    description: str = Field(description='Few words: e.g. round solid opacity, vessel in cross-section, scar')
    likely_nodule: bool


class SearchRead(BaseModel):
    candidates: List[Candidate] = Field(description='Search step: every focal opacity that could be a nodule, before deciding')
    nodule_present: bool
    location: Location
    image_number: Optional[int] = Field(description='Image where the chosen nodule is largest; null if none')
    centre_x: Optional[float]
    centre_y: Optional[float]
    long_axis_mm: Optional[float] = Field(description='Longest in-plane diameter in mm; null if none')
    short_axis_mm: Optional[float] = Field(description='Perpendicular short axis in mm; null if none')
    mean_diameter_mm: Optional[float] = Field(description='(long + short) / 2, used for Lung-RADS')
    composition: Literal['solid', 'part-solid', 'ground-glass', 'calcified', 'not applicable']
    margin: Literal['smooth', 'lobulated', 'spiculated', 'not applicable']
    lung_rads: Literal['1', '2', '3', '4A', '4B', '4X', 'uncertain']
    other_findings: List[str]
    image_quality: Literal['good', 'adequate', 'limited']
    confidence: float = Field(ge=0, le=1)
    short_report: str


INTRO = """You are assisting a research study that compares AI reads of chest CT with radiologists.
The images come from one de-identified public research chest CT. Slice thickness: {slice_mm} mm.
{layout}
In every axial image the image's left side is the patient's right.
"""
PLAIN = """Assess the most significant pulmonary nodule, if any, as a radiologist would on a baseline lung-cancer
screening CT. Measure in millimetres using the pixel size. If you cannot see a nodule, say so; do not guess.
Use Lung-RADS v2022. Give the image number and the nodule centre (x, y) in that image's own pixels.
This is research only and not used for patient care."""
SEARCH = """Work in two steps.
1. Search: look through every image, both lungs, centrally and peripherally (including against the pleura
   and fissures). List every focal opacity that could be a nodule with image number, centre x/y in that
   image's own pixels, side, approximate size and a few words. A vessel is usually tubular and continues
   across adjacent slices; a nodule is round and appears/disappears over a few slices.
2. Decide: choose the most significant true nodule (if any) and measure it carefully in millimetres using
   the pixel size of the image you measure on (measure the full extent, edge to edge, not just the dense core).
Lung-RADS v2022, solid nodule on a baseline screen, by mean diameter = (long + short) / 2:
   < 6 mm -> 2; 6 to < 8 mm -> 3; 8 to < 15 mm -> 4A; >= 15 mm -> 4B;
   4X = category 3 or 4 with additional features that increase suspicion (e.g. spiculation).
   Benign calcification -> 1 or 2. The category must follow your own measurement.
If there is no nodule, say so; do not guess. This is research only and not used for patient care."""


def hu_stack(pid):
    """All slices of a patient as HU arrays, sorted by z (cached)."""
    if pid in _cache:
        return _cache[pid]
    sl = [pydicom.dcmread(f) for f in (HERE / 'LIDC-IDRI' / pid).glob('*.dcm')]
    sl = [s for s in sl if hasattr(s, 'ImagePositionPatient')]
    sl.sort(key=lambda s: float(s.ImagePositionPatient[2]))
    _cache[pid] = {round(float(s.ImagePositionPatient[2]), 2):
                   s.pixel_array.astype(np.float32) * float(s.RescaleSlope) + float(s.RescaleIntercept) for s in sl}
    return _cache[pid]


_cache = {}


def window(hu, lw):
    lo, hi = lw[0] - lw[1] / 2, lw[0] + lw[1] / 2
    return Image.fromarray(np.clip((hu - lo) / (hi - lo) * 255, 0, 255).astype(np.uint8))


def png(img):
    b = io.BytesIO(); img.save(b, 'PNG', optimize=True); return b.getvalue(), 'image/png'


def hu_for(case, fi):
    stack = hu_stack(case['id'])
    z = case['frames'][fi]['z']
    return stack[min(stack, key=lambda k: abs(k - z))]


def build_inputs(case, kind):
    """Returns (images, layout_text). images: list of dict(label, bytes, mime, frame, scale, ox, oy)
    where full-384 coords = (ox + x / scale) for converting model coords back."""
    n, c = len(case['frames']), case['centre']
    px384 = case['pixelMm'] * 512 / 384
    px512 = case['pixelMm']
    imgs = []
    if kind in ('all11', 'base3'):
        idx = range(n) if kind == 'all11' else [c - 2, c, c + 2]
        for k, fi in enumerate(idx, 1):
            imgs.append(dict(label=f'Image {k}: axial slice {k} of {len(idx)} (z = {case["frames"][fi]["z"]} mm)',
                             bytes=(SITE / case['frames'][fi]['src']).read_bytes(), mime='image/jpeg',
                             frame=fi, scale=1.0, ox=0, oy=0))
        layout = (f'Images 1-{len(idx)} are consecutive{"" if kind == "all11" else " (every other)"} axial slices in lung window, '
                  f'from inferior (feet) to superior (head). Each is 384 x 384 pixels; one pixel is {px384:.3f} mm '
                  f'(10 mm = {10 / px384:.0f} pixels).')
    elif kind == 'dicom512':
        for k, fi in enumerate(range(n), 1):
            b, m = png(window(hu_for(case, fi), LUNG))
            imgs.append(dict(label=f'Image {k}: axial slice {k} of {n}, lung window (z = {case["frames"][fi]["z"]} mm)',
                             bytes=b, mime=m, frame=fi, scale=512 / 384, ox=0, oy=0))
        b, m = png(window(hu_for(case, c), MEDIA))
        imgs.append(dict(label=f'Image {n + 1}: the same slice as image {c + 1}, mediastinal (soft-tissue) window',
                         bytes=b, mime=m, frame=c, scale=512 / 384, ox=0, oy=0))
        layout = (f'Images 1-{n} are consecutive axial slices in lung window (level -600, width 1500), from inferior to '
                  f'superior; image {n + 1} is image {c + 1} again in mediastinal window (40/400) to judge density/calcification. '
                  f'Each is 512 x 512 pixels; one pixel is {px512:.3f} mm (10 mm = {10 / px512:.0f} pixels).')
    elif kind == 'tiles':
        b, m = png(window(hu_for(case, c), LUNG))
        imgs.append(dict(label=f'Image 1: overview, whole axial slice at z = {case["frames"][c]["z"]} mm (512 x 512, '
                               f'{px512:.3f} mm/pixel)', bytes=b, mime=m, frame=c, scale=512 / 384, ox=0, oy=0))
        k = 2
        for off in (-4, -2, 0, 2, 4):
            fi = min(n - 1, max(0, c + off))
            full = window(hu_for(case, fi), LUNG)
            for half, x0, side in (('image-left half = patient RIGHT lung', 0, 'right'), ('image-right half = patient LEFT lung', 256, 'left')):
                tile = full.crop((x0, 0, x0 + 256, 512)).resize((512, 1024), Image.LANCZOS)
                b, m = png(tile)
                imgs.append(dict(label=f'Image {k}: zoom x2 of the {half}, z = {case["frames"][fi]["z"]} mm '
                                       f'(512 x 1024 pixels, {px512 / 2:.3f} mm/pixel; tile x=0 is overview x={x0})',
                                 bytes=b, mime=m, frame=fi, scale=2 * 512 / 384, ox=x0 * 384 / 512, oy=0))
                k += 1
        layout = (f'Image 1 is an overview axial slice (512 x 512, one pixel {px512:.3f} mm). Images 2-{k - 1} are zoomed x2 tiles '
                  f'of the left and right halves of 5 slices spaced {2 * case["sliceMm"]} mm apart, from inferior to superior; '
                  f'in the tiles one pixel is {px512 / 2:.3f} mm (10 mm = {20 / px512:.0f} pixels). Lung window -600/1500.')
    else:
        raise ValueError(kind)
    return imgs, layout


def ask(client, types, model, parts, schema, temperature):
    t0 = time.time()
    for attempt in range(3):
        try:
            resp = client.models.generate_content(
                model=model, contents=parts,
                config=types.GenerateContentConfig(temperature=temperature, response_mime_type='application/json',
                                                   response_schema=schema))
            read = resp.parsed if isinstance(resp.parsed, schema) else schema.model_validate_json(resp.text)
            return dict(read=read.model_dump(), seconds=round(time.time() - t0, 1), error=None)
        except Exception as e:
            err = f'{type(e).__name__}: {str(e)[:200]}'
            time.sleep(5 * (attempt + 1))
    return dict(read=None, seconds=round(time.time() - t0, 1), error=err)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--model', required=True)
    ap.add_argument('--input', default='all11', choices=['all11', 'dicom512', 'tiles', 'base3'])
    ap.add_argument('--prompt', default='plain', choices=['plain', 'search'])
    ap.add_argument('--runs', type=int, default=1)
    ap.add_argument('--temperature', type=float, default=0.0)
    ap.add_argument('--dry-run', action='store_true')
    a = ap.parse_args()

    cases = load_cases()
    variant = f'{a.input}-{a.prompt}' + (f'-t{a.temperature}-x{a.runs}' if a.runs > 1 or a.temperature else '')
    schema = SearchRead if a.prompt == 'search' else Read
    jobs = []
    for cid in sorted(cases):
        c = cases[cid]
        imgs, layout = build_inputs(c, a.input)
        text = INTRO.format(slice_mm=c['sliceMm'], layout=layout) + '\n' + (SEARCH if a.prompt == 'search' else PLAIN)
        jobs.append((cid, imgs, text))
        if a.dry_run:
            print(cid, len(imgs), 'images', sum(len(i['bytes']) for i in imgs) // 1024, 'KB')
    if a.dry_run:
        print(text); return

    from google import genai
    from google.genai import types
    client = genai.Client(api_key=api_key())

    def run(job):
        cid, imgs, text = job
        parts = []
        for im in imgs:
            parts += [im['label'], types.Part.from_bytes(data=im['bytes'], mime_type=im['mime'])]
        parts.append(text)
        return cid, [ask(client, types, a.model, parts, schema, a.temperature) for _ in range(a.runs)]

    results = {}
    with ThreadPoolExecutor(5) as ex:
        for cid, runs in ex.map(run, jobs):
            imgs = next(j[1] for j in jobs if j[0] == cid)
            results[cid] = dict(model=a.model, variant=variant, runs=runs, reference=reference(cases[cid]),
                                images=[{k: v for k, v in im.items() if k != 'bytes'} for im in imgs])
            for r in runs:
                g = r['read']
                print(f'{cid}: ' + (f'present={g["nodule_present"]} side={g["location"]["side"]} img={g["image_number"]} '
                                    f'xy=({g["centre_x"]},{g["centre_y"]}) size={g["long_axis_mm"]} LR={g["lung_rads"]} '
                                    f'conf={g["confidence"]} {r["seconds"]}s' if g else f'ERROR {r["error"]}'))
    OUT.mkdir(exist_ok=True)
    path = OUT / f'{variant}__{a.model.replace("/", "_")}.json'
    path.write_text(json.dumps(results, indent=2))
    print('wrote', path)


if __name__ == '__main__':
    main()
