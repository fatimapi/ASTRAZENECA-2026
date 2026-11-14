"""Measure a lung nodule from the CT pixels, given a rough location (research prototype).

The AI finds the nodule; this module measures it, deterministically:
  1. seed: the densest point (lightly smoothed) near the given location;
  2. threshold: half-way between the nodule's peak density and the surrounding lung
     (half-maximum), clamped to a sensible HU range;
  3. a light morphological opening detaches thin vessels; the 3-D connected region
     containing the seed is the nodule; if it leaks to the edge of the search box
     (chest wall, large vessels) the threshold is raised and it is retried;
  4. size: the longest axial diameter on any slice (max Feret diameter, as in the
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


def _lung_mask(slab: np.ndarray, px: float) -> np.ndarray:
    """Per slice: air inside the body (HU < -400, not touching the image border), closed with a
    ~10 mm rolling ball and hole-filled, so vessels and nodules touching the pleura stay inside."""
    out = np.zeros(slab.shape, bool)
    ball = _disk(round(10.0 / px))
    for z in range(slab.shape[0]):
        air = slab[z] < -400
        lab, n = ndimage.label(air)
        border = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]])))
        lung = np.isin(lab, [i for i in range(1, n + 1) if i not in border])
        lung = ndimage.binary_closing(np.pad(lung, ball.shape[0]), structure=ball)[ball.shape[0]:-ball.shape[0], ball.shape[0]:-ball.shape[0]]
        out[z] = ndimage.binary_fill_holes(lung)
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


def _baseline(vol: np.ndarray, px: float, spacing: float, slice_idx: int, center_rc, half_mm: float = 30.0,
                   max_mm: float = 50.0, why: Optional[list] = None) -> Optional[dict]:
    """vol: HU volume (z, rows, cols). center_rc: (row, col) in pixels on slice_idx.
    why: optional list that receives the reason when no measurement is returned."""
    nz, nr, nc = vol.shape
    r, c = int(round(center_rc[0])), int(round(center_rc[1]))
    zr = max(1, int(math.ceil((max_mm / 2) / max(spacing, 0.5))))
    z0, z1 = max(0, slice_idx - zr), min(nz, slice_idx + zr + 1)
    k = slice_idx - z0
    note = lambda m: (why.append(m) if why is not None else None)
    # 1. seed: densest point within ~6 mm of the given centre (lightly smoothed)
    sm = ndimage.gaussian_filter(vol[slice_idx].astype(np.float32), 1.0)
    rr, cc = np.ogrid[:nr, :nc]
    near = (rr - r) ** 2 + (cc - c) ** 2 <= (6.0 / px) ** 2
    if not near.any():
        note("location outside the image"); return None
    sr, sc = np.unravel_index(np.argmax(np.where(near, sm, -2000)), sm.shape)
    peak = float(sm[sr, sc])
    if peak < -750:
        note(f"no dense tissue at the location (peak {peak:.0f} HU)"); return None
    slab = vol[z0:z1].astype(np.float32)
    lungs = _lung_mask(slab, px)
    half = max(8, int(round(half_mm / px)))
    r0, r1, c0, c1 = max(0, sr - half), min(nr, sr + half + 1), max(0, sc - half), min(nc, sc + half + 1)
    sub, lsub = slab[:, r0:r1, c0:c1], lungs[:, r0:r1, c0:c1]
    ksr, ksc = sr - r0, sc - c0
    lung_hu = min(float(np.percentile(sub[k][lsub[k]], 25)) if lsub[k].any() else -850.0, -700.0)
    thr = min(-250.0, max(-750.0, lung_hu + 0.45 * (peak - lung_hu)))
    mask = (sub > thr) & lsub
    lab, _ = ndimage.label(mask, structure=ndimage.generate_binary_structure(3, 1))
    seed_lab = lab[k, ksr, ksc]
    if seed_lab == 0:
        note("the location is not inside the lungs"); return None
    comp0 = lab == seed_lab
    # 2. break thin vessel / wall connections: erode, keep the seed's piece, grow back inside the original
    for r_mm in (0.0, 1.0, 1.5, 2.0, 3.0):
        if r_mm == 0:
            cand = comp0
        else:
            dk = _disk(round(r_mm / px))
            er = np.stack([ndimage.binary_erosion(m, structure=dk) for m in comp0])
            lab2, _ = ndimage.label(er, structure=ndimage.generate_binary_structure(3, 1))
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
            cand = np.stack([ndimage.binary_dilation(m, structure=dk) for m in core]) & comp0
        edge = cand[:, 0, :].sum() + cand[:, -1, :].sum() + cand[:, :, 0].sum() + cand[:, :, -1].sum()
        long_mm, short_mm, zbest = _measure(cand, px)
        if edge > 0.02 * cand.sum() + 2 or not (2.5 <= long_mm <= max_mm) or long_mm / max(short_mm, 0.1) > 2.2:
            continue
        return {"long_mm": round(long_mm, 1), "short_mm": round(short_mm, 1), "mean_mm": round((long_mm + short_mm) / 2, 1),
                "volume_mm3": round(float(cand.sum()) * px * px * spacing), "slices": int(cand.any(axis=(1, 2)).sum()),
                "threshold_hu": round(thr), "peak_hu": round(peak), "vesselCutMm": r_mm, "bestSliceOffset": int(zbest + z0 - slice_idx),
                "method": "lung mask + density threshold from the AI's location, vessels cut by erosion and regrown, max axial Feret diameter"}
    note("no compact nodule-shaped region (attached to vessels or the chest wall)")
    return None


def lung_rads_by_size(mean_mm: float) -> str:
    """Approximate Lung-RADS v2022 for a solid baseline nodule by mean diameter (size only)."""
    return "2" if mean_mm < 6 else "3" if mean_mm < 8 else "4A" if mean_mm < 15 else "4B"


# ---------------------------------------------------------------------------------------------
# Strategy B: multi-scale 3-D blob detection (scale-normalised LoG) to re-centre the seed and
# estimate the nodule radius, then a half-maximum segmentation constrained to a sphere around
# the blob (prevents leaks into vessels / chest wall for large nodules), vessel cut by
# erosion/regrowth, max axial Feret diameter. Falls back to the baseline when it fails.
# ---------------------------------------------------------------------------------------------
_SCALES_MM = (1.0, 1.4, 1.9, 2.5, 3.3, 4.3, 5.6, 7.2, 9.3, 12.0)
FRAC = 0.30  # threshold = lung + FRAC*(peak - lung): readers trace the outer edge
CAP_K, CAP_B = 2.0, 2.0
OPEN_K, OPEN_MAX = 0.3, 3.0


def _fast_lung_mask(slices: np.ndarray, px: float) -> np.ndarray:
    """Baseline lung mask (air inside the body, closed with a ~10 mm ball, holes filled) computed at ~2 mm
    in-plane for speed and upsampled back."""
    f = max(1, int(round(2.0 / px)))
    nz, nr, nc = slices.shape
    small = slices[:, ::f, ::f]
    ball = _disk(max(2, round(10.0 / (px * f))))
    pw = ball.shape[0]
    out = np.zeros(small.shape, bool)
    for z in range(small.shape[0]):
        air = small[z] < -400
        lab, n = ndimage.label(air)
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        lung = (lab > 0) & ~np.isin(lab, border)
        lung = ndimage.binary_closing(np.pad(lung, pw), structure=ball)[pw:-pw, pw:-pw]
        out[z] = ndimage.binary_fill_holes(lung)
    big = np.repeat(np.repeat(out, f, axis=1), f, axis=2)[:, :nr, :nc]
    return big


def _blob(sub: np.ndarray, vox, seed, search_mm: float, allowed=None):
    """Scale-normalised LoG on a ~1 mm isotropic copy, distance-weighted to the seed.
    Returns (centre voxel in sub, radius mm)."""
    zf = [v / 1.0 for v in vox]
    small = ndimage.zoom(np.clip(sub, -1000, 100), zf, order=1)
    al = None if allowed is None else ndimage.zoom(allowed.astype(np.uint8), zf, order=0).astype(bool)
    if al is not None and al.shape != small.shape:
        al = None
    sd = [seed[i] * zf[i] for i in range(3)]
    g = np.ogrid[tuple(slice(0, n) for n in small.shape)]
    d2 = sum((g[i] - sd[i]) ** 2 for i in range(3))
    wgt = np.exp(-d2 / (2 * (0.6 * search_mm) ** 2))
    best = (-1e9, None, None)
    for s in _SCALES_MM:
        L = sum(ndimage.gaussian_filter(small, s, order=[2 if a == i else 0 for a in range(3)], mode="nearest") for i in range(3))
        R = s * math.sqrt(3)
        ok = d2 <= min(search_mm, max(2.5, R)) ** 2
        if al is not None and (al & ok).any():
            ok &= al
        resp = np.where(ok, -s * s * L * wgt, -1e9)
        j = np.unravel_index(np.argmax(resp), resp.shape)
        if resp[j] > best[0]:
            best = (float(resp[j]), j, R)
    _, j, R = best
    centre = tuple(min(max(int(round(j[i] / zf[i])), 0), sub.shape[i] - 1) for i in range(3))
    return centre, R


def _dist_mm(shape, centre, vox):
    g = np.ogrid[tuple(slice(0, n) for n in shape)]
    return np.sqrt(sum(((g[i] - centre[i]) * vox[i]) ** 2 for i in range(3)))


def _strategy_b(vol, px, spacing, slice_idx, center_rc, half_mm, max_mm, note, frac=None, info=None):
    frac = FRAC if frac is None else frac
    nz, nr, nc = vol.shape
    r, c = int(round(center_rc[0])), int(round(center_rc[1]))
    if not (0 <= r < nr and 0 <= c < nc):
        note("location outside the image"); return None
    vox = (spacing, px, px)
    zr = max(1, int(math.ceil((max_mm / 2 + 4) / max(spacing, 0.5))))
    z0, z1 = max(0, slice_idx - zr), min(nz, slice_idx + zr + 1)
    hw = int(round((max_mm / 2 + 6) / px))
    r0, r1, c0, c1 = max(0, r - hw), min(nr, r + hw + 1), max(0, c - hw), min(nc, c + hw + 1)
    lungs = _fast_lung_mask(vol[z0:z1], px)[:, r0:r1, c0:c1]
    sub = vol[z0:z1, r0:r1, c0:c1].astype(np.float32)
    seed = (slice_idx - z0, r - r0, c - c0)
    centre, R = _blob(sub, vox, seed, search_mm=6.0, allowed=lungs)
    sm = ndimage.gaussian_filter(sub, (0.5 * px / spacing, 0.7, 0.7))
    d = _dist_mm(sub.shape, centre, vox)
    core = d <= max(1.2, 0.35 * R)
    peak = float(np.percentile(sm[core], 75))
    if peak < -750:
        note(f"no dense tissue at the location (peak {peak:.0f} HU)"); return None
    use_lung = bool(lungs[centre])
    region = lungs if use_lung else np.ones_like(lungs)
    shell = (d > 1.5 * R + 2) & (d < 1.5 * R + 8) & region & (sub < -400)
    lung_hu = min(float(np.median(sub[shell])) if shell.sum() > 20 else -850.0, -650.0)
    thr = min(-200.0, max(-780.0, lung_hu + frac * (peak - lung_hu)))
    # robust radius: first shell (1 mm) whose median (inside the lungs) falls below the threshold
    rmed = None
    for rad in np.arange(1.0, max_mm / 2, 0.5):
        shl = (d >= rad - 0.5) & (d < rad + 0.5) & region
        if shl.sum() >= 6 and np.median(sm[shl]) < thr:
            rmed = rad; break
    if rmed is None:
        rmed = max_mm / 2
    cap = min(max_mm / 2 + 2, CAP_K * rmed + CAP_B)
    mask = (sm > thr) & region & (d <= cap)
    st = ndimage.generate_binary_structure(3, 1)
    lab, _ = ndimage.label(mask, structure=st)
    pts = np.argwhere(lab > 0)
    if not len(pts):
        note("nothing above threshold"); return None
    dd = (((pts - np.array(centre)) * np.array(vox)) ** 2).sum(1)
    if dd.min() > 9:
        note("nothing above threshold near the blob"); return None
    comp0 = lab == lab[tuple(pts[np.argmin(dd)])]
    r_open = min(OPEN_MAX, OPEN_K * rmed)
    radii = sorted(set([round(r_open * 2) / 2] + [x for x in (1.0, 1.5, 2.0, 3.0, 4.0) if x > r_open]))
    for r_mm in radii:
        if r_mm < px * 0.75:
            cand = comp0
        else:
            dk = _disk(round(r_mm / px))
            er = np.stack([ndimage.binary_erosion(m, structure=dk) for m in comp0])
            lab2, _ = ndimage.label(er, structure=st)
            pts = np.argwhere(lab2 > 0)
            if not len(pts):
                break
            dd = (((pts - np.array(centre)) * np.array(vox)) ** 2).sum(1)
            if dd.min() > (0.5 * rmed + 2) ** 2:
                break
            corem = lab2 == lab2[tuple(pts[np.argmin(dd)])]
            cand = np.stack([ndimage.binary_dilation(m, structure=dk) for m in corem]) & comp0
        long_mm, short_mm, zbest = _measure(cand, px)
        if not (2.0 <= long_mm <= max_mm) or long_mm / max(short_mm, 0.1) > 2.2:
            continue
        if info is not None:
            info.append(f"R{R:.1f} rm{rmed:.1f} c{centre[0]-seed[0]},{centre[1]-seed[1]},{centre[2]-seed[2]} pk{peak:.0f} lu{lung_hu:.0f} thr{thr:.0f} open{r_mm} L{int(use_lung)}")
        return {"long_mm": round(long_mm, 1), "short_mm": round(short_mm, 1), "mean_mm": round((long_mm + short_mm) / 2, 1),
                "volume_mm3": round(float(cand.sum()) * px * px * spacing), "slices": int(cand.any(axis=(1, 2)).sum()),
                "threshold_hu": round(thr), "peak_hu": round(peak), "vesselCutMm": r_mm, "bestSliceOffset": int(zbest + z0 - slice_idx),
                "blobRadiusMm": round(R, 1), "robustRadiusMm": round(rmed, 1),
                "method": "3-D LoG blob re-centring, half-maximum segmentation capped by a robust (shell-median) radius, size-scaled opening to cut vessels, max axial Feret diameter"}
    if info is not None:
        info.append(f"FAIL R{R:.1f} rm{rmed:.1f} pk{peak:.0f} thr{thr:.0f}")
    note("no compact nodule-shaped region (attached to vessels or the chest wall)")
    return None


def measure_nodule(vol: np.ndarray, px: float, spacing: float, slice_idx: int, center_rc, half_mm: float = 30.0,
                   max_mm: float = 50.0, why: Optional[list] = None) -> Optional[dict]:
    """vol: HU volume (z, rows, cols). center_rc: (row, col) in pixels on slice_idx.
    why: optional list that receives the reason when no measurement is returned."""
    note = lambda m: (why.append(m) if why is not None else None)
    info = []
    out = _strategy_b(vol, px, spacing, slice_idx, center_rc, half_mm, max_mm, note, info=info)
    if out is None:
        out = _baseline(vol, px, spacing, slice_idx, center_rc, half_mm, max_mm, why)
        if out is not None:
            out["fallback"] = "baseline"
    if out is not None:
        out["info"] = " ".join(info) + (" [baseline]" if out.get("fallback") else "")
    return out
