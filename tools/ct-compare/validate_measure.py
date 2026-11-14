"""Validate backend/ct_measure.py against the LIDC-IDRI radiologists.

For each CT (the 25 reference studies + the 3 demo uploads), seed the measurement at
the radiologists' mean centroid of the main nodule and compare the measured longest
axial diameter with the readers' mean diameter (pylidc "diameter": greatest axial
diameter). This tests the measurement step alone, independent of AI localisation.

Usage (data venv with pylidc):
  ~/candex-data/.venv/bin/python tools/ct-compare/validate_measure.py [--module backend.ct_measure] [--seed-jitter-mm 0]
--seed-jitter-mm moves the seed by that distance (a realistic AI localisation error) to test robustness.
"""
import csv, glob, sys, warnings
from pathlib import Path
from statistics import mean
import numpy as np
warnings.filterwarnings("ignore")
for _n, _t in (("int", int), ("float", float), ("bool", bool)):
    if not hasattr(np, _n): setattr(np, _n, _t)
import pydicom, pylidc as pl
REPO = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO))
import argparse, importlib, time
ap = argparse.ArgumentParser(); ap.add_argument('--module', default='backend.ct_measure'); ap.add_argument('--seed-jitter-mm', type=float, default=0.0); ap.add_argument('--dir', default=None, help='only validate the CT folders in this directory (e.g. a held-out set)')
ARGS = ap.parse_args()
measure_nodule = importlib.import_module(ARGS.module).measure_nodule

DATA = Path.home() / "candex-data"
DEMO = REPO / "demo-data" / "ct-uploads"
folders = {p.name: p for p in sorted((DATA / "LIDC-IDRI").glob("LIDC-IDRI-*"))}
folders.update({p.name: p for p in sorted(DEMO.glob("LIDC-IDRI-*"))})
if ARGS.dir:
    folders = {p.name: p for p in sorted(Path(ARGS.dir).expanduser().glob("LIDC-IDRI-*")) if (p / '.done').exists() or any(p.glob('*.dcm'))}
rows = []
for pid, folder in folders.items():
    sl = [pydicom.dcmread(f) for f in folder.glob("*.dcm")]
    sl = [s for s in sl if hasattr(s, "ImagePositionPatient") and str(s.get("Modality", "")) == "CT"]
    sl.sort(key=lambda s: float(s.ImagePositionPatient[2]))
    zs = np.array([float(s.ImagePositionPatient[2]) for s in sl])
    vol = np.stack([s.pixel_array.astype(np.float32) * float(s.RescaleSlope) + float(s.RescaleIntercept) for s in sl])
    px = float(sl[0].PixelSpacing[0]); spacing = float(np.median(np.diff(zs)))
    scan = pl.query(pl.Scan).filter(pl.Scan.series_instance_uid == str(sl[0].SeriesInstanceUID)).first()
    if scan is None: continue
    szs = np.array(sorted(scan.slice_zvals))
    clusters = [c for c in scan.cluster_annotations(verbose=False)]
    main = max(clusters, key=lambda c: (len(c) >= 3, mean(a.diameter for a in c)))
    r, c, k = np.array([a.centroid for a in main]).mean(axis=0)
    z = float(np.interp(k, np.arange(len(szs)), szs))
    idx = int(np.argmin(np.abs(zs - z)))
    truth = mean(a.diameter for a in main)
    why = []
    jr = ARGS.seed_jitter_mm / px / 1.4142
    t = time.time()
    m = measure_nodule(vol, px, abs(spacing), idx, (r + jr, c + jr), why=why)
    dt = time.time() - t
    rows.append({"patient": pid, "readers": len(main), "truth_mm": round(truth, 1), "measured_mm": m["long_mm"] if m else "", "short_mm": m["short_mm"] if m else "",
                 "error_mm": round(m["long_mm"] - truth, 1) if m else "", "texture": round(mean(a.texture for a in main), 1), "seconds": round(dt, 2)})
    print(f"{pid}  truth {truth:5.1f}  measured {str(m['long_mm']) if m else '-':>5}  readers {len(main)}  texture {rows[-1]['texture']}  {'' if m else why[-1] if why else ''}")
ok = [r for r in rows if r["measured_mm"] != ""]
err = np.array([r["error_mm"] for r in ok])
def summary(label, rs):
    ok = [r for r in rs if r["measured_mm"] != ""]
    e = np.array([r["error_mm"] for r in ok]) if ok else np.array([0.0])
    print(f"{label}: measured {len(ok)}/{len(rs)}; mean absolute error {np.abs(e).mean():.1f} mm; median {np.median(np.abs(e)):.1f} mm; bias {e.mean():+.1f} mm; within 3 mm: {(np.abs(e) <= 3).sum()}/{len(ok)}; within 20%: {sum(abs(r['error_mm']) <= 0.2 * r['truth_mm'] for r in ok)}/{len(ok)}")
print()
summary("All nodules", rows)
summary("Consensus (>= 3 of 4 readers)", [r for r in rows if r["readers"] >= 3])
print(f"max time per scan: {max(r['seconds'] for r in rows):.1f} s")
with open(Path(__file__).with_name(f"measure_validation_{ARGS.module.split('.')[-1]}{'_heldout' if ARGS.dir else ''}.csv"), "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
