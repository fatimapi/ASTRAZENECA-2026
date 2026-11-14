"""Measure a lung nodule from the CT pixels, given a rough location (research prototype).

The AI finds the nodule; this module measures it, deterministically:
  1. a box around the given location (lungs found on full slices, air not touching the border);
  2. lung mask: air inside the body, closed with a rolling ball so nodules touching the
     pleura stay inside (closing via distance transforms, on the search box only); the
     seed is the nearest local density maximum to the location (hill-climb), restricted
     to the lung mask so the chest wall is never taken for a juxtapleural nodule; if no
     dense tissue is found the ball is enlarged (broad-based pleural nodules);
  3. threshold: part-way between the nodule's peak density and the surrounding lung,
     clamped to a sensible HU range;
  4. the 3-D connected region containing the seed is eroded by 0-5 mm and regrown
     inside itself to cut vessels / wall bridges; among the plausible candidates the
     most compact one (volume relative to the sphere of its longest diameter) wins,
     preferring the least erosion when compactness is similar (and never a candidate that
     lost > 40 % of the diameter, i.e. the nodule itself was eroded away); a <= 1 px rim of
     partial-volume voxels (above a lower threshold) is then added back;
  5. size: the longest axial diameter on any slice (max Feret diameter, as in the
     LIDC radiologists' "greatest axial diameter"), the perpendicular short axis,
     and the volume.
Returns None when no plausible nodule can be measured, so callers fall back to the
AI's own estimate. Pure numpy/scipy; no network.
"""
from __future__ import annotations

import math
from typing import Optional

import numpy as np
from scipy import ndimage

def _feret(points: np.ndarray, px: float):
    """Longest distance between pixel centres (+1 px for pixel extent) and the perpendicular width, in mm."""
    if len(points) == 1:
        return px, px
    if len(points) > 400:  # boundary points are enough for the extremes
        points = points[np.linspace(0, len(points) - 1, 400).astype(int)]
    d = np.sqrt(((points[:, None, :] - points[None, :, :]) ** 2).sum(-1))
    i, j = np.unravel_index(np.argmax(d), d.shape)
    long_px = d[i, j]
    axis = (points[j] - points[i]) / (long_px or 1)
    perp = np.array([-axis[1], axis[0]])
    proj = points @ perp
    return (long_px + 1) * px, (proj.max() - proj.min() + 1) * px


def _disk(radius_px: int):
    r = max(1, int(radius_px))
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def _close2d(m: np.ndarray, r_px: float) -> np.ndarray:
    """Binary closing with a disk of radius r_px via distance transforms (cost independent of r)."""
    p = int(math.ceil(r_px)) + 2
    mp = np.pad(m, p)
    dil = ndimage.distance_transform_edt(~mp) <= r_px
    clo = ndimage.distance_transform_edt(dil) > r_px
    return clo[p:-p, p:-p]


def _body_air(slab: np.ndarray) -> np.ndarray:
    """Per slice: air (HU < -400) not connected to the image border (i.e. the lungs / airways)."""
    out = np.zeros(slab.shape, bool)
    for z in range(slab.shape[0]):
        air = slab[z] < -400
        lab, n = ndimage.label(air)
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        keep = np.ones(n + 1, bool)
        keep[border] = False
        keep[0] = False
        out[z] = keep[lab]
    return out


def _lung_mask(air: np.ndarray, px: float, ball_mm: float) -> np.ndarray:
    out = np.zeros(air.shape, bool)
    for z in range(air.shape[0]):
        out[z] = ndimage.binary_fill_holes(_close2d(air[z], ball_mm / px))
    return out


def _measure(comp: np.ndarray, px: float):
    best = (0.0, 0.0, None)
    for z in range(comp.shape[0]):
        if not comp[z].any():
            continue
        edge_px = comp[z] & ~ndimage.binary_erosion(comp[z])
        pts = np.argwhere(edge_px if edge_px.any() else comp[z]).astype(np.float32)
        lo, sh = _feret(pts, px)
        if lo > best[0]:
            best = (lo, sh, z)
    return best


