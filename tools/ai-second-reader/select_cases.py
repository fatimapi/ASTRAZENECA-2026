"""Pick a random, Lung-RADS-balanced sample of LIDC-IDRI patients from the
radiologists' annotations bundled with pylidc. No images are needed.

Size bands follow Lung-RADS v2022 baseline rules for solid nodules
(<6 mm -> 2, 6-<8 -> 3, 8-<15 -> 4A, >=15 -> 4B). "4X-like" = >=15 mm with
radiologists' mean malignancy >=4.5 and spiculation >=3. This is a demo
approximation: LIDC has no Lung-RADS labels, and part-solid/ground-glass rules
are simplified.

Writes cases.csv (one row per patient) and nodules.csv (one row per nodule).
"""
import csv
import random
import warnings
from statistics import mean

warnings.filterwarnings("ignore")
import numpy as np  # noqa: E402

# pylidc (2019) still uses aliases that NumPy removed in 1.24.
for _name, _type in (("int", int), ("float", float), ("bool", bool)):
    if not hasattr(np, _name):
        setattr(np, _name, _type)
import pylidc as pl  # noqa: E402

SEED = 2026
PER_BAND = 5
BANDS = ["2", "3", "4A", "4B", "4X-like"]


def band_for(diam, malig, spic):
    if diam >= 15 and malig >= 4.5 and spic >= 3:
        return "4X-like"
    if diam >= 15:
        return "4B"
    if diam >= 8:
        return "4A"
    if diam >= 6:
        return "3"
    return "2"


rank = {b: i for i, b in enumerate(BANDS)}
patients = {}  # patient_id -> info for the most severe nodule
nodule_rows = []

for scan in pl.query(pl.Scan).all():
    if scan.patient_id in patients:  # a few patients have 2 scans; keep the first
        continue
    best = None
    for i, cluster in enumerate(scan.cluster_annotations(verbose=False), start=1):
        diam = mean(a.diameter for a in cluster)
        malig = mean(a.malignancy for a in cluster)
        spic = mean(a.spiculation for a in cluster)
        texture = mean(a.texture for a in cluster)  # 1 = ground glass, 5 = solid
        b = band_for(diam, malig, spic)
        row = dict(patient_id=scan.patient_id, nodule=i, readers=len(cluster),
                   diameter_mm=round(diam, 1), malignancy=round(malig, 2),
                   spiculation=round(spic, 2), texture=round(texture, 2), band=b)
        nodule_rows.append(row)
        if best is None or (rank[b], diam) > (rank[best["band"]], best["diameter_mm"]):
            best = row
    if best is None:
        continue
    patients[scan.patient_id] = dict(
        patient_id=scan.patient_id, series_uid=scan.series_instance_uid,
        slice_mm=scan.slice_thickness, band=best["band"],
        max_diameter_mm=best["diameter_mm"], malignancy=best["malignancy"],
        nodules=sum(1 for r in nodule_rows if r["patient_id"] == scan.patient_id))

rng = random.Random(SEED)
chosen = []
for b in BANDS:
    pool = sorted(p for p, v in patients.items() if v["band"] == b)
    print(f"band {b:8} available {len(pool):4}")
    chosen += rng.sample(pool, min(PER_BAND, len(pool)))

with open("cases.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(next(iter(patients.values())).keys()))
    w.writeheader()
    for p in chosen:
        w.writerow(patients[p])
with open("nodules.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(nodule_rows[0].keys()))
    w.writeheader()
    for r in nodule_rows:
        if r["patient_id"] in chosen:
            w.writerow(r)
print(f"chose {len(chosen)} patients -> cases.csv, nodules.csv")
