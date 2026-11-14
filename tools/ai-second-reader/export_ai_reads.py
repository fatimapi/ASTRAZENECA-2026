"""Export AI second-reader results into the Candex site as data/lidc/ai-reads.js.

Reads a results file (gemini_results_<model>.json from gemini_analyse.py, or
an experiments file with the same per-case shape: {case: {"gemini": {...}}})
and writes window.candexAiReads = {schema, provenance, cases}. The radiologist
reference is NOT copied (the site already has it in cases.js).

Leaderboard metrics follow the evaluation advice for a tiny sample:
per-nodule detection with an exact (Clopper-Pearson) 95% CI, the LUNA16-style
consensus subset (nodules marked by >= 3 of 4 readers), signed and absolute
size error, and stated confidence on misses.

Usage:
  .venv/bin/python export_ai_reads.py --results gemini_results_gemini-3.5-flash.json \
      --model gemini-3.5-flash --input "3 axial slices (centre ±2), lung window, no outlines, pixel scale given"
"""
import argparse
import hashlib
import os
import json
from datetime import date
from math import comb
from pathlib import Path

HERE = Path(__file__).parent
SITE = Path(os.getenv('CANDEX_SITE', str(Path.home() / 'ASTRAZENECA-2026')))  # the Candex repo
CASES_JS = SITE / 'data' / 'lidc' / 'cases.js'
OUT = SITE / 'data' / 'lidc' / 'ai-reads.js'
KEEP = ['nodule_present', 'slice', 'location', 'long_axis_mm', 'short_axis_mm', 'composition', 'margin', 'lung_rads',
        'confidence', 'image_quality', 'short_report', 'other_findings', 'candidates', 'votes']


def binom_cdf(k, n, p):
    return sum(comb(n, i) * p ** i * (1 - p) ** (n - i) for i in range(k + 1))


def clopper_pearson(k, n, alpha=0.05):
    """Exact two-sided CI by bisection (no SciPy needed)."""
    def solve(f, lo=0.0, hi=1.0):
        for _ in range(60):
            mid = (lo + hi) / 2
            lo, hi = (mid, hi) if f(mid) else (lo, mid)
        return (lo + hi) / 2
    lower = 0.0 if k == 0 else solve(lambda p: 1 - binom_cdf(k - 1, n, p) < alpha / 2)
    upper = 1.0 if k == n else solve(lambda p: binom_cdf(k, n, p) > alpha / 2)
    return lower, upper


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--results', required=True)
    ap.add_argument('--model', required=True)
    ap.add_argument('--input', required=True, help='Plain description of what the model saw (English)')
    ap.add_argument('--input-fi', default=None, help='Same description in Finnish')
    ap.add_argument('--runs', type=int, default=1)
    ap.add_argument('--prompt-file', default=str(HERE / 'gemini_analyse.py'), help='File whose hash identifies the prompt/method version')
    ap.add_argument('--generated', default=str(date.today()))
    ap.add_argument('--coordinates', default='withheld: the model\'s image coordinates were unreliable in testing, so only its slice is shown')
    args = ap.parse_args()

    text = CASES_JS.read_text()
    cases = json.loads(text[text.index('{'):text.rindex('}') + 1])
    results = json.loads(Path(args.results).read_text())

    out, hits, misses_conf, signed, absolute = {}, [], [], [], []
    wrong_side = 0
    consensus_total = consensus_hits = 0
    for cid, case in sorted(cases.items()):
        entry = results.get(cid) or {}
        r = entry.get('gemini')
        if r is None and entry.get('runs'):  # gemini_experiments.py format: runs[0].read
            r = (entry['runs'][0] or {}).get('read')
        if not r:
            continue
        clean = {k: r[k] for k in KEEP if k in r and r[k] is not None}
        # Slice the model pointed at (image_number -> excerpt frame). x/y are left
        # out on purpose: in testing the model's y coordinate was unreliable.
        if r.get('image_number') and entry.get('images'):
            imgs = entry['images']
            n = int(r['image_number']) - 1
            if 0 <= n < len(imgs) and imgs[n].get('frame') is not None:
                clean['slice'] = imgs[n]['frame']
        if isinstance(clean.get('candidates'), list):  # positions in 384-px excerpt coordinates
            clean['candidates'] = [{k: c[k] for k in ('x', 'y', 'frame', 'votes') if k in c} for c in clean['candidates'][:5]]
        out[cid] = clean
        main = case['nodules'][0]
        # A detection counts only if it is on the radiologists' side; a finding on
        # the other side is a different finding (false positive), not a hit.
        pts = [p for o in case['frames'][case['centre']]['outlines'] if o['n'] == 0 for p in o['pts']]
        ref_side = 'right' if pts and sum(p[0] for p in pts) / len(pts) < 192 else 'left'
        reported = bool(r.get('nodule_present'))
        found = reported and (r.get('location') or {}).get('side') == ref_side
        if reported and not found:
            wrong_side += 1
        hits.append(found)
        if main['readers'] >= 3:
            consensus_total += 1
            consensus_hits += found
        if not found and r.get('confidence') is not None:  # includes wrong-side finds
            misses_conf.append(r['confidence'])
        if found and r.get('long_axis_mm') is not None:
            signed.append(r['long_axis_mm'] - main['diameter'])
            absolute.append(abs(r['long_axis_mm'] - main['diameter']))

    k, n = sum(hits), len(hits)
    lo, hi = clopper_pearson(k, n) if n else (0, 0)
    prov = {
        'model': args.model,
        'generated': args.generated,
        'input': args.input,
        'inputFi': args.input_fi or args.input,
        'runs': args.runs,
        'promptSha': hashlib.sha256(Path(args.prompt_file).read_bytes()).hexdigest()[:16],
        'source': f'{Path(args.results).name} via export_ai_reads.py',
        'coordinates': args.coordinates,
        'referenceRule': 'LIDC radiologists; consensus = nodule marked by at least 3 of 4 readers (LUNA16 convention)',
        'leaderboard': {
            'found': f'{k}/{n}',
            'ci': f'{round(lo * 100)}–{round(hi * 100)} %',
            'consensusFound': f'{consensus_hits}/{consensus_total}' if consensus_total else None,
            'meanSignedSizeErrorMm': round(sum(signed) / len(signed), 1) if signed else None,
            'meanAbsSizeErrorMm': round(sum(absolute) / len(absolute), 1) if absolute else None,
            'confidenceOnMisses': [round(x, 2) for x in misses_conf],
            'wrongSideFindings': wrong_side,
            'hitRule': 'found = nodule reported on the radiologists\' side',
        },
        'disclaimer': 'Research comparison, not for clinical use. General-purpose model, unvalidated; not a medical device, not CE-marked.',
    }
    body = json.dumps({'schema': 1, 'provenance': prov, 'cases': out}, ensure_ascii=False, indent=1)
    OUT.write_text(
        '// AI second-reader results for the 5 public LIDC-IDRI studies (research comparison, not for clinical use).\n'
        '// Generated by candex-data/export_ai_reads.py from precomputed Gemini reads. No API key, no live AI call.\n'
        f'window.candexAiReads = {body};\n')
    print(f'Wrote {OUT} · {len(out)} cases · found {k}/{n} (95% CI {round(lo * 100)}–{round(hi * 100)}%) · consensus {consensus_hits}/{consensus_total}')


if __name__ == '__main__':
    main()