def measure_nodule(vol: np.ndarray, px: float, spacing: float, slice_idx: int, center_rc, half_mm: float = 30.0,
                   max_mm: float = 50.0, why: Optional[list] = None) -> Optional[dict]:
    """vol: HU volume (z, rows, cols). center_rc: (row, col) in pixels on slice_idx.
    why: optional list that receives the reason when no measurement is returned."""
    nz, nr, nc = vol.shape
    r, c = int(round(center_rc[0])), int(round(center_rc[1]))
    zr = max(1, int(math.ceil((max_mm / 2) / max(spacing, 0.5))))
    z0, z1 = max(0, slice_idx - zr), min(nz, slice_idx + zr + 1)
    k = slice_idx - z0
    note = lambda m: (why.append(m) if why is not None else None)
    # 1. lung mask around the location (air not touching the image border, closed with a rolling ball)
    if not (0 <= r < nr and 0 <= c < nc):
        note("location outside the image"); return None
    slab = np.asarray(vol[z0:z1], dtype=np.float32)
    half = max(8, int(round(half_mm / px))) + int(round(6.0 / px))
    r0, r1, c0, c1 = max(0, r - half), min(nr, r + half + 1), max(0, c - half), min(nc, c + half + 1)
    air = _body_air(slab)  # border test needs the full slices; the closing only the box (+ margin)
    mg = int(round(30.0 / px))
    R0, R1, C0, C1 = max(0, r0 - mg), min(nr, r1 + mg), max(0, c0 - mg), min(nc, c1 + mg)
    air_b = air[:, R0:R1, C0:C1]
    sub = slab[:, r0:r1, c0:c1]
    cut = (slice(None), slice(r0 - R0, r1 - R0), slice(c0 - C0, c1 - C0))
    # 2. seed: densest point (lightly smoothed) within ~6 mm of the location AND inside the lung mask, so a
    #    small juxtapleural nodule is not confused with the chest wall next to it; if no dense tissue is found
    #    inside the lungs there (broad-based pleural nodule), the rolling ball is enlarged
    sm = ndimage.gaussian_filter(sub[k], 1.0)
    rr, cc = np.ogrid[:sub.shape[1], :sub.shape[2]]
    near = (rr - (r - r0)) ** 2 + (cc - (c - c0)) ** 2 <= (6.0 / px) ** 2
    best = None
    for ball_mm in BALLS:
        lsub = _lung_mask(air_b, px, ball_mm)[cut]
        cand_px = near & lsub[k]
        if not cand_px.any():
            continue
        sr_, sc_ = np.unravel_index(np.argmax(np.where(cand_px, sm, -2000)), sm.shape)
        if HILL:  # hill-climb from the given location: the nearest local density maximum (not the pleura rim)
            ys, xs = np.nonzero(cand_px)
            j = np.argmin((ys - (r - r0)) ** 2 + (xs - (c - c0)) ** 2)
            hy, hx = ys[j], xs[j]
            stp = max(1, int(round(HILL_MM / px)))
            for _ in range(50):
                ya, yb, xa, xb = max(0, hy - stp), hy + stp + 1, max(0, hx - stp), hx + stp + 1
                w = np.where(cand_px[ya:yb, xa:xb], sm[ya:yb, xa:xb], -2000)
                dy, dx = np.unravel_index(np.argmax(w), w.shape)
                ny, nx = ya + dy, xa + dx
                if (ny, nx) == (hy, hx):
                    break
                hy, hx = ny, nx
            if sm[hy, hx] >= HILL_MIN_HU:
                sr_, sc_ = hy, hx
        if best is None or sm[sr_, sc_] > best[0] + 100:
            best = (float(sm[sr_, sc_]), sr_, sc_, lsub)
        if best[0] >= SOLID_HU:
            break
    if best is None:
        note("the location is not inside the lungs"); return None
    peak, ksr, ksc, lsub = best
    if peak < -750:
        note(f"no dense tissue at the location (peak {peak:.0f} HU)"); return None
    lung_hu = min(float(np.percentile(sub[k][lsub[k]], LUNG_PCT)) if lsub[k].any() else -850.0, -700.0)
    thr = min(-250.0, max(-750.0, lung_hu + FRAC * (peak - lung_hu)))
    mask = (sub > thr) & lsub
    st = ndimage.generate_binary_structure(3, 1)
    lab, _ = ndimage.label(mask, structure=st)
    seed_lab = lab[k, ksr, ksc]
    if seed_lab == 0:  # the raw seed voxel may be just below threshold (noise): take the nearest region voxel
        ys, xs = np.nonzero(lab[k])
        if len(ys):
            j = np.argmin((ys - ksr) ** 2 + (xs - ksc) ** 2)
            if (ys[j] - ksr) ** 2 + (xs[j] - ksc) ** 2 <= (2.0 / px) ** 2:
                ksr, ksc = int(ys[j]), int(xs[j]); seed_lab = lab[k, ksr, ksc]
    if seed_lab == 0:
        note(f"the location is not inside the lungs (below threshold {thr:.0f}, peak {peak:.0f})"); return None
    comp0 = lab == seed_lab
    # 2. break thin vessel / wall connections: erode, keep the seed's piece, grow back inside the original
    cands = []
    dist_in = np.stack([ndimage.distance_transform_edt(m) for m in comp0])  # in-plane distance to background, px
    for r_mm in (0.0, 1.0, 1.5, 2.0, 3.0, 4.0, 5.0):
        if r_mm == 0:
            cand = comp0
        else:
            rp = r_mm / px
            er = dist_in > rp
            lab2, _ = ndimage.label(er, structure=st)
            sl = lab2[k, ksr, ksc]
            if sl == 0:
                ys, xs = np.nonzero(lab2[k])
                if not len(ys):
                    break
                j = np.argmin((ys - ksr) ** 2 + (xs - ksc) ** 2)
                if (ys[j] - ksr) ** 2 + (xs[j] - ksc) ** 2 > (5.0 / px) ** 2:
                    break
                sl = lab2[k, ys[j], xs[j]]
            core = lab2 == sl
            grown = np.stack([ndimage.distance_transform_edt(~m) <= rp + REGROW if m.any() else m for m in core])
            cand = grown & comp0
        edge = cand[:, 0, :].sum() + cand[:, -1, :].sum() + cand[:, :, 0].sum() + cand[:, :, -1].sum()
        long_mm, short_mm, zbest = _measure(cand, px)
        nvox = float(cand.sum())
        vol_mm3 = nvox * px * px * spacing
        compact = vol_mm3 / (math.pi / 6 * max(long_mm, px) ** 3)
        ok = not (edge > 0.02 * nvox + 2 or not (2.5 <= long_mm <= max_mm) or long_mm / max(short_mm, 0.1) > 2.2)
        cands.append(dict(r_mm=r_mm, long=long_mm, short=short_mm, z=zbest, vol=vol_mm3, compact=compact, ok=ok, cand=cand, edge=int(edge)))
    good = [d for d in cands if d["ok"]]
    if not good:
        note("no compact nodule-shaped region (attached to vessels or the chest wall)")
        return None
    best = good[0]
    for d in good[1:]:
        if d["compact"] > best["compact"] * COMPACT_GAIN and d["long"] >= KEEP_FRAC * best["long"]:
            best = d
    cand, long_mm, short_mm, zbest, r_mm = best["cand"], best["long"], best["short"], best["z"], best["r_mm"]
    # 3. partial-volume rim: the boundary voxels of a small nodule are diluted by the lung around them; add
    #    at most EXPAND_PX px (in-plane) of voxels above a lower threshold, which cannot leak far
    if EXPAND_PX > 0:
        thr_lo = lung_hu + EXPAND_FRAC * (peak - lung_hu)
        rim = np.stack([ndimage.distance_transform_edt(~m) <= EXPAND_PX if m.any() else m for m in cand])
        cand = cand | (rim & (sub > thr_lo) & lsub)
        long_mm, short_mm, zbest = _measure(cand, px)
    return {"long_mm": round(long_mm, 1), "short_mm": round(short_mm, 1), "mean_mm": round((long_mm + short_mm) / 2, 1),
            "volume_mm3": round(float(cand.sum()) * px * px * spacing), "slices": int(cand.any(axis=(1, 2)).sum()),
            "threshold_hu": round(thr), "peak_hu": round(peak), "vesselCutMm": r_mm, "bestSliceOffset": int(zbest + z0 - slice_idx), "seedRC": [int(ksr + r0), int(ksc + c0)],
            "method": "lung mask + density threshold from the AI's location, vessels cut by erosion and regrown (most compact candidate), max axial Feret diameter"}


FRAC = 0.45
REGROW = 0.5
LUNG_PCT = 25
KEEP_FRAC = 0.6
BALLS = (10.0, 15.0, 20.0, 25.0)
SOLID_HU = -300.0
EXPAND_PX = 1.0
HILL = True
HILL_MM = 1.5
HILL_MIN_HU = -650.0
EXPAND_FRAC = 0.15
COMPACT_GAIN = 1.1


def lung_rads_by_size(mean_mm: float) -> str:
    """Approximate Lung-RADS v2022 for a solid baseline nodule by mean diameter (size only)."""
    return "2" if mean_mm < 6 else "3" if mean_mm < 8 else "4A" if mean_mm < 15 else "4B"
