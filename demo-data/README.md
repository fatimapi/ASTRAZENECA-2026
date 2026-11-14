# Demo scans (public LIDC-IDRI research data)

Real, de-identified chest scans for demonstrating Candex. Fictional patients only; research use;
not for patient care.

## `ct-uploads/` — chest CT series for "Upload CT and compare"

Three CT series that are **not** among the 25 reference studies in `data/lidc/`, so the comparison
has to find the closest public study. Doctor → Imaging review → **Upload CT and compare** →
**Choose folder** → pick one folder below (all its `.dcm` files).

| Folder | Slices | Main nodule (mean of >= 3 of 4 LIDC radiologists) | Position (z) and side | Approx. Lung-RADS by size |
|---|---|---|---|---|
| LIDC-IDRI-0212 | 133 (2.5 mm) | 4.8 mm, solid | z -90 mm, left | 2 |
| LIDC-IDRI-0110 | 125 (3.0 mm) | 11.4 mm (and 8.9 mm), right | z -298 mm, right | 4A |
| LIDC-IDRI-0078 | 87 (3.0 mm) | 27.7 mm (and 23.9, 20.7 mm), left | z 1606 mm, left | 4B or higher |

In testing (14 Nov 2026) the AI found each main nodule at the right position and side; it
underestimated the size of the larger nodules (6.6 mm vs 11.4 mm; 21.6 mm vs 27.7 mm).

## `chest-xrays/` — frontal chest X-rays for "DICOM AI analysis"

Eight frontal chest X-ray **test copies** (one per LIDC-IDRI patient). Doctor → Imaging review →
**Analyze chest X-ray DICOM** → choose one file.

Changes made to the originals (CC BY 3.0 requires that changes are indicated; details in
`cxr_manifest.csv` and each file's ImageComments):
- `ViewPosition` added (PA), inferred from header evidence; the originals have no view tag.
- LIDC-IDRI-0051: a stored display window that turned the image white was removed.
- LIDC-IDRI-0116: relabelled MONOCHROME1 because its pixel data is inverted.

## Source and licence

LIDC-IDRI, The Cancer Imaging Archive (TCIA), licensed **CC BY 3.0**
(https://creativecommons.org/licenses/by/3.0/).
Armato SG III et al. The Lung Image Database Consortium (LIDC) and Image Database Resource
Initiative (IDRI). Medical Physics 2011;38(2):915-931. doi:10.1118/1.3528204.
Data: doi:10.7937/K9/TCIA.2015.LO9QL9SX. Clark K et al. The Cancer Imaging Archive (TCIA).
J Digit Imaging 2013;26(6):1045-1057.
