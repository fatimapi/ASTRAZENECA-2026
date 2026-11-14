"""Leaderboard of every gemini_results_<model>.json against the LIDC reference.
Reference rule: all 5 nodules, plus the LUNA16-style consensus subset (marked by
>= 3 of 4 readers). Detection has an exact (Clopper-Pearson) 95% CI.

Scores (5 cases): nodules found, correct side (of all 5), Lung-RADS exact and
within one step, mean absolute size error on found nodules, composition match,
and mean confidence on missed nodules (high = overconfident). Writes
model_leaderboard.csv. Small sample: a demonstration, not a validation.
"""
import csv
import json
from pathlib import Path

HERE = Path(__file__).parent
from export_ai_reads import clopper_pearson  # exact binomial CI
ORDER = ['1', '2', '3', '4A', '4B', '4X']

rows = []
for f in sorted(HERE.glob('gemini_results_*.json')):
    model = f.stem.replace('gemini_results_', '')
    data = json.loads(f.read_text())
    ok = [v for v in data.values() if v.get('gemini')]
    failed = len(data) - len(ok)
    if not ok:
        rows.append({'model': model, 'answered': f'0/{len(data)}', 'note': 'no answers (error)'})
        continue
    found = [v for v in ok if v['gemini']['nodule_present']]
    missed = [v for v in ok if not v['gemini']['nodule_present']]
    side = sum(v['gemini']['location']['side'] == v['reference']['side'] for v in ok)
    exact = sum(v['gemini']['lung_rads'] == v['reference']['lung_rads'] for v in ok)
    near = sum(v['gemini']['lung_rads'] in ORDER and abs(ORDER.index(v['gemini']['lung_rads']) - ORDER.index(v['reference']['lung_rads'])) <= 1 for v in ok)
    errs = [abs(v['gemini']['long_axis_mm'] - v['reference']['diameter_mm']) for v in found if v['gemini']['long_axis_mm'] is not None]
    bias = [v['gemini']['long_axis_mm'] - v['reference']['diameter_mm'] for v in found if v['gemini']['long_axis_mm'] is not None]
    cons = [v for v in ok if v['reference'].get('readers', 0) >= 3]
    lo, hi = clopper_pearson(len(found), len(ok))
    comp = sum(v['gemini']['composition'] == v['reference']['composition'] for v in found)
    rows.append({
        'model': model,
        'answered': f'{len(ok)}/{len(data)}',
        'found': f'{len(found)}/5',
        'found_95ci': f'{round(lo * 100)}-{round(hi * 100)}%',
        'found_consensus_3of4': f"{sum(v['gemini']['nodule_present'] for v in cons)}/{len(cons)}",
        'side_correct': f'{side}/5',
        'lung_rads_exact': f'{exact}/5',
        'lung_rads_within_1': f'{near}/5',
        'mean_size_error_mm': round(sum(errs) / len(errs), 1) if errs else '',
        'mean_signed_error_mm': round(sum(bias) / len(bias), 1) if bias else '',
        'composition_match': f'{comp}/{len(found)}' if found else '',
        'confidence_when_missed': round(sum(v['gemini']['confidence'] for v in missed) / len(missed), 2) if missed else '',
        'seconds_per_case': round(sum(v.get('seconds', 0) for v in ok) / len(ok), 1),
        'note': f'{failed} failed' if failed else '',
        '_score': (len(found), exact, near, -(sum(errs) / len(errs) if errs else 99)),
    })

rows.sort(key=lambda r: r.get('_score', (-1,)), reverse=True)
cols = ['model', 'answered', 'found', 'found_95ci', 'found_consensus_3of4', 'side_correct', 'lung_rads_exact', 'lung_rads_within_1', 'mean_size_error_mm', 'mean_signed_error_mm', 'composition_match', 'confidence_when_missed', 'seconds_per_case', 'note']
with open(HERE / 'model_leaderboard.csv', 'w', newline='') as fh:
    w = csv.DictWriter(fh, fieldnames=cols, extrasaction='ignore')
    w.writeheader(); w.writerows(rows)
width = {c: max(len(c), *(len(str(r.get(c, ''))) for r in rows)) for c in cols}
print('  '.join(c.ljust(width[c]) for c in cols))
for r in rows:
    print('  '.join(str(r.get(c, '')).ljust(width[c]) for c in cols))
# Per-case view: which nodules each model found
cases = sorted(json.loads(next(HERE.glob('gemini_results_*.json')).read_text()))
print('\nFound per case (✓ found · ✗ missed · ! error):')
print('model'.ljust(28) + '  '.join(c[-4:] for c in cases))
for f in sorted(HERE.glob('gemini_results_*.json')):
    d = json.loads(f.read_text())
    marks = ['!' if not d[c].get('gemini') else ('✓' if d[c]['gemini']['nodule_present'] else '✗') for c in cases]
    print(f.stem.replace('gemini_results_', '').ljust(28) + '     '.join(marks))
