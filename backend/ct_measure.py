"""Measure a lung nodule from the CT pixels, given an approximate location (research prototype).

Combined method, chosen after validation against the LIDC-IDRI radiologists
(tools/ct-compare/validate_measure.py):
  1. backend/ct_measure_a.py: refined classical segmentation (hill-climb seed inside a lung
     mask, density threshold, vessel cuts chosen for the most compact shape, faint-rim
     correction, max axial Feret diameter). Most accurate where it succeeds.
  2. backend/ct_measure_b.py: blob-centred hybrid (3-D blob detector re-centres the seed,
     robust radius from radial shells, sphere-constrained segmentation). Used only when (1)
     cannot measure, e.g. some ground-glass nodules.
Returns None when neither can measure; callers then fall back to the AI's own estimate.
"""
from __future__ import annotations

from typing import Optional

from . import ct_measure_a as _a
from . import ct_measure_b as _b


def measure_nodule(vol, px: float, spacing: float, slice_idx: int, center_rc, half_mm: Optional[float] = None,
                   max_mm: float = 50.0, why: Optional[list] = None) -> Optional[dict]:
    reasons: list = []
    kw = {"max_mm": max_mm, "why": reasons}
    if half_mm is not None:
        kw["half_mm"] = half_mm
    m = _a.measure_nodule(vol, px, spacing, slice_idx, center_rc, **kw)
    if m:
        return {**m, "engine": "A (refined segmentation)"}
    m = _b.measure_nodule(vol, px, spacing, slice_idx, center_rc, **kw)
    if m:
        return {**m, "engine": "B (blob-centred fallback)"}
    if why is not None:
        why.extend(reasons)
    return None


def lung_rads_by_size(mean_mm: float) -> str:
    """Approximate Lung-RADS v2022 for a solid baseline nodule by mean diameter (size only)."""
    return "2" if mean_mm < 6 else "3" if mean_mm < 8 else "4A" if mean_mm < 15 else "4B"
