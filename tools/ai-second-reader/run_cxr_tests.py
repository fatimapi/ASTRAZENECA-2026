"""Run the Candex X-ray backend on every LIDC-IDRI frontal test copy.

Sends LIDC-CXR/frontal-test/*.dcm to a running backend (/api/analyze), saves
the raw API response to LIDC-CXR/results/<patient>.json and a summary table to
LIDC-CXR/cxr_results.csv. Research testing only.

Usage: CANDEX_API_KEY=<backend token> .venv/bin/python run_cxr_tests.py [--url http://127.0.0.1:8000]
"""
import argparse
import csv
import json
import os
import urllib.request
import uuid
from pathlib import Path

HERE = Path(__file__).parent
CXR = HERE / 'LIDC-CXR'


def post(url, token, path):
    b = uuid.uuid4().hex
    parts = [f'--{b}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\ntrue\r\n'.encode() for k in ('confirmed_chest', 'permitted_data')]
    parts.append(f'--{b}\r\nContent-Disposition: form-data; name="file"; filename="{path.name}"\r\nContent-Type: application/dicom\r\n\r\n'.encode() + path.read_bytes() + b'\r\n')
    body = b''.join(parts) + f'--{b}--\r\n'.encode()
    req = urllib.request.Request(f'{url}/api/analyze', data=body, method='POST', headers={'Content-Type': f'multipart/form-data; boundary={b}', 'Authorization': f'Bearer {token}', 'Accept': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return {'status': 'rejected', 'http': e.code, 'detail': e.read().decode(errors='replace')[:500]}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--url', default='http://127.0.0.1:8000')
    args = ap.parse_args()
    token = os.environ['CANDEX_API_KEY']
    cases = {r['patient_id']: r for r in csv.DictReader(open(HERE / 'cases.csv'))}
    (CXR / 'results').mkdir(exist_ok=True)
    rows = []
    for f in sorted((CXR / 'frontal-test').glob('LIDC-IDRI-*.dcm')):
        pid = f.stem
        d = post(args.url, token, f)
        (CXR / 'results' / f'{pid}.json').write_text(json.dumps(d, indent=1))
        ok = d.get('status') == 'completed'
        by = {x['label']: x['score'] for x in d.get('findings', [])}
        top = max(d.get('findings', []), key=lambda x: x['score'], default={'label': '', 'score': 0})
        rows.append({'patient': pid, 'status': d.get('status'), 'nodule': round(by.get('Nodule', 0), 3) if ok else '', 'mass': round(by.get('Mass', 0), 3) if ok else '',
                     'top_label': top['label'], 'top_score': round(top['score'], 2) if ok else '', 'ct_main_nodule_mm': cases.get(pid, {}).get('max_diameter_mm', ''), 'ct_band': cases.get(pid, {}).get('band', '')})
        print(pid, d.get('status'), {k: rows[-1][k] for k in ('nodule', 'mass', 'top_label', 'top_score')} if ok else d.get('detail', ''))
    with open(CXR / 'cxr_results.csv', 'w', newline='') as fh:
        w = csv.DictWriter(fh, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)


if __name__ == '__main__':
    main()
