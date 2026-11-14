# AI second reader: pipeline

These scripts produce `data/lidc/ai-reads.js`, the precomputed AI reads that the website shows as a research comparison. The website never calls an AI service. Method and results: [docs/ai-second-reader.md](../../docs/ai-second-reader.md).

## Setup
1. Create a working folder outside the repo, for example `~/candex-data`, and copy these scripts into it.
2. In that folder, add:
   - `LIDC-IDRI/<patient>/*.dcm`: the CT scans, downloaded from TCIA
   - `cases.csv`
3. Install the Python packages (Python 3.11): `pydicom pylidc pillow numpy google-genai pydantic`.
4. Add the Gemini API key:
   - put it alone in `.gemini-key` in the working folder (`chmod 600`), or set `GEMINI_API_KEY`
   - **never commit the key**
5. If the repo isn't at `~/ASTRAZENECA-2026`, set `CANDEX_SITE=/path/to/repo`.

## Steps

| Step | Script | Output |
|---|---|---|
| 1. Pick cases from the radiologists' annotations | `select_cases.py` | `cases.csv`, `nodules.csv` |
| 2. Export CT slices and outlines for the site | `export_ct.py <repo>/data/lidc` | `data/lidc/*/sNN.jpg`, `cases.js` |
| 3. Compare models (blind read, 3 slices) | `gemini_analyse.py --model <name>` then `compare_models.py` | `gemini_results_<model>.json`, `model_leaderboard.csv` |
| 4. Compare inputs and prompts | `gemini_experiments.py`, then `score_experiments.py` | `experiments/*.json`, `experiments/scoreboard.csv` |
| 5. Publish the chosen read to the site | `export_ai_reads.py --results experiments/dicom512-plain__gemini-4-argon.json --model gemini-4-argon --prompt-file gemini_experiments.py --input "…"` | `data/lidc/ai-reads.js` |

| 6. Chest X-ray test copies (frontal only, view from header evidence; drops clipping windows; visual fixes) | `make_cxr_test_copies.py` (needs `LIDC-CXR/<patient>/*.dcm`) | `frontal-test/*.dcm`, `cxr_manifest.csv`; results in `cxr_results.csv` (see backend/README.md) |
| 7. Run the X-ray classifier on the test copies | `CANDEX_API_KEY=<token> run_cxr_tests.py` (backend running) | `results/<patient>.json`, `cxr_results.csv` |
| 8. AI summaries of the X-ray scores (Gemini drafter + reviewer, EN/FI) | `summarise_cxr.py` | `data/lidc/cxr-reads.js`, `data/lidc/<patient>/cxr.jpg` |

`model_leaderboard.csv` and `experiments_scoreboard.csv` in this folder are the results behind the current export.

## Rules
- Send only public, de-identified research images. Gemini's terms prohibit clinical use. On the free tier, inputs may be used by Google and reviewed by people.
- Real patient images would need all of the following:
  - a GDPR legal basis
  - a data protection impact assessment
  - a data processing agreement with EU data residency
  - a Findata permit for secondary use
