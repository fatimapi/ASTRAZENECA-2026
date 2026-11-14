"""Make research test copies of LIDC-IDRI frontal chest X-rays that the Candex
X-ray backend accepts, without guessing the view.

LIDC-IDRI radiographs have no ViewPosition tag, which the backend (rightly)
requires. This script:
- keeps only frontal images: PatientOrientation L\\F (lateral images are P\\F or A\\F);
- labels PA vs AP from header evidence: source-to-detector distance (SID) of
  about 1.8 m is the standard erect PA set-up, about 1.0 m suggests a bedside AP;
  series descriptions such as "PA & LATERAL" support PA;
- writes the evidence into ImageComments and a manifest (cxr_manifest.csv),
  and flags images whose appearance should be double-checked;
- drops a stored display window that clips most pixels (LIDC-IDRI-0051 carries a
  CT lung window, -600/1600, which turns the radiograph white), so the image is
  scaled over its stored range instead; the Candex backend now rejects such windows;
- applies corrections confirmed by visual review (VISUAL_FIXES), e.g. pixel data
  that is inverted relative to its MONOCHROME2 label.
Originals are never changed. Test copies are for research testing only.

Usage: .venv/bin/python make_cxr_test_copies.py
"""
import csv
import glob
from pathlib import Path

import numpy as np
import pydicom
from pydicom.pixels import apply_modality_lut, apply_voi_lut

HERE = Path(__file__).parent / 'LIDC-CXR'
OUT = HERE / 'frontal-test'
# Visual review notes (human/AI review of the previews), kept separate from header evidence.
VISUAL_NOTES = {
    'LIDC-IDRI-0170': 'Monitoring leads and a line are visible, as in an inpatient; headers still indicate a standard PA set-up. View not confirmed visually.',
}


# Corrections confirmed by visual review of the previews; each is written into the copy.
VISUAL_FIXES = {
    'LIDC-IDRI-0116': ('PhotometricInterpretation', 'MONOCHROME1',
                       'Pixel data is inverted relative to its MONOCHROME2 label (spine dark, lungs bright; mean spine 3986 vs lung 10409, the reverse of the other images). Relabelled MONOCHROME1.'),
}


def clipped_by_window(d):
    if 'WindowCenter' not in d or 'WindowWidth' not in d:
        return 0.0
    a = np.asarray(apply_voi_lut(np.asarray(apply_modality_lut(d.pixel_array, d), float), d, index=0))
    lo, hi = a.min(), a.max()
    return 1.0 if hi <= lo else float(np.mean((a <= lo) | (a >= hi)))


def view_from_headers(d):
    sid = float(d.get('DistanceSourceToDetector') or 0)
    desc = f"{d.get('SeriesDescription', '')} {d.get('StudyDescription', '')}".upper()
    evidence = []
    if sid:
        evidence.append(f'SID {sid / 1000:.2f} m')
    if 'PA' in desc.split() or 'PA &' in desc:
        evidence.append(f'description "{desc.strip()}"')
    if sid >= 1500:
        return 'PA', evidence
    if 0 < sid <= 1200:
        return 'AP', evidence
    return None, evidence


def main():
    OUT.mkdir(exist_ok=True)
    rows, done = [], set()
    for f in sorted(glob.glob(str(HERE / 'LIDC-IDRI-*' / '*.dcm'))):
        pid = Path(f).parent.name
        d = pydicom.dcmread(f)
        if pid in done or list(d.get('PatientOrientation', [])) != ['L', 'F']:
            continue
        view, evidence = view_from_headers(d)
        if view is None:
            rows.append({'patient': pid, 'source': Path(f).name, 'view': 'not determined', 'evidence': '; '.join(evidence) or 'none', 'check': 'skipped: view unknown'})
            continue
        d.ViewPosition = view
        notes = [VISUAL_NOTES.get(pid, '')]
        clip = clipped_by_window(d)
        if clip > 0.5:
            notes.append(f'Stored display window {d.WindowCenter}/{d.WindowWidth} clipped {clip:.1%} of pixels; removed so the image is scaled over its stored range.')
            del d.WindowCenter, d.WindowWidth
        if pid in VISUAL_FIXES:
            tag, value, why = VISUAL_FIXES[pid]
            setattr(d, tag, value)
            notes.append(why)
        note = ' '.join(x for x in notes if x)
        d.ImageComments = (f'Research test copy. ViewPosition {view} inferred from headers ({"; ".join(evidence)}) and PatientOrientation L\\F (frontal). '
                           f'Not an original header. {note}')[:10240]
        d.save_as(OUT / f'{pid}.dcm')
        done.add(pid)
        rows.append({'patient': pid, 'source': Path(f).name, 'view': view, 'evidence': '; '.join(evidence), 'check': note or 'consistent'})
    with open(HERE / 'cxr_manifest.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=['patient', 'source', 'view', 'evidence', 'check'])
        w.writeheader(); w.writerows(rows)
    for r in rows:
        print(f"{r['patient']}  {r['view']:4}  {r['evidence']}  {('· ' + r['check']) if r['check'] != 'consistent' else ''}")


if __name__ == '__main__':
    main()
