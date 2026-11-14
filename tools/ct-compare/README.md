# CT upload and comparison: nodule size measurement

`backend/ct_compare.py` uploads a CT series, lets Gemini find and read the most suspicious
nodule, **measures it from the pixels**, matches it against the 25 public LIDC-IDRI reference
studies, and summarises the raw data for clinician approval.

## Why measure from the pixels

Gemini locates nodules well but sizes them poorly (6.5 mm for an 11.4 mm nodule; 21.6 mm for
27.7 mm). The size now comes from a deterministic measurement; the AI's estimate is kept in the
raw data for comparison.

1. Gemini boxes the nodule on the key slice (`box_2d`, normalised 0-1000); the box centre is the seed.
2. `backend/ct_measure.py` measures it (numpy/scipy, no network):
   - **A** (`ct_measure_a.py`, refined segmentation, used first): hill-climbs to the nodule's
     density peak inside a lung mask, thresholds between nodule and lung density, cuts attached
     vessels with erosion of 0-5 mm (most compact shape wins, never removing more than 40% of the
     diameter), adds back a faint rim, and reports the longest axial (Feret) diameter, the
     perpendicular short axis and the volume.
   - **B** (`ct_measure_b.py`, blob-centred, fallback when A cannot measure): a 3-D blob detector
     re-centres the seed; radius from radial shells; sphere-constrained segmentation.
3. The measured size and its size-based Lung-RADS band drive the matching.

A and B were developed by two agents in parallel from the same baseline and compared with
`validate_measure.py`.

## Validation against the LIDC-IDRI radiologists

`validate_measure.py` seeds at the radiologists' mean nodule centre (optionally moved by
`--seed-jitter-mm`) and compares with the readers' mean greatest axial diameter.
Consensus = nodules marked by at least 3 of 4 radiologists.

| Method | Set | Measured | Mean abs. error | Median | Within 3 mm |
|---|---|---|---|---|---|
| Baseline (first version) | 28 development scans, consensus | 20/21 | 3.0 mm | 1.3 mm | 16/20 |
| A | 28 development scans, consensus | 20/21 | 0.7 mm | 0.4 mm | 20/20 |
| B | 28 development scans, consensus | 21/21 | 1.4 mm | 0.7-0.9 mm | 17-18/21 |
| **A + B fallback (in use)** | 28 development scans, consensus | **21/21** | **0.8 mm** | **0.5 mm** | **21/21** |
| **A + B fallback (in use)** | **4 held-out scans** (not used for tuning) | **4/4** | **0.7 mm** | **0.4 mm** | **4/4** |

Held-out scans (LIDC-IDRI): 0559 6.0 -> 6.4 mm; 0005 7.9 -> 7.5 mm; 0151 10.2 -> 10.1 mm; 0079 16.1 -> 14.1 mm.
Results are unchanged with a 3 mm seed offset. End to end with Gemini's box on the demo uploads:
0212 4.8 -> 4.8 mm; 0110 11.4 -> 10.9 mm; 0078 27.7 -> 25.1 mm. Runtime: under 3 s per scan.

Limits: small samples; the 28 development scans were used for tuning; ground-glass nodules
remain the hardest; single-reader "truths" (e.g. 0575, 0029) are uncertain. Research only.

## Run

```
~/candex-data/.venv/bin/python tools/ct-compare/validate_measure.py [--module backend.ct_measure] [--seed-jitter-mm 3] [--dir ~/candex-data/heldout]
```
Needs the LIDC-IDRI DICOM folders in `~/candex-data/LIDC-IDRI` (25 reference studies) and pylidc.
