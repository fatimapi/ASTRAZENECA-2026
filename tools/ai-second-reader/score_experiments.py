"""Score gemini_experiments.py results (experiments/*.json) plus the baseline
gemini_results_<model>.json files against the LIDC reference.

Localised = detected, correct side, and (when coordinates are given) the stated
point lies on a slice within +/-1 of the radiologists' outlined slices and within
15 px (384-px scale) of the outline centroid or inside a reader polygon.
'other' = the point matched a different LIDC nodule; 'elsewhere' = matched none.
Self-consistency files (several runs) are scored per run (mean) and by vote.
Small sample (5 cases): a demonstration, not a validation.
Writes experiments/scoreboard.csv.
"""
import csv
import json
import statistics as st
from collections import Counter
from pathlib import Path

from gemini_analyse import load_cases

HERE = Path(__file__).parent
ORDER = ['1', '2', '3', '4A', '4B', '4X']
CASES = load_cases()


def inside(pt, poly):
    x, y, ok = pt[0], pt[1], False
    for (x1, y1), (x2, y2) in zip(poly, poly[1:] + poly[:1]):
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            ok = not ok
    return ok


def locate(cid, g, images):
    """'hit', 'other', 'elsewhere', 'side-only' (no coords), 'wrong-side' or None (not detected)."""
    if not g['nodule_present']:
        return None
    case = CASES[cid]
    ref_side = 'right' if st.mean(p[0] for o in case['frames'][case['centre']]['outlines'] if o['n'] == 0 for p in o['pts']) < 192 else 'left'
    if images is None or g.get('image_number') is None or g.get('centre_x') is None:
        return 'side-only' if g['location']['side'] == ref_side else 'wrong-side'
    k = g['image_number'] - 1
    if not 0 <= k < len(images):
        return 'elsewhere'
    im = images[k]
    x, y = im['ox'] + g['centre_x'] / im['scale'], im['oy'] + g['centre_y'] / im['scale']
    for n in range(len(case['nodules'])):
        for df in (0, -1, 1):
            f = im['frame'] + df
            if not 0 <= f < len(case['frames']):
                continue
            polys = [o['pts'] for o in case['frames'][f]['outlines'] if o['n'] == n]
            if not polys:
                continue
            cx = st.mean(p[0] for p in sum(polys, [])); cy = st.mean(p[1] for p in sum(polys, []))
            if ((x - cx) ** 2 + (y - cy) ** 2) ** 0.5 <= 15 or any(inside((x, y), p) for p in polys):
                return 'hit' if n == 0 else 'other'
    return 'elsewhere'


def lr_from_size(g):
    m = g.get('mean_diameter_mm')
    if m is None and g.get('long_axis_mm') is not None:
        m = (g['long_axis_mm'] + (g.get('short_axis_mm') or g['long_axis_mm'])) / 2
    if not g['nodule_present'] or m is None:
        return '1'
    return '2' if m < 6 else '3' if m < 8 else '4A' if m < 15 else '4B'


def near(a, b):
    return a in ORDER and abs(ORDER.index(a) - ORDER.index(b)) <= 1


def score(reads):
    """reads: list of (cid, g, images, seconds)."""
    ok = [r for r in reads if r[1]]
    loc = {cid: locate(cid, g, im) for cid, g, im, _ in ok}
    found = [r for r in ok if r[1]['nodule_present']]
    signed = [g['long_axis_mm'] - ref(c)['diameter_mm'] for c, g, _, _ in found if g['long_axis_mm'] is not None]
    missed_conf = [g['confidence'] for c, g, _, _ in ok if loc[c] not in ('hit', 'side-only')]
    return {
        'found': sum(1 for _ in found),
        'localised': sum(v in ('hit', 'side-only') for v in loc.values()),
        'loc_detail': ' '.join(f'{c[-4:]}:{(v or "miss")}' for c, v in sorted(loc.items())),
        'lr_exact': sum(g['lung_rads'] == ref(c)['lung_rads'] for c, g, _, _ in ok),
        'lr_within1': sum(near(g['lung_rads'], ref(c)['lung_rads']) for c, g, _, _ in ok),
        'lr_from_size_exact': sum(lr_from_size(g) == ref(c)['lung_rads'] for c, g, _, _ in ok),
        'size_err': round(st.mean(abs(s) for s in signed), 1) if signed else None,
        'size_bias': round(st.mean(signed), 1) if signed else None,
        'conf_on_miss': round(st.mean(missed_conf), 2) if missed_conf else None,
        'answered': len(ok), 'sec_per_call': round(st.mean(r[3] for r in reads), 1),
    }


def ref(cid):
    from gemini_analyse import reference
    return reference(CASES[cid])


def vote(runs, cid, images):
    gs = [r['read'] for r in runs if r['read']]
    present = sum(g['nodule_present'] for g in gs) * 2 > len(gs)
    agree = sum(g['nodule_present'] == present for g in gs) / len(gs)
    pos = [g for g in gs if g['nodule_present']] if present else gs
    # pick the run whose size is the median as the representative (keeps coords coherent)
    if present:
        sizes = sorted((g['long_axis_mm'] or 0, i) for i, g in enumerate(pos))
        rep = dict(pos[sizes[len(sizes) // 2][1]])
        rep['lung_rads'] = Counter(g['lung_rads'] for g in pos).most_common(1)[0][0]
        locs = [locate(cid, g, images) for g in pos]
        rep['_loc_agree'] = sum(l in ('hit', 'side-only') for l in locs) / len(gs)
    else:
        rep = dict(pos[0])
    rep['confidence'] = agree
    rep['_model_conf'] = st.mean(g['confidence'] for g in gs)
    return rep


rows = []
for f in sorted(HERE.glob('gemini_results_*.json')):
    model = f.stem.replace('gemini_results_', '')
    if model not in ('gemini-3.5-flash', 'gemini-4-argon', 'gemini-3.8-flash'):
        continue
    d = json.loads(f.read_text())
    rows.append({'variant': 'baseline3-original', 'model': model, 'calls': len(d),
                 **score([(c, v['gemini'], None, v.get('seconds', 0)) for c, v in sorted(d.items())])})
for f in sorted((HERE / 'experiments').glob('*__*.json')):
    variant, model = f.stem.split('__')
    d = json.loads(f.read_text())
    nruns = len(next(iter(d.values()))['runs'])
    for i in range(nruns):
        rows.append({'variant': variant + (f' run{i + 1}' if nruns > 1 else ''), 'model': model, 'calls': len(d),
                     **score([(c, v['runs'][i]['read'], v['images'], v['runs'][i]['seconds']) for c, v in sorted(d.items())])})
    if nruns > 1:
        voted = {c: vote(v['runs'], c, v['images']) for c, v in d.items()}
        s = score([(c, voted[c], d[c]['images'], st.mean(r['seconds'] for r in d[c]['runs'])) for c in sorted(d)])
        s['calls'] = nruns * len(d)
        s['vote_conf'] = ' '.join(f'{c[-4:]}:{voted[c]["confidence"]:.2f}/{voted[c]["_model_conf"]:.2f}' for c in sorted(d))
        rows.append({'variant': variant + ' VOTE', 'model': model, **s})

cols = ['variant', 'model', 'answered', 'found', 'localised', 'lr_exact', 'lr_within1', 'lr_from_size_exact', 'size_err', 'size_bias',
        'conf_on_miss', 'calls', 'sec_per_call', 'loc_detail', 'vote_conf']
with open(HERE / 'experiments' / 'scoreboard.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore'); w.writeheader(); w.writerows(rows)
for r in rows:
    print('  '.join(str(r.get(c, '')) for c in cols))
